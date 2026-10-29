// Proposal only: a loopback adapter around an unchanged, pinned EdOS module.
// No installed EdOS configuration, author corpus, Vite or node_modules is used.
import http from "node:http";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PIN = "705e2b4873772e9649bc3b52b445658e10592c1f62b8f79a4f6e191cc841676c";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const [moduleArgument, runArgument] = process.argv.slice(2);
if (!moduleArgument || !runArgument || process.argv.length !== 4) {
  throw new Error(
    "Usage: node target.mjs <pinned-scene-workspace.mjs> <NEW-run-directory>",
  );
}
const moduleBytes = await readFile(resolve(moduleArgument));
if (sha256(moduleBytes) !== PIN)
  throw new Error(
    "EdOS source hash does not match the declared frozen baseline.",
  );
const fixtureBytes = await readFile(new URL("./fixture.json", import.meta.url));
const fixture = JSON.parse(fixtureBytes);

// Exclusive creation prevents reuse of an existing product directory or state.
await mkdir(resolve(runArgument), { mode: 0o700 });
const runDirectory = await realpath(resolve(runArgument));
for (const name of ["target", "sources", "data"])
  await mkdir(join(runDirectory, name), { mode: 0o700 });
const copiedModule = join(runDirectory, "target", "scene-workspace.mjs");
await writeFile(copiedModule, moduleBytes, { flag: "wx", mode: 0o600 });
if (sha256(await readFile(copiedModule)) !== PIN)
  throw new Error("Copied EdOS source hash mismatch.");
await writeFile(
  join(runDirectory, "sources", "scene.txt"),
  fixture.scene_text,
  {
    flag: "wx",
    mode: 0o600,
  },
);
await writeFile(
  join(runDirectory, "sources", "reference.txt"),
  fixture.reference.text,
  {
    flag: "wx",
    mode: 0o600,
  },
);
const config = {
  id: fixture.scene_id,
  title: "Synthetic capture/replay scene",
  status: "test-only",
  root: join(runDirectory, "sources"),
  file: "scene.txt",
  sections: [
    {
      id: fixture.section_id,
      heading: fixture.heading,
      sources: [fixture.reference.id],
    },
  ],
  documents: [
    {
      id: fixture.reference.id,
      title: fixture.reference.title,
      file: "reference.txt",
    },
  ],
  nextStep: "Synthetic isolated pilot only.",
};
const configPath = join(runDirectory, "config.json");
await writeFile(configPath, JSON.stringify(config, null, 2), {
  flag: "wx",
  mode: 0o600,
});
const { createSceneWorkspace, handleSceneRequest } = await import(
  pathToFileURL(copiedModule).href
);
const workspace = await createSceneWorkspace(
  configPath,
  join(runDirectory, "data"),
);
const expectedRevision = JSON.stringify(
  sha256(Buffer.from(fixture.scene_text)),
);
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><title>EdOS synthetic capture pilot</title>
<h1>EdOS synthetic capture pilot</h1><p id="bootstrap">Bootstrapping</p>
<pre id="status">Bootstrapping</pre><script>
const status = document.getElementById('status');
const expectedRevision = ${expectedRevision};
async function bootstrap() {
  const response = await fetch('/api/scene-workspace', { headers: { 'X-Edos-Scene-Client': '1' } });
  if (response.status !== 200) throw new Error('Bootstrap HTTP ' + response.status);
  const scene = await response.json();
  if (scene.revision !== expectedRevision) throw new Error('Source revision mismatch');
  localStorage.setItem('rea-pilot-auth', scene.token);
  const ready = document.getElementById('bootstrap'); ready.id = 'ready'; ready.textContent = 'Ready';
  status.textContent = 'Ready';
}
bootstrap().catch(() => { status.textContent = 'Bootstrap failed'; });
</script></html>`;
let origin;
const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(page);
    return;
  }
  void handleSceneRequest(workspace, req, res, origin)
    .then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    })
    .catch(() => {
      if (!res.headersSent)
        res.writeHead(500, { "Content-Type": "application/json" });
      res.end('{"error":"adapter failure"}');
    });
});
await new Promise((accept, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    origin = `http://127.0.0.1:${server.address().port}`;
    accept();
  });
});
const ready = {
  status: "ready",
  fixture_id: fixture.fixture_id,
  origin,
  module_sha256: PIN,
  fixture_sha256: sha256(fixtureBytes),
  source_sha256: sha256(Buffer.from(fixture.scene_text)),
  reference_sha256: sha256(Buffer.from(fixture.reference.text)),
  source_path: "sources/scene.txt",
  candidate_directory: `data/scene-candidates/${fixture.scene_id}`,
};
// Private parent-only input for declaring the exact ephemeral credential to the
// capture tool BEFORE navigation, including redaction of its initial GET body.
await writeFile(
  join(runDirectory, "session.json"),
  JSON.stringify(
    {
      origin,
      token: workspace.token,
      revision: ready.source_sha256,
      auth_storage_key: "rea-pilot-auth",
      fixture_id: fixture.fixture_id,
    },
    null,
    2,
  ),
  { flag: "wx", mode: 0o600 },
);
await writeFile(
  join(runDirectory, "READY.json"),
  JSON.stringify(ready, null, 2),
  {
    flag: "wx",
    mode: 0o600,
  },
);
process.stdout.write(`${JSON.stringify(ready)}\n`); // Session token must be obtained through the real GET route.
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server.closeAllConnections();
  await new Promise((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void close().catch(() => {
      process.exitCode = 1;
    });
  });
