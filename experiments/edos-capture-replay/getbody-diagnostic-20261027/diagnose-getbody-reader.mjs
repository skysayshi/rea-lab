import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const [reaArg, chrome, outArg] = process.argv.slice(2),
  rea = resolve(reaArg),
  out = resolve(outArg);
await mkdir(out, { mode: 0o700 });
for (const p of ["home", "tmp", "profile"])
  await mkdir(join(out, p), { mode: 0o700 });
const hash = (b) => createHash("sha256").update(b).digest("hex");
const { importVerifierSource } = await import(
  pathToFileURL(join(rea, "scripts/lib/verifier-source-loader.mjs"))
);
const { performScenarioRequest } = await importVerifierSource(
  pathToFileURL(join(rea, "src/browser/PlaywrightScenarioRequest.ts")),
);
const { BrowserScenarioSecrets } = await importVerifierSource(
  pathToFileURL(join(rea, "src/browser/BrowserScenarioSecrets.ts")),
);
const { browserScenarioSchema } = await importVerifierSource(
  pathToFileURL(join(rea, "src/domain/browserScenario.ts")),
);
const { chromium } = createRequire(join(rea, "package.json"))(
  "playwright-core",
);
const sourcePath = join(rea, "src/browser/PlaywrightScenarioRequest.ts"),
  sourceHash = hash(await readFile(sourcePath));
const events = [],
  results = [],
  bodyReads = [],
  serverHits = [];
let context, origin, server;
const stamp = (kind, value = {}) =>
  events.push({ at: new Date().toISOString(), kind, ...value });
const payload = (id) =>
  JSON.stringify({
    id,
    text: "Independent GET body ё 🚀",
    data: "x".repeat(256),
  });
const report = {
  started_at: new Date().toISOString(),
  source_sha256: sourceHash,
  node: process.version,
  status: "RUNNING",
  results,
  events,
  serverHits,
};
try {
  server = http.createServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<!doctype html><title>diagnostic</title>");
      return;
    }
    const id = new URL(req.url, origin).searchParams.get("id"),
      bytes = payload(id);
    serverHits.push(id);
    stamp("server.request", { id });
    res.on("finish", () =>
      stamp("server.finish", {
        id,
        sha256: hash(bytes),
        bytes: Buffer.byteLength(bytes),
      }),
    );
    res.on("close", () => stamp("server.close", { id }));
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.write(bytes);
    res.end();
  });
  await new Promise((ok, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", () => {
      origin = `http://127.0.0.1:${server.address().port}`;
      ok();
    });
  });
  context = await chromium.launchPersistentContext(join(out, "profile"), {
    executablePath: chrome,
    headless: true,
    serviceWorkers: "block",
    timeout: 60000,
    env: {
      PATH: process.env.PATH,
      HOME: join(out, "home"),
      TMPDIR: join(out, "tmp"),
      LANG: "en_US.UTF-8",
    },
  });
  const page = context.pages()[0];
  await page.goto(origin);
  const nativeConsole = (message) => {
    if (message.text().startsWith("reader-control:"))
      stamp("page.reader-control", { text: message.text() });
  };
  page.on("console", nativeConsole);
  await page.evaluate(() => {
    const release = ReadableStreamDefaultReader.prototype.releaseLock;
    ReadableStreamDefaultReader.prototype.releaseLock = function () {
      if (globalThis.__skipRelease) {
        console.debug("reader-control:release-suppressed");
        return;
      }
      return release.call(this);
    };
    const abort = AbortController.prototype.abort;
    AbortController.prototype.abort = function (...args) {
      console.debug("reader-control:abort-called");
      return abort.apply(this, args);
    };
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  for (const event of [
    "requestWillBeSent",
    "responseReceived",
    "loadingFinished",
    "loadingFailed",
  ])
    cdp.on("Network." + event, (e) =>
      stamp("cdp." + event, {
        requestId: e.requestId,
        url: e.request?.url ?? e.response?.url,
        error: e.errorText,
        canceled: e.canceled,
        encodedDataLength: e.encodedDataLength,
      }),
    );
  page.on("requestfailed", (r) =>
    stamp("pw.failed", { url: r.url(), error: r.failure()?.errorText }),
  );
  page.on("requestfinished", (r) => {
    stamp("pw.finished", { url: r.url() });
    bodyReads.push(
      (async () => {
        try {
          const response = await r.response(),
            bytes = await response.body();
          stamp("pw.body", {
            url: r.url(),
            sha256: hash(bytes),
            bytes: bytes.length,
          });
        } catch (e) {
          stamp("pw.body-error", { url: r.url(), error: e.message });
        }
      })(),
    );
  });
  const originalRoute = page.route.bind(page),
    originalUnroute = page.unroute.bind(page);
  page.route = async (...args) => {
    stamp("route.begin");
    await originalRoute(...args);
    stamp("route.end");
  };
  page.unroute = async (...args) => {
    stamp("unroute.begin");
    await originalUnroute(...args);
    stamp("unroute.end");
  };
  for (const mode of ["A", "B", "A2"]) {
    stamp("mode.begin", { mode });
    await page.evaluate((skip) => {
      globalThis.__skipRelease = skip;
    }, mode === "B");
    for (let i = 0; i < 10; i++) {
      const id = `${mode}-${i}`;
      const scenario = browserScenarioSchema.parse({
        browser: { mode: "launch", executable_path: chrome },
        start_url: { url: origin },
        actions: [
          {
            step_id: id,
            action: "request",
            method: "GET",
            path: `/data?id=${id}`,
            timeout_ms: 10000,
            expected_status: [200],
          },
        ],
      });
      const secrets = BrowserScenarioSecrets.resolve(scenario, {});
      assert.ok(secrets.ok);
      stamp("action.begin", { id });
      let error;
      try {
        await performScenarioRequest({
          page,
          action: scenario.actions[0],
          secrets: secrets.value,
          startOrigin: origin,
        });
      } catch (e) {
        error = e.message;
      }
      stamp("action.end", { id, error });
      results.push({ id, mode, error: error ?? null });
    }
    const deadline = Date.now() + 5000;
    while (
      events.filter(
        (e) =>
          ["pw.finished", "pw.failed"].includes(e.kind) &&
          e.url.includes("id=" + mode + "-"),
      ).length < 10
    ) {
      if (Date.now() > deadline) throw Error("native terminal deadline");
      await new Promise((ok) => setTimeout(ok, 10));
    }
    let timer;
    try {
      await Promise.race([
        Promise.all(bodyReads),
        new Promise((_, no) => {
          timer = setTimeout(() => no(Error("body read deadline")), 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    stamp("mode.end", { mode });
  }
  const abort = async (route) => route.abort("aborted");
  await page.route("**/data?id=negative", abort);
  const negative = browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: chrome },
    start_url: { url: origin },
    actions: [
      {
        step_id: "negative",
        action: "request",
        method: "GET",
        path: "/data?id=negative",
        timeout_ms: 10000,
        expected_status: [200],
      },
    ],
  });
  let refused = false;
  try {
    await performScenarioRequest({
      page,
      action: negative.actions[0],
      secrets: BrowserScenarioSecrets.resolve(negative, {}).value,
      startOrigin: origin,
    });
  } catch {
    refused = true;
  }
  await page.unroute("**/data?id=negative", abort);
  assert.ok(refused, "deliberate abort must be observed");
  await context.close();
  context = undefined;
  report.matrix = ["A", "B", "A2"].map((mode) => ({
    mode,
    actions: results.filter((r) => r.mode === mode).length,
    action_errors: results.filter((r) => r.mode === mode && r.error).length,
    failed: events.filter(
      (e) => e.kind === "pw.failed" && e.url.includes("id=" + mode + "-"),
    ).length,
    bodies: events.filter(
      (e) => e.kind === "pw.body" && e.url.includes("id=" + mode + "-"),
    ).length,
  }));
  report.negative_abort_observed = refused;
  report.source_unchanged = hash(await readFile(sourcePath)) === sourceHash;
  assert.ok(report.source_unchanged);
  report.retained_bodies_match_server = events
    .filter((e) => e.kind === "pw.body" && e.url.includes("/data?"))
    .every(
      (e) => e.sha256 === hash(payload(new URL(e.url).searchParams.get("id"))),
    );
  assert.ok(report.retained_bodies_match_server);
  report.status = "OBSERVED";
} catch (e) {
  report.status = "FAIL";
  report.failure = e.message;
  process.exitCode = 1;
} finally {
  if (context) await context.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((ok) => server.close(ok));
  }
  report.completed_at = new Date().toISOString();
  await writeFile(
    join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      status: report.status,
      matrix: report.matrix,
      failure: report.failure,
      output: out,
    }),
  );
}
