import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProcessObserver } from "./process-observer.mjs";
import { assertCaseEvidence } from "./oracle.mjs";

const [executable, output] = process.argv.slice(2);
assert.equal(
  process.argv.length,
  4,
  "Usage: node diagnose.mjs ABS_CHROME NEW_OUTPUT",
);
assert.ok([executable, output].every(isAbsolute));
assert.equal(process.version, "v24.22.1");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const configurations = [
  { case_id: "no-context", contexts: 0, pages_per_context: 0 },
  { case_id: "one-empty", contexts: 1, pages_per_context: 0 },
  { case_id: "two-empty", contexts: 2, pages_per_context: 0 },
  { case_id: "two-blank", contexts: 2, pages_per_context: 1 },
];
await mkdir(output, { mode: 0o700 });
const executionRoot = await mkdtemp(join(tmpdir(), "rea-close-ownership-"));
const records = [];
const phases = [
  ["<launched> pid=", "launched"],
  ["<gracefully close start>", "graceful_start"],
  ["<process did exit:", "node_child_close"],
  ["starting temporary directories cleanup", "temp_cleanup_start"],
  ["finished temporary directories cleanup", "temp_cleanup_end"],
  ["<gracefully close end>", "graceful_end"],
  ["<will force kill>", "sdk_force_kill"],
  ['"id":-9999', "close_protocol_reply"],
];
const save = (name, value) =>
  writeFile(join(output, name), JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });

function subscribe(stream, file, lineHandler, budget) {
  let buffered = "",
    bytes = 0;
  stream.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > 32 * 1024 * 1024) budget();
    writeFileSync(file, chunk, { flag: "a", mode: 0o600 });
    buffered += chunk.toString("utf8");
    const lines = buffered.split("\n");
    buffered = lines.pop();
    for (const line of lines) lineHandler(line);
  });
  stream.on("end", () => {
    if (buffered) lineHandler(buffered);
  });
}
function spawnCase(configuration, directory, runId) {
  return spawn(
    process.execPath,
    [
      fileURLToPath(new URL("./cell.mjs", import.meta.url)),
      executable,
      directory,
      runId,
      JSON.stringify(configuration),
    ],
    {
      env: {
        ...process.env,
        TMPDIR: join(directory, "tmp"),
        DEBUG: "pw:browser,pw:protocol",
        DEBUG_COLORS: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
}

function scheduleSafety({ child, owner, stop, interventions }) {
  const sampler = setInterval(() => owner.sample(), 1000);
  const watchdog = setTimeout(
    () => stop("90-second outer safety bound"),
    90000,
  );
  const hardStop = setTimeout(() => {
    if (child.exitCode === null) {
      stop("95-second verified owner recovery");
      try {
        owner.verifiedSignal("SIGKILL");
      } catch (error) {
        interventions.push({
          at_ms: performance.now(),
          reason: "Verified recovery refused",
          message: error.message,
        });
      }
      child.kill("SIGKILL");
    }
  }, 95000);
  return () => {
    clearInterval(sampler);
    clearTimeout(watchdog);
    clearTimeout(hardStop);
  };
}

async function collectRecord({
  configuration,
  runId,
  directory,
  retained,
  owner,
  exit,
  events,
  debugPhases,
  parseErrors,
  interventions,
  childError,
}) {
  const finalSample = owner.sample(),
    identity = owner.result();
  const childPath = join(directory, "child-result.json");
  const value = existsSync(childPath)
    ? JSON.parse(readFileSync(childPath))
    : null;
  if (value)
    await writeFile(
      join(retained, "child-result.local.json"),
      readFileSync(childPath),
      { flag: "wx" },
    );
  const remaining = await readdir(join(directory, "tmp"));
  const profiles = remaining.filter((name) =>
    name.startsWith("playwright_chromiumdev_profile-"),
  );
  const artifacts = remaining.filter((name) =>
    name.startsWith("playwright-artifacts-"),
  );
  const ownerError =
    [
      ...identity.errors,
      ...parseErrors,
      ...(childError ? [childError] : []),
    ].join("; ") || null;
  const owned = finalSample.owned_processes?.length ?? null;
  const release =
    ownerError || !identity.browserIdentity.identity_validated || owned === null
      ? "UNKNOWN"
      : owned === 0 && profiles.length === 0 && artifacts.length === 0
        ? "PASS"
        : "FAIL";
  const api = value?.api_close;
  const timing = !api
    ? "UNKNOWN"
    : api.operation_status !== "fulfilled" || !api.within_deadline
      ? "FAIL"
      : api.observer_errors.length
        ? "UNKNOWN"
        : "PASS";
  const record = {
    schema: "browser-close-timing-case-v1",
    run_id: runId,
    case_id: configuration.case_id,
    configuration: {
      contexts: configuration.contexts,
      pages_per_context: configuration.pages_per_context,
    },
    api_close: api ?? null,
    events,
    debug_phases: debugPhases,
    context_setup_complete: value?.context_setup_complete ?? false,
    child_failure: value?.failure ?? null,
    browser_version: value?.browser_version ?? null,
    ownership: {
      run_id: runId,
      child_process: {
        ...identity.childIdentity,
        exited: true,
        exit_code: exit.code,
        signal: exit.signal,
      },
      browser_process: identity.browserIdentity,
      final: {
        run_id: runId,
        owned_processes: owned,
        profile_dirs_present: profiles,
        artifact_dirs_present: artifacts,
        sampler_error: ownerError,
      },
    },
    claims: { timely_close: timing, release },
    interventions,
    process_samples: identity.samples,
    tracked_processes: identity.tracked_processes,
    raw_log_sha256: Object.fromEntries(
      ["stdout.log", "stderr.log"].map((name) => [
        name,
        hash(readFileSync(join(retained, name))),
      ]),
    ),
    result_observation:
      "API timestamps are child monotonic; debug phases and process samples are parent receipt/observation times, not exact cross-stream causality",
  };
  return record;
}

async function cell(configuration) {
  const runId = randomUUID(),
    directory = join(executionRoot, configuration.case_id);
  const retained = join(output, configuration.case_id);
  await mkdir(directory);
  await mkdir(join(directory, "tmp"));
  await mkdir(retained);
  await writeFile(
    join(directory, "owner.json"),
    JSON.stringify({ run_id: runId }),
    { flag: "wx" },
  );
  const child = spawnCase(configuration, directory, runId);
  const owner = createProcessObserver({ runId, root: directory, child });
  const events = [],
    debugPhases = [],
    parseErrors = [],
    interventions = [];
  let exit, childError;
  const stop = (reason) => {
    interventions.push({ at_ms: performance.now(), reason });
    if (child.exitCode === null) child.kill("SIGTERM");
  };
  subscribe(
    child.stdout,
    join(retained, "stdout.log"),
    (line) => {
      try {
        events.push({ ...JSON.parse(line), received_at_ms: performance.now() });
      } catch {
        parseErrors.push("Invalid diagnostic JSON event");
      }
    },
    () => stop("stdout byte budget"),
  );
  subscribe(
    child.stderr,
    join(retained, "stderr.log"),
    (line) => {
      owner.observeLaunch(line);
      for (const [needle, phase] of phases) {
        if (line.includes(needle))
          debugPhases.push({
            phase,
            received_at_ms: performance.now(),
            raw_line_sha256: hash(line),
          });
      }
      if (line.includes("<launched> pid=")) owner.sample();
    },
    () => stop("stderr byte budget"),
  );
  const stopSafety = scheduleSafety({ child, owner, stop, interventions });
  child.once("error", (error) => {
    childError = error.message;
  });
  await new Promise((done) =>
    child.once("close", (code, signal) => {
      exit = { code, signal };
      done();
    }),
  );
  stopSafety();
  const record = await collectRecord({
    configuration,
    runId,
    directory,
    retained,
    owner,
    exit,
    events,
    debugPhases,
    parseErrors,
    interventions,
    childError,
  });
  const { timely_close: timing, release } = record.claims;
  try {
    record.oracle = assertCaseEvidence(record);
  } catch (error) {
    record.oracle_error = { name: error.name, message: error.message };
  }
  record.overall =
    timing === "UNKNOWN" || release === "UNKNOWN"
      ? "UNKNOWN"
      : timing === "PASS" &&
          release === "PASS" &&
          record.context_setup_complete &&
          interventions.length === 0 &&
          !record.child_failure &&
          !record.oracle_error
        ? "PASS"
        : "FAIL";
  const removable =
    release === "PASS" &&
    (await realpath(directory)).startsWith(
      (await realpath(executionRoot)) + "/",
    );
  if (removable) await rm(directory, { recursive: true, force: false });
  else record.retained_local_execution_directory = directory;
  await save(configuration.case_id + ".json", record);
  return record;
}

try {
  for (const configuration of configurations) {
    const record = await cell(configuration);
    records.push(record);
    process.stdout.write(
      JSON.stringify({
        case_id: record.case_id,
        claims: record.claims,
        duration_ms: record.api_close?.settle_duration_ms,
        interventions: record.interventions.length,
      }) + "\n",
    );
    if (record.claims.release !== "PASS") break;
  }
} finally {
  const remaining = await readdir(executionRoot);
  if (remaining.length === 0)
    await rm(executionRoot, { recursive: true, force: false });
  await save("SUMMARY.json", {
    schema: "browser-close-matrix-v1",
    cells: records.map(
      ({
        case_id,
        claims,
        api_close,
        context_setup_complete,
        interventions,
      }) => ({
        case_id,
        claims,
        api_close,
        context_setup_complete,
        interventions,
      }),
    ),
    EdOS_imports: 0,
    EdOS_writes: 0,
    native_browser_launches: records.filter(
      (record) => record.ownership.browser_process.launch_log_observed,
    ).length,
    cells_attempted: records.length,
    requested_cells: configurations.length,
    diagnostic_status:
      records.length === configurations.length &&
      records.every(
        (record) => record.claims.release === "PASS" && !record.oracle_error,
      )
        ? "OBSERVATIONS_COMPLETE"
        : "PARTIAL_OBSERVATIONS",
    remaining_execution_directories: remaining,
    local_execution_root: remaining.length ? executionRoot : null,
  });
}
