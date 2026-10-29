// Bounded real CLI/MCP pilot. Inputs are pinned; all outputs are newly owned.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import net from "node:net";
import { assessPilot, targetShutdownPassed } from "./pilot-assessment.mjs";

const [reaArg, edosArg, chromeArg, outArg] = process.argv.slice(2);
assert.equal(
  process.argv.length,
  6,
  "Usage: node run-pilot.mjs REA_CHECKOUT EDOS_MODULE CHROME NEW_OUTPUT",
);
const rea = resolve(reaArg),
  edos = resolve(edosArg),
  chrome = resolve(chromeArg),
  out = resolve(outArg);
const here = dirname(fileURLToPath(import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileHash = async (path) => hash(await readFile(path));
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const save = (name, value) =>
  writeFile(join(out, name), JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
await mkdir(out, { mode: 0o700 });
await mkdir(join(out, "home"), { mode: 0o700 });
await mkdir(join(out, "tmp"), { mode: 0o700 });
const env = {
  PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  HOME: join(out, "home"),
  TMPDIR: join(out, "tmp"),
  LANG: "en_US.UTF-8",
  CI: "1",
  NO_COLOR: "1",
  REA_LOG_LEVEL: "info",
  DO_NOT_TRACK: "1",
  HUSKY: "0",
};
const receipt = {
  schema: "rea-edos-authenticated-pilot-v2",
  started_at: new Date().toISOString(),
  status: "RUNNING",
  node: process.version,
  checks: [],
  commands: [],
  cleanup: [],
  facts: {},
  limitations: [
    "Frozen EdOS module and synthetic data; browser-mediated API actions, not complete product UI.",
    "Evidence identity is an unkeyed semantic hash, not signer authentication.",
    "Offline replay returns recordings; it does not renew auth, execute writes or validate POST body.",
    "Existing baseline compiled runtime; this is not a clean install or a rebuilt fork qualification.",
  ],
};
function check(condition, label) {
  receipt.checks.push({ label, pass: Boolean(condition) });
  assert.ok(condition, label);
}
// Preserve the failed acceptance gate while finishing independent diagnostics.
function acceptance(condition, label) {
  receipt.checks.push({ label, pass: Boolean(condition), gating: true });
}
const owned = [];
function start(name, args, extra = {}) {
  const child = spawn(process.execPath, args, {
    cwd: rea,
    env: { ...env, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const state = {
    name,
    child,
    stdout: "",
    stderr: "",
    error: null,
    timed_out: false,
    start: Date.now(),
  };
  for (const stream of ["stdout", "stderr"])
    child[stream].on("data", (bytes) => {
      state[stream] += bytes.toString();
      if (Buffer.byteLength(state[stream]) > 16 * 1024 * 1024) {
        state.error = "Output budget exceeded";
        child.kill("SIGTERM");
      }
    });
  state.done = new Promise((resolveDone) => {
    child.once("error", (error) => {
      state.error = error.message;
    });
    child.once("close", (code, signal) => {
      state.exit = { code, signal };
      resolveDone(state.exit);
    });
  });
  state.finish = () =>
    (state.finishing ??= (async () => {
      await writeFile(join(out, `${name}.stdout`), state.stdout, {
        flag: "wx",
        mode: 0o600,
      });
      await writeFile(join(out, `${name}.stderr`), state.stderr, {
        flag: "wx",
        mode: 0o600,
      });
      receipt.commands.push({
        name,
        args,
        ...state.exit,
        elapsed_ms: Date.now() - state.start,
        timed_out: state.timed_out,
        error: state.error,
      });
    })());
  owned.push(state);
  return state;
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function settledWithin(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function stop(state) {
  return (state.stopping ??= (async () => {
    if (!state.exit) {
      state.child.kill("SIGTERM");
      await settledWithin(state.done, 10000);
      if (!state.exit) {
        state.child.kill("SIGKILL");
        await settledWithin(state.done, 2000);
        receipt.cleanup.push({
          name: state.name,
          forced: true,
          exit_confirmed: Boolean(state.exit),
          descendants: "unconfirmed after forced termination",
        });
        if (!state.exit) {
          state.child.stdout.destroy();
          state.child.stderr.destroy();
          state.child.unref();
        }
      } else receipt.cleanup.push({ name: state.name, forced: false });
    }
    await state.finish();
  })());
}
async function command(name, args, extra = {}, timeoutMs = 60000) {
  const state = start(name, args, extra);
  if (!(await settledWithin(state.done, timeoutMs))) {
    state.timed_out = true;
    await stop(state);
  }
  await state.finish();
  check(!state.timed_out && state.error === null, `${name}: bounded execution`);
  return { ...state.exit, value: JSON.parse(state.stdout) };
}
async function until(state, read, ms = 25000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = read();
    if (value) return value;
    assert.ok(!state.exit, `${state.name}: exited before ready`);
    await pause(50);
  }
  throw new Error(`${state.name}: readiness deadline`);
}
async function runtimeBindings() {
  const entries = [];
  async function walk(relative) {
    for (const entry of (
      await readdir(join(rea, relative), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile())
        entries.push([path, await fileHash(join(rea, path))]);
      else throw new Error(`Unexpected runtime entry: ${path}`);
    }
  }
  await walk("dist");
  for (const path of [
    "scripts/rea.mjs",
    "scripts/lib/cli-process-environment.mjs",
    "package-lock.json",
    "package.json",
  ])
    entries.push([path, await fileHash(join(rea, path))]);
  return {
    files: entries,
    sha256: hash(JSON.stringify(entries)),
    edos_module_sha256: await fileHash(edos),
    chrome_executable_sha256: await fileHash(chrome),
    harness: await Promise.all(
      [
        "run-pilot.mjs",
        "pilot-assessment.mjs",
        "target.mjs",
        "oracle.mjs",
        "fixture.json",
      ].map(async (p) => [p, await fileHash(join(here, p))]),
    ),
  };
}
let client, session, target, replay;
let controlsCompleted = false;
const fixture = await json(join(here, "fixture.json"));
const before = await runtimeBindings();
await save("bindings-before.json", before);
receipt.facts.runtime_binding_sha256 = before.sha256;
receipt.facts.edos_module_sha256 = before.edos_module_sha256;
const root = join(out, "target-run");
const cli = (...args) => [join(rea, "scripts/rea.mjs"), ...args];
async function oracle(name, expected) {
  const result = await command(name, [
    join(here, "oracle.mjs"),
    root,
    String(expected),
  ]);
  check(
    result.code === 0 && result.value.status === "PASS",
    `${name}: independent filesystem oracle`,
  );
  receipt.facts[name] = result.value;
  return result.value.facts;
}
try {
  check(
    before.edos_module_sha256 ===
      "705e2b4873772e9649bc3b52b445658e10592c1f62b8f79a4f6e191cc841676c",
    "EdOS frozen module pinned",
  );
  target = start("target", [join(here, "target.mjs"), edos, root]);
  const ready = await until(target, () =>
    target.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .find((value) => value?.status === "ready"),
  );
  session = await json(join(root, "session.json"));
  await oracle("oracle-before", 0);
  const body = {
    expectedSequence: 0,
    baseRevision: hash(Buffer.from(fixture.scene_text)),
    sectionId: fixture.section_id,
    title: fixture.candidate.title,
    text: fixture.candidate.text,
  };
  const header = {
    name: "X-Edos-Scene-Client",
    value: { source: "literal", value: "1" },
  };
  const scenario = {
    browser: { mode: "launch", executable_path: chrome, headless: true },
    start_url: { url: `${ready.origin}/` },
    command_timeout_ms: 60000,
    secrets: [
      { secret_id: "edos_session", environment_variable: "EDOS_PILOT_TOKEN" },
    ],
    actions: [
      {
        step_id: "ready",
        action: "wait_for",
        locator: { kind: "css", selector: "#ready" },
        state: "visible",
        timeout_ms: 10000,
      },
      {
        step_id: "save",
        action: "request",
        method: "POST",
        path: "/api/scene-workspace/candidates",
        headers: [
          header,
          {
            name: "X-Edos-Scene-Token",
            value: { source: "local_storage", key: "rea-pilot-auth" },
          },
        ],
        json: body,
        expected_status: [200],
        timeout_ms: 10000,
      },
      {
        step_id: "read-saved",
        action: "request",
        method: "GET",
        path: "/api/scene-workspace/candidates",
        headers: [header],
        expected_status: [200],
        timeout_ms: 10000,
      },
      {
        step_id: "read-source",
        action: "request",
        method: "GET",
        path: "/api/scene-workspace/source",
        query: [
          {
            name: "id",
            value: { source: "literal", value: fixture.reference.id },
          },
        ],
        headers: [header],
        expected_status: [200],
        timeout_ms: 10000,
      },
    ],
    capture: {
      at_end: ["dom", "url"],
      events: ["network"],
      network: {
        request_body: true,
        response_body: true,
        header_values: false,
      },
    },
  };
  await save("scenario.json", scenario);
  const captured = await command(
    "capture",
    cli("capture-browser-scenario", join(out, "scenario.json"), "--json"),
    { EDOS_PILOT_TOKEN: session.token, DEBUG: "pw:browser" },
    180000,
  );
  const evidence = captured.value;
  check(
    captured.code === 0 && evidence.operation === "capture_browser_scenario",
    "Actual CLI browser capture Evidence returned",
  );
  acceptance(
    evidence.normalized_result.completeness.status === "complete",
    "Requested capture complete",
  );
  receipt.facts.capture_completeness = evidence.normalized_result.completeness;
  check(
    JSON.stringify(
      evidence.normalized_result.steps.map((step) => step.step_id),
    ) ===
      JSON.stringify([
        "scenario_start",
        "ready",
        "save",
        "read-saved",
        "read-source",
      ]),
    "All five declared capture steps retained",
  );
  check(
    evidence.normalized_result.steps.every(
      (step) => step.status === "completed",
    ),
    "All browser actions completed",
  );
  check(
    evidence.normalized_result.browser.cleanup === "terminated-owned-process",
    "REA reports owned browser termination",
  );
  check(
    !JSON.stringify(evidence).includes(session.token),
    "Declared ephemeral token absent from captured Evidence",
  );
  check(
    evidence.normalized_result.events.items
      .filter(
        (event) =>
          event.kind === "network-content" && event.body.state === "captured",
      )
      .every(
        (event) =>
          !Buffer.from(
            event.body.content,
            event.body.encoding === "base64" ? "base64" : "utf8",
          )
            .toString("utf8")
            .includes(session.token),
      ),
    "Declared token absent from decoded retained network bodies",
  );
  await save("capture.json", evidence);
  receipt.facts.capture_id = evidence.evidence_id;
  receipt.facts.browser = evidence.normalized_result.browser;
  receipt.facts.capture_limits = evidence.normalized_result.limitations;
  const afterCapture = await oracle("oracle-after-capture", 1);
  const calibration = await command("oracle-negative-calibration", [
    join(here, "oracle.mjs"),
    root,
    "0",
  ]);
  check(
    calibration.code === 1 &&
      calibration.value.status === "FAIL" &&
      calibration.value.failure ===
        "exact revision set with no pending or extra files",
    "Independent oracle rejects a false empty-state expectation",
  );
  receipt.facts.oracle_negative_calibration = {
    exit: calibration.code,
    status: calibration.value.status,
    failed_check: calibration.value.failure,
  };
  const state = await json(
    join(root, "data", "scene-candidates", fixture.scene_id, "00000001.json"),
  );
  const reference = {
    id: fixture.reference.id,
    title: fixture.reference.title,
    file: "reference.txt",
    revision: hash(Buffer.from(fixture.reference.text)),
    text: fixture.reference.text,
  };
  async function live(name, token, input, expected) {
    const response = await fetch(
      `${session.origin}/api/scene-workspace/candidates`,
      {
        method: "POST",
        headers: {
          Origin: session.origin,
          "Content-Type": "application/json",
          "X-Edos-Scene-Client": "1",
          "X-Edos-Scene-Token": token,
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(5000),
      },
    );
    const value = await response.json();
    await save(`${name}.json`, { status: response.status, body: value });
    check(response.status === expected, `${name}: HTTP ${expected}`);
    const files = await oracle(`oracle-${name}`, 1);
    check(
      files.revision_sha256 === afterCapture.revision_sha256,
      `${name}: committed revision unchanged`,
    );
    receipt.facts[name] = { status: response.status, unchanged_revision: true };
  }
  await live(
    "wrong-token",
    "negative-control-token-not-valid",
    { ...body, expectedSequence: 1 },
    403,
  );
  await live("stale-sequence", session.token, body, 409);
  const source404 = await fetch(
    `${session.origin}/api/scene-workspace/source?id=unrecorded-negative-source`,
    {
      headers: { "X-Edos-Scene-Client": "1" },
      signal: AbortSignal.timeout(5000),
    },
  );
  check(source404.status === 404, "Live unrecorded source query returns 404");
  await save("live-source-negative.json", {
    status: source404.status,
    body: await source404.json(),
  });
  await stop(target);
  receipt.facts.target_exit = target.exit ?? null;
  check(
    targetShutdownPassed(target.exit),
    "Target exits cleanly with code 0 and no signal",
  );
  async function targetUnavailable() {
    const address = new URL(session.origin);
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
    receipt.facts.listener_probes.push(result);
    check(
      result === "ECONNREFUSED",
      "Original target connection refused during offline replay",
    );
  }
  await targetUnavailable();
  const request = {
    source: {
      kind: "evidence-file",
      path: join(out, "capture.json"),
      evidence_id: evidence.evidence_id,
    },
    view: { kind: "environment-manifest", template_rules: [] },
  };
  await save("manifest-request.json", request);
  const projected = await command(
    "manifest",
    cli("inspect-analysis-view", join(out, "manifest-request.json"), "--json"),
  );
  check(
    projected.code === 0 && typeof projected.value.evidence_id === "string",
    "Public authenticated Evidence projection succeeds",
  );
  const manifest = projected.value;
  await save("manifest.json", manifest);
  receipt.facts.manifest_id = manifest.evidence_id;
  const tampered = structuredClone(evidence);
  tampered.normalized_result.duration_ms += 1;
  await save("tampered-capture.json", tampered);
  await save("tamper-request.json", {
    ...request,
    source: { ...request.source, path: join(out, "tampered-capture.json") },
  });
  const rejected = await command(
    "tamper",
    cli("inspect-analysis-view", join(out, "tamper-request.json"), "--json"),
  );
  check(
    rejected.code === 1 &&
      rejected.value.code === "invalid_request" &&
      JSON.stringify(rejected.value).includes("evidence_id"),
    "Semantic tamper rejected by public Evidence consumer",
  );
  receipt.facts.tamper = {
    code: rejected.value.code,
    evidence_id_issue: true,
    cli_exit: rejected.code,
  };
  replay = start(
    "replay-server",
    cli(
      "environment-serve",
      join(out, "manifest.json"),
      "--evidence",
      join(out, "capture.json"),
      "--replay-only",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--json",
    ),
  );
  const listening = await until(replay, () =>
    replay.stderr
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .find((line) => line?.msg === "MCP transport listening" && line.url),
  );
  const require = createRequire(join(rea, "package.json"));
  const {
    Client,
    StreamableHTTPClientTransport,
  } = require("@modelcontextprotocol/client");
  client = new Client({ name: "edos-bounded-replay-pilot", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(listening.url)),
  );
  const catalog = await client.listTools();
  await save("mcp-catalog.json", catalog);
  const select = (method, path) => {
    const tool = manifest.normalized_result.tools.find(
      (t) => t.method === method && t.path_template === path,
    );
    assert.ok(tool, `Manifest tool ${method} ${path}`);
    assert.ok(
      catalog.tools.some((t) => t.name === tool.name),
      "Manifest tool advertised by actual MCP",
    );
    return tool;
  };
  const post = select("POST", "/api/scene-workspace/candidates");
  const read = select("GET", "/api/scene-workspace/candidates");
  const source = select("GET", "/api/scene-workspace/source");
  async function call(name, tool, args, exact, expectedBody) {
    const result = await client.callTool({ name: tool.name, arguments: args });
    await save(`${name}.json`, result);
    const content = result.structuredContent;
    check(
      !result.isError && content?.status === 200,
      `${name}: recorded HTTP 200`,
    );
    check(
      content.replay.exact_match === exact &&
        content.replay.evidence_id === evidence.evidence_id &&
        tool.record_ordinals.includes(content.replay.record_ordinal),
      `${name}: expected match and source binding`,
    );
    acceptance(
      content.replay.body_recorded && !content.replay.truncated,
      `${name}: full recorded body`,
    );
    check(
      result._meta?.provenance?.untrusted_content === true,
      `${name}: target-content trust marker`,
    );
    if (content.replay.body_recorded && !content.replay.truncated) {
      assert.deepEqual(
        content.body,
        expectedBody,
        `${name}: independent filesystem/fixture oracle`,
      );
      receipt.checks.push({
        label: `${name}: independent expected body`,
        pass: true,
      });
    } else {
      check(
        content.replay.body_recorded === false && content.body === null,
        `${name}: absent body stays unavailable without backfill`,
      );
    }
    receipt.facts[name] = {
      status: content.status,
      ...content.replay,
      body_sha256: hash(JSON.stringify(content.body)),
      body_oracle: content.replay.body_recorded ? "PASS" : "UNAVAILABLE",
      untrusted_content: true,
    };
    return content;
  }
  await call("replay-post", post, { body }, true, {
    ...state,
    savedId: state.items[0].id,
  });
  await call("replay-candidates", read, {}, true, state);
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
  const afterReplay = await oracle("oracle-after-replay", 1);
  check(
    afterReplay.revision_sha256 === afterCapture.revision_sha256,
    "Offline replay left committed revision unchanged",
  );
  await targetUnavailable();
  await client.close();
  client = undefined;
  await stop(replay);
  check(
    replay.exit.code === 143 && replay.exit.signal === null,
    "Replay server graceful SIGTERM exit",
  );
  const after = await runtimeBindings();
  check(
    (await fileHash(join(root, "target", "scene-workspace.mjs"))) ===
      before.edos_module_sha256,
    "Executed EdOS copy remains identical to pinned source",
  );
  await save("bindings-after.json", after);
  assert.deepEqual(
    after,
    before,
    "Runtime, harness, browser executable and EdOS module stayed unchanged",
  );
  receipt.checks.push({
    label: "All declared input bytes unchanged",
    pass: true,
  });
  controlsCompleted = true;
} catch (error) {
  receipt.failure = { message: error.message, stack: error.stack };
} finally {
  if (client)
    await client.close().catch(() => {
      receipt.cleanup.push({ name: "mcp-client", error: "close failed" });
    });
  for (const state of owned)
    await stop(state).catch((error) => {
      receipt.cleanup.push({ name: state.name, error: String(error) });
    });
  if (session) {
    for (const state of owned)
      if (
        state.stdout.includes(session.token) ||
        state.stderr.includes(session.token)
      ) {
        receipt.cleanup.push({ name: state.name, token_in_local_log: true });
      }
    await unlink(join(root, "session.json")).then(
      () =>
        receipt.cleanup.push({ name: "private-session-file", removed: true }),
      (error) =>
        receipt.cleanup.push({
          name: "private-session-file",
          removed: false,
          error: String(error),
        }),
    );
  }
  const assessment = assessPilot({
    checks: receipt.checks,
    cleanup: receipt.cleanup,
    failure: receipt.failure,
    controlsCompleted,
    targetExit: target?.exit,
  });
  receipt.status = assessment.status;
  receipt.full_acceptance = assessment.full_acceptance;
  process.exitCode = assessment.exit_code;
  receipt.completed_at = new Date().toISOString();
  await save("receipt.local.json", receipt);
  console.log(
    JSON.stringify({
      status: receipt.status,
      checks: receipt.checks.length,
      failure: receipt.failure?.message,
      output: out,
    }),
  );
}
