import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadProbe } from "./probe.mjs";
import {
  readOracle,
  assertSourceInstalled,
  assertNoSourceInstalled,
  assertDirtyPreserved,
} from "./oracle.mjs";

const [componentPath, typescriptPath, packPath, outputDirectory] =
  process.argv.slice(2);
assert.equal(
  process.argv.length,
  6,
  "Usage: node run-checks.mjs COMPONENT_TSX TYPESCRIPT_JS PACK_JSON NEW_OUTPUT_DIR",
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inputPaths = {
  component: componentPath,
  typescript: typescriptPath,
  pack: packPath,
};
async function bindings() {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(inputPaths).map(async ([key, path]) => [
        key,
        sha256(await readFile(path)),
      ]),
    ),
  );
}
const before = await bindings();
assert.equal(
  before.component,
  "3fb2400bc64d676516d08798a715cf3c5d76296d3c3431ed5ddb52d64db04c17",
);
assert.equal(
  before.typescript,
  "3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675",
);
assert.equal(
  before.pack,
  "c9cfc0f66b4c50b7dc6da21b20bf66a82928e12caa3573c869dd2a67849bac17",
);
const expected = await readOracle();
const { dirty: expectedDirty, ...expectedRecordedIntent } = expected.dirtyDraft;
assert.equal(expectedDirty, true);
const recordedPost = JSON.parse(await readFile(packPath)).records.find(
  (record) => record.method === "POST",
);
assert.deepEqual(
  recordedPost.request_body,
  expectedRecordedIntent,
  "the controlled editor differs from recorded intent only by its dirty field; transport still sends the entire editor",
);
const probe = await loadProbe({ componentPath, typescriptPath, packPath });
const cases = [];
async function trial(name, operation) {
  try {
    cases.push({ name, status: "PASS", ...(await operation()) });
  } catch (error) {
    cases.push({ name, status: "FAIL", reason: error.message });
  }
}
const pending = async (scenario, count) => {
  // Bound only microtask scheduling; no sleeps, sockets or external service.
  for (let turn = 0; turn < 20 && scenario.pendingCount() !== count; turn++)
    await Promise.resolve();
  assert.equal(
    scenario.pendingCount(),
    count,
    "actual api reached the controlled response queue",
  );
};

await trial(
  "actual source callback installs exact independent reference",
  async () => {
    const s = probe.newScenario();
    await s.openSource("reference");
    assertSourceInstalled(s.state, expected.source);
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].method, "GET");
    assert.equal(s.calls[0].query, "?id=reference");
    assert.equal(s.state.captureCount, 1);
    assert.equal(s.state.writeCount, 0);
    return { source_sha256: expected.source.revision, calls: s.calls };
  },
);

await trial(
  "older overlapping response cannot replace current source",
  async () => {
    const s = probe.newScenario({ deferred: true });
    const older = s.openSource("reference");
    await pending(s, 1);
    const newer = s.openSource("reference");
    await pending(s, 2);
    await s.flush(0);
    await older;
    assertNoSourceInstalled(s.state);
    assert.equal(
      s.state.loading,
      true,
      "older completion cannot settle the current loading indicator",
    );
    await s.flush(0);
    await newer;
    assertSourceInstalled(s.state, expected.source);
    assert.equal(s.calls.length, 2);
    assert.equal(s.pendingCount(), 0);
    return { requests: 2, source_installations: s.state.sourceUpdates.length };
  },
);

await trial(
  "unknown source query stays refused through actual callback",
  async () => {
    const s = probe.newScenario();
    await s.openSource("unknown");
    assertNoSourceInstalled(s.state);
    assert.match(
      s.state.error,
      /No unique response matches the exact recorded request/u,
    );
    assert.equal(s.state.loading, false);
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].query, "?id=unknown");
    return { decision: "REJECTED", error: s.state.error, calls: s.calls };
  },
);

await trial(
  "actual dirty save is incompatible with the recorded POST intent",
  async () => {
    const draft = structuredClone(expected.dirtyDraft),
      s = probe.newScenario({ draft });
    await assert.rejects(
      s.save(),
      /No unique response matches the exact recorded request/u,
    );
    assertDirtyPreserved(s.state, expected.dirtyDraft);
    assert.equal(s.state.saving, false);
    assert.equal(s.state.pendingSave.current, null);
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].method, "POST");
    assert.deepEqual(
      s.requestBodies[0],
      expected.dirtyDraft,
      "actual serialized POST preserves every independently expected draft value",
    );
    assert.deepEqual(s.calls[0].bodyKeys, [
      "baseRevision",
      "dirty",
      "expectedSequence",
      "sectionId",
      "text",
      "title",
    ]);
    return {
      decision: "UNSUPPORTED_RECORDED_INTENT",
      draft_preserved: true,
      request_body_sha256: sha256(JSON.stringify(s.requestBodies[0])),
      calls: s.calls,
    };
  },
);

await trial(
  "source transition remains closed when preceding dirty save is refused",
  async () => {
    const draft = structuredClone(expected.dirtyDraft),
      s = probe.newScenario({ draft });
    await s.openSource("reference");
    assertDirtyPreserved(s.state, expected.dirtyDraft);
    assert.equal(s.state.loading, false);
    assert.equal(s.calls.length, 1, "no source GET after rejected save");
    assert.equal(s.calls[0].method, "POST");
    assert.deepEqual(s.requestBodies[0], expected.dirtyDraft);
    return {
      decision: "REJECTED",
      source_get_dispatched: false,
      draft_preserved: true,
    };
  },
);

await trial(
  "stale-response oracle detects in-memory generation-guard mutant",
  async () => {
    const s = probe.newScenario({ deferred: true, generationMutant: true });
    const old = s.openSource("reference");
    await pending(s, 1);
    s.invalidate();
    await s.flush(0);
    await old;
    assert.throws(() => assertNoSourceInstalled(s.state), {
      name: "AssertionError",
    });
    assert.equal(
      s.state.sourceUpdates.length,
      1,
      "mutant actually executed its forbidden installation",
    );
    return {
      decision: "EXPECTED_ORACLE_FAILURE",
      mutation: "source-install generation predicate only",
      bindings: s.bindings,
    };
  },
);

const after = await bindings();
assert.deepEqual(
  after,
  before,
  "private component, compiler and pack stay unchanged",
);
const result = {
  schema: "edos-actual-response-consumer-v1",
  scope: "frozen-product-callback-fixture-integration",
  status: cases.every((c) => c.status === "PASS")
    ? "SCOPED_CONSUMER_APPLIED"
    : "FAILED",
  node: process.version,
  cases,
  passed: cases.filter((c) => c.status === "PASS").length,
  total: cases.length,
  input_sha256: before,
  inputs_unchanged: true,
  oracle_fixture_sha256: expected.fixture_sha256,
  probe_bindings: probe.bindings,
  full_capture_acceptance: "FAIL",
  product_source_fix: false,
  new_browser_server_capture_runs: 0,
  limitations: [
    "Actual AST-extracted API/openSource/save callbacks with explicit in-memory dependencies, not a mounted React/DOM/browser workflow.",
    "Source-reading success uses one reference record from the existing three-record pack; it does not qualify every response or endpoint.",
    "Dirty editor POST is refused because its full body differs from the captured request; no fields were stripped and no live save was executed.",
    "Synthetic transport headers and HTTP Response objects do not validate or renew authorization.",
    "The negative mutant exists only in memory for oracle calibration; original product source is unchanged.",
    "Historical full capture FAIL, unknown browser cause, release, team adoption and product effect remain unresolved or unobserved.",
  ],
};
await mkdir(outputDirectory);
await writeFile(
  join(outputDirectory, "RESULTS.json"),
  JSON.stringify(result, null, 2) + "\n",
  { flag: "wx" },
);
console.log(JSON.stringify(result, null, 2));
if (result.status === "FAILED") process.exitCode = 1;
