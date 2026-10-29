// Diagnostic continuation: never launches a browser or upgrades partial capture.
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const [reaArg, trialArg, expectedId, outArg] = process.argv.slice(2);
assert.equal(
  process.argv.length,
  6,
  "Usage: node continue-partial.mjs REA_CHECKOUT PRIOR_TRIAL PINNED_ID NEW_OUTPUT",
);
const rea = resolve(reaArg),
  trial = resolve(trialArg),
  out = resolve(outArg);
const here = dirname(fileURLToPath(import.meta.url)),
  root = join(trial, "target-run");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = async (p) => JSON.parse(await readFile(p, "utf8"));
await mkdir(out, { mode: 0o700 });
const save = (name, x) =>
  writeFile(join(out, name), JSON.stringify(x, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
const env = {
  PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  HOME: join(trial, "home"),
  TMPDIR: join(trial, "tmp"),
  LANG: "en_US.UTF-8",
  CI: "1",
  NO_COLOR: "1",
  REA_LOG_LEVEL: "info",
  DO_NOT_TRACK: "1",
  HUSKY: "0",
};
const receipt = {
  schema: "rea-partial-capture-diagnostics-v1",
  started_at: new Date().toISOString(),
  status: "RUNNING",
  full_pilot_acceptance: "FAIL_INCOMPLETE_CAPTURE",
  checks: [],
  commands: [],
  facts: {},
  cleanup: [],
};
const check = (ok, label) => {
  receipt.checks.push({ label, pass: Boolean(ok) });
  assert.ok(ok, label);
};
const fixture = await read(join(here, "fixture.json"));
const capturePath = join(trial, "capture.stdout");
const captureBytes = await readFile(capturePath),
  capture = JSON.parse(captureBytes);
const boundPaths = [
  capturePath,
  join(root, "target", "scene-workspace.mjs"),
  join(root, "config.json"),
  join(here, "fixture.json"),
  join(here, "oracle.mjs"),
  fileURLToPath(import.meta.url),
];
async function bindings() {
  return Promise.all(
    boundPaths.map(async (p, index) => ({
      index,
      sha256: hash(await readFile(p)),
    })),
  );
}
const before = await bindings();
await save("bindings-before.json", before);
const cli = (...args) => [join(rea, "scripts/rea.mjs"), ...args];
async function command(name, args) {
  const start = Date.now();
  const result = spawnSync(process.execPath, args, {
    cwd: rea,
    env,
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 16 * 1024 * 1024,
    killSignal: "SIGTERM",
  });
  await writeFile(join(out, name + ".stdout"), result.stdout ?? "", {
    flag: "wx",
    mode: 0o600,
  });
  await writeFile(join(out, name + ".stderr"), result.stderr ?? "", {
    flag: "wx",
    mode: 0o600,
  });
  receipt.commands.push({
    name,
    exit: result.status,
    signal: result.signal,
    error: result.error?.code ?? null,
    elapsed_ms: Date.now() - start,
  });
  check(
    !result.error && result.signal === null,
    name + ": completed within deadline",
  );
  return { exit: result.status, value: JSON.parse(result.stdout) };
}
async function oracle(name, sequence) {
  const r = await command(name, [
    join(here, "oracle.mjs"),
    root,
    String(sequence),
  ]);
  check(
    r.exit === 0 && r.value.status === "PASS",
    name + ": independent filesystem oracle",
  );
  receipt.facts[name] = r.value;
  return r.value.facts;
}
let target, replay, client, token;
async function closeTarget() {
  if (target?.listening) {
    target.closeAllConnections();
    await new Promise((ok, no) => target.close((e) => (e ? no(e) : ok())));
    receipt.cleanup.push({
      name: "fresh-negative-control-target",
      closed: true,
    });
  }
}
async function waitWithin(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise((ok) => (timer = setTimeout(() => ok(false), ms))),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function closeReplay() {
  if (!replay) return;
  if (!replay.exit) {
    replay.child.kill("SIGTERM");
    if (!(await waitWithin(replay.done, 10000))) {
      replay.child.kill("SIGKILL");
      await waitWithin(replay.done, 2000);
      receipt.cleanup.push({ name: "replay", forced: true });
      if (!replay.exit) {
        replay.child.stdout.destroy();
        replay.child.stderr.destroy();
        replay.child.unref();
      }
    }
  }
  if (!replay.saved) {
    replay.saved = true;
    await writeFile(join(out, "replay-server.stdout"), replay.stdout, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(join(out, "replay-server.stderr"), replay.stderr, {
      flag: "wx",
      mode: 0o600,
    });
    receipt.cleanup.push({ name: "replay", exit: replay.exit ?? null });
  }
}
try {
  check(
    capture.evidence_id === expectedId,
    "Externally retained original Evidence ID",
  );
  check(
    capture.operation === "capture_browser_scenario" &&
      capture.normalized_result.steps.every((s) => s.status === "completed"),
    "Actual completed browser request actions",
  );
  check(
    capture.normalized_result.completeness.status === "incomplete" &&
      !capture.normalized_result.completeness.equality_eligible,
    "Original incomplete capture classification preserved",
  );
  check(
    capture.normalized_result.browser.cleanup === "terminated-owned-process",
    "REA reports original browser termination",
  );
  const content = capture.normalized_result.events.items.filter(
    (e) => e.kind === "network-content",
  );
  const bootstrap = content.find(
    (e) =>
      e.phase === "response" && e.body.state === "captured" && e.body.redacted,
  );
  const boot = JSON.parse(
    Buffer.from(bootstrap.body.content, "base64").toString(),
  );
  check(
    boot.token === "[REDACTED:edos_session]",
    "Bootstrap response token actually redacted after decoding",
  );
  receipt.facts.capture = {
    id: expectedId,
    raw_sha256: hash(captureBytes),
    completeness: capture.normalized_result.completeness,
    browser: capture.normalized_result.browser,
    steps: capture.normalized_result.steps.map((s) => ({
      id: s.step_id,
      status: s.status,
    })),
    unavailable: content
      .filter((e) => e.body.state === "unavailable")
      .map((e) => ({
        sequence: e.sequence,
        source_sequence: e.source_event_sequence,
        body: e.body,
      })),
  };
  const initial = await oracle("oracle-before-controls", 1);
  const calibration = await command("oracle-negative-calibration", [
    join(here, "oracle.mjs"),
    root,
    "0",
  ]);
  check(
    calibration.exit === 1 &&
      calibration.value.status === "FAIL" &&
      calibration.value.failure ===
        "exact revision set with no pending or extra files",
    "Independent oracle rejects false empty-state expectation",
  );
  receipt.facts.oracle_calibration = {
    exit: calibration.exit,
    failure: calibration.value.failure,
  };
  const state = await read(
    join(root, "data", "scene-candidates", fixture.scene_id, "00000001.json"),
  );
  check(
    before[1].sha256 ===
      "705e2b4873772e9649bc3b52b445658e10592c1f62b8f79a4f6e191cc841676c",
    "Unchanged real EdOS module",
  );
  const { createSceneWorkspace, handleSceneRequest } = await import(
    pathToFileURL(join(root, "target", "scene-workspace.mjs"))
  );
  const workspace = await createSceneWorkspace(
    join(root, "config.json"),
    join(root, "data"),
  );
  let origin;
  target = http.createServer((req, res) => {
    void handleSceneRequest(workspace, req, res, origin)
      .then((handled) => {
        if (!handled) {
          res.writeHead(404);
          res.end();
        }
      })
      .catch(() => {
        res.destroy();
      });
  });
  await new Promise((ok, no) => {
    target.once("error", no);
    target.listen(0, "127.0.0.1", () => {
      origin = `http://127.0.0.1:${target.address().port}`;
      ok();
    });
  });
  const fetched = await fetch(origin + "/api/scene-workspace", {
    headers: { "X-Edos-Scene-Client": "1" },
    signal: AbortSignal.timeout(5000),
  });
  check(
    fetched.status === 200,
    "Fresh negative-control session obtained through actual GET",
  );
  token = (await fetched.json()).token;
  const body = {
    expectedSequence: 0,
    baseRevision: hash(Buffer.from(fixture.scene_text)),
    sectionId: fixture.section_id,
    title: fixture.candidate.title,
    text: fixture.candidate.text,
  };
  for (const [name, credential, input, expected] of [
    [
      "wrong-token",
      "not-a-valid-session-token",
      { ...body, expectedSequence: 1 },
      403,
    ],
    ["stale-sequence", token, body, 409],
  ]) {
    const r = await fetch(origin + "/api/scene-workspace/candidates", {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-Edos-Scene-Client": "1",
        "X-Edos-Scene-Token": credential,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(5000),
    });
    await save(name + ".json", { status: r.status, body: await r.json() });
    check(r.status === expected, name + ": expected HTTP " + expected);
    const facts = await oracle("oracle-" + name, 1);
    check(
      facts.revision_sha256 === initial.revision_sha256,
      name + ": no committed write",
    );
    receipt.facts[name] = {
      status: r.status,
      unchanged_revision: true,
      session: "new diagnostic session, not original captured session",
    };
  }
  const missing = await fetch(
    origin + "/api/scene-workspace/source?id=unrecorded-negative-source",
    {
      headers: { "X-Edos-Scene-Client": "1" },
      signal: AbortSignal.timeout(5000),
    },
  );
  check(missing.status === 404, "Live unknown source query returns 404");
  await save("live-query-negative.json", {
    status: missing.status,
    body: await missing.json(),
  });
  receipt.facts.live_query_negative = { status: 404 };
  await closeTarget();
  async function unavailable(url, label) {
    const address = new URL(url);
    const result = await new Promise((done) => {
      const socket = net.connect({
        host: address.hostname,
        port: Number(address.port),
      });
      socket.setTimeout(2000);
      socket.once("connect", () => {
        socket.destroy();
        done("connected");
      });
      socket.once("error", (error) => done(error.code));
      socket.once("timeout", () => {
        socket.destroy();
        done("timeout");
      });
    });
    receipt.facts.listener_probes ??= [];
    receipt.facts.listener_probes.push({ label, result });
    check(result === "ECONNREFUSED", label);
  }
  await unavailable(origin, "Fresh control target stopped before replay");
  await unavailable(
    capture.parameters.start_url.url,
    "Original captured target stopped before replay",
  );
  const req = {
    source: {
      kind: "evidence-file",
      path: capturePath,
      evidence_id: expectedId,
    },
    view: { kind: "environment-manifest", template_rules: [] },
  };
  await save("manifest-request.json", req);
  const projected = await command(
    "manifest",
    cli("inspect-analysis-view", join(out, "manifest-request.json"), "--json"),
  );
  check(
    projected.exit === 0 &&
      projected.value.normalized_result.parent_evidence_id === expectedId,
    "Public projection authenticated and bound original parent",
  );
  const manifest = projected.value;
  await save("manifest.json", manifest);
  receipt.facts.manifest = {
    id: manifest.evidence_id,
    parent_id: manifest.normalized_result.parent_evidence_id,
  };
  const tampered = structuredClone(capture);
  tampered.normalized_result.duration_ms += 1;
  await save("tampered.json", tampered);
  await save("tamper-request.json", {
    ...req,
    source: { ...req.source, path: join(out, "tampered.json") },
  });
  const rejected = await command(
    "tamper",
    cli("inspect-analysis-view", join(out, "tamper-request.json"), "--json"),
  );
  check(
    rejected.exit === 1 &&
      rejected.value.code === "invalid_request" &&
      JSON.stringify(rejected.value).includes("evidence_id"),
    "Public consumer rejects semantic tamper with original ID",
  );
  receipt.facts.tamper = {
    exit: rejected.exit,
    code: rejected.value.code,
    evidence_id_issue: true,
  };
  const child = spawn(
    process.execPath,
    cli(
      "environment-serve",
      join(out, "manifest.json"),
      "--evidence",
      capturePath,
      "--replay-only",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--json",
    ),
    { cwd: rea, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  replay = { child, stdout: "", stderr: "", exit: null };
  child.stdout.on("data", (b) => {
    replay.stdout += b;
  });
  child.stderr.on("data", (b) => {
    replay.stderr += b;
  });
  replay.done = new Promise((ok) =>
    child.once("close", (code, signal) => {
      replay.exit = { code, signal };
      ok();
    }),
  );
  child.once("error", (e) => {
    receipt.facts.replay_spawn_error = e.code;
  });
  const deadline = Date.now() + 25000;
  let listening;
  while (Date.now() < deadline) {
    listening = replay.stderr
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .find((x) => x?.msg === "MCP transport listening" && x.url);
    if (listening) break;
    assert.ok(!replay.exit, "Replay server exited before readiness");
    await new Promise((ok) => setTimeout(ok, 50));
  }
  check(Boolean(listening), "Actual replay server listening");
  const { Client, StreamableHTTPClientTransport } = createRequire(
    join(rea, "package.json"),
  )("@modelcontextprotocol/client");
  client = new Client({ name: "partial-evidence-diagnostic", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(listening.url)),
  );
  const catalog = await client.listTools();
  await save("mcp-catalog.json", catalog);
  const tool = (method, path) => {
    const t = manifest.normalized_result.tools.find(
      (x) => x.method === method && x.path_template === path,
    );
    assert.ok(t && catalog.tools.some((a) => a.name === t.name));
    return t;
  };
  const post = tool("POST", "/api/scene-workspace/candidates"),
    source = tool("GET", "/api/scene-workspace/source"),
    candidate = tool("GET", "/api/scene-workspace/candidates");
  const reference = {
    id: fixture.reference.id,
    title: fixture.reference.title,
    file: "reference.txt",
    revision: hash(Buffer.from(fixture.reference.text)),
    text: fixture.reference.text,
  };
  async function call(name, t, args, exact, expectedBody) {
    const result = await client.callTool({ name: t.name, arguments: args });
    await save(name + ".json", result);
    const c = result.structuredContent;
    check(!result.isError && c?.status === 200, name + ": recorded HTTP200");
    check(
      c.replay.evidence_id === expectedId &&
        t.record_ordinals.includes(c.replay.record_ordinal) &&
        c.replay.exact_match === exact,
      name + ": expected source and match",
    );
    check(
      result._meta?.provenance?.untrusted_content === true,
      name + ": target content untrusted",
    );
    if (expectedBody !== undefined) {
      check(
        c.replay.body_recorded && !c.replay.truncated,
        name + ": complete selected body",
      );
      assert.deepEqual(c.body, expectedBody, name + ": independent oracle");
      receipt.checks.push({ label: name + ": independent oracle", pass: true });
    } else
      check(
        c.replay.body_recorded === false,
        name + ": missing capture body remains unavailable",
      );
    receipt.facts[name] = {
      status: c.status,
      ...c.replay,
      body_sha256: hash(JSON.stringify(c.body)),
      body_oracle: expectedBody !== undefined ? "PASS" : "UNAVAILABLE",
      untrusted_content: true,
    };
    return c;
  }
  await call("replay-post", post, { body }, true, {
    ...state,
    savedId: state.items[0].id,
  });
  await call(
    "replay-reference",
    source,
    { id: fixture.reference.id },
    true,
    reference,
  );
  await call(
    "replay-query-negative",
    source,
    { id: "unrecorded-negative-source" },
    false,
    reference,
  );
  await call(
    "replay-body-negative",
    post,
    { body: { ...body, text: "UNRECORDED NEGATIVE BODY" } },
    true,
    { ...state, savedId: state.items[0].id },
  );
  await call("replay-missing-candidates", candidate, {}, true, undefined);
  const after = await oracle("oracle-after-replay", 1);
  check(
    after.revision_sha256 === initial.revision_sha256,
    "Offline replay made no filesystem write",
  );
  await unavailable(origin, "Fresh target still stopped");
  await unavailable(
    capture.parameters.start_url.url,
    "Original target still stopped",
  );
  await client.close();
  client = undefined;
  await closeReplay();
  check(
    replay.exit?.code === 143 && replay.exit?.signal === null,
    "Replay server graceful exit143",
  );
  const final = await bindings();
  await save("bindings-after.json", final);
  assert.deepEqual(final, before);
  receipt.checks.push({
    label: "All declared continuation inputs unchanged",
    pass: true,
  });
  receipt.status = "PASS_SELECTED_DIAGNOSTICS_ON_PARTIAL_CAPTURE";
} catch (error) {
  receipt.status = "FAIL";
  receipt.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  if (client)
    await client.close().catch(() => {
      receipt.cleanup.push({ name: "client", error: "close failed" });
    });
  await closeTarget();
  await closeReplay();
  if (
    replay &&
    token &&
    (replay.stdout.includes(token) || replay.stderr.includes(token))
  ) {
    receipt.cleanup.push({ name: "replay", error: "token in local logs" });
  }
  if (receipt.cleanup.some((x) => x.forced || x.error)) {
    receipt.status = "FAIL";
    process.exitCode = 1;
  }
  receipt.completed_at = new Date().toISOString();
  await save("receipt.local.json", receipt);
  console.log(
    JSON.stringify({
      status: receipt.status,
      full_pilot_acceptance: receipt.full_pilot_acceptance,
      checks: receipt.checks.length,
      failure: receipt.failure?.message,
      output: out,
    }),
  );
}
