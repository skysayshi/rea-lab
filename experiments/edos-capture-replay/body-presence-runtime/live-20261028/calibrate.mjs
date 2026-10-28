// Trusted pinned baseline only. No browser/server launch; mutations stay in memory.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

const [baseline, runDirectory] = process.argv.slice(2);
assert.equal(
  process.argv.length,
  4,
  "Usage: node calibrate.mjs ABS_BASELINE ABS_RUN",
);
assert.ok(isAbsolute(baseline) && isAbsolute(runDirectory));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const harness = join(baseline, "scripts/lib/browser-presence-e2e.mjs");
assert.equal(
  hash(await readFile(harness)),
  "9b6c67d8b5dbb734f13a95436b035877ceee3c312424cf4050e461616a1fba25",
);
const { assertPresenceCapture } = await import(pathToFileURL(harness).href);
const files = ["CAPTURE.json", "SERVER.json", "SCENARIO.json"];
const readArtifacts = async () =>
  Object.fromEntries(
    await Promise.all(
      files.map(async (name) => [
        name,
        await readFile(join(runDirectory, name)),
      ]),
    ),
  );
const before = await readArtifacts();
const capture = JSON.parse(before["CAPTURE.json"]);
const receipts = JSON.parse(before["SERVER.json"]);
const scenario = JSON.parse(before["SCENARIO.json"]);
const origin = new URL(scenario.start_url.url).origin;
assert.equal(capture.completeness.equality_eligible, false);
const positive = assertPresenceCapture(capture, receipts, origin);

const controls = [];
function rejectsAtOracle(
  name,
  alteredCapture,
  alteredReceipts,
  { actual, expected },
) {
  let observed;
  try {
    assertPresenceCapture(alteredCapture, alteredReceipts, origin);
  } catch (error) {
    observed = error;
  }
  assert.ok(
    observed instanceof assert.AssertionError,
    `${name}: oracle must reject`,
  );
  assert.match(observed.stack, /at assertPresenceCapture/u);
  assert.equal(observed.actual, actual);
  assert.equal(observed.expected, expected);
  controls.push({
    name,
    status: "EXPECTED_ORACLE_REJECTION",
    actual,
    expected,
    error_code: observed.code,
  });
}
const promoted = structuredClone(capture);
const disabled = promoted.events.items.filter(
  (event) =>
    event.kind === "request-body-presence" &&
    event.presence.observation.status === "disabled",
);
assert.equal(disabled.length, 1);
disabled[0].presence.state = "present";
rejectsAtOracle(
  "disabled observer falsely promoted",
  promoted,
  structuredClone(receipts),
  { actual: "present", expected: "unknown" },
);

const corrupted = structuredClone(receipts);
const unicode = corrupted.filter((receipt) => receipt.case_id === "present");
assert.equal(unicode.length, 1);
const expectedPayload = unicode[0].body_base64;
unicode[0].body_base64 = Buffer.from("X").toString("base64");
assert.notEqual(unicode[0].body_base64, expectedPayload);
rejectsAtOracle(
  "receiver payload corrupted",
  structuredClone(capture),
  corrupted,
  { actual: unicode[0].body_base64, expected: expectedPayload },
);

assertPresenceCapture(capture, receipts, origin);
const after = await readArtifacts();
assert.deepEqual(after, before, "raw artifacts remain unchanged");
const result = {
  schema: "rea-body-presence-oracle-calibration-v1",
  status: "PASS",
  positive_recorded_cases: positive.cases.length,
  live_control:
    "disabled observer remains unknown despite delivered nonempty payload",
  controls,
  new_browser_runs: 0,
  raw_sha256: Object.fromEntries(
    Object.entries(before).map(([name, bytes]) => [name, hash(bytes)]),
  ),
  originals_unchanged: true,
  historical_full_capture_acceptance: "FAIL",
};
await writeFile(
  join(runDirectory, "CALIBRATION.json"),
  JSON.stringify(result, null, 2) + "\n",
  { flag: "wx" },
);
console.log(JSON.stringify(result));
