import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertCaseEvidence } from "./oracle.mjs";
const [directory] = process.argv.slice(2);
assert.equal(process.argv.length, 3);
const summary = JSON.parse(await readFile(join(directory, "SUMMARY.json")));
const names = summary.cells.map((cell) => cell.case_id);
assert.ok(names.length > 0 && names.length <= 4);
assert.equal(new Set(names).size, names.length);
for (const name of names)
  assert.ok(
    ["no-context", "one-empty", "two-empty", "two-blank"].includes(name),
  );
const raw = await Promise.all(
  names.map((name) => readFile(join(directory, name + ".json"))),
);
const records = raw.map((bytes) => JSON.parse(bytes));
const positives = records.map(assertCaseEvidence);
const reference = records.find(
  (record) => record.api_close?.operation_status === "fulfilled",
);
assert.ok(
  reference,
  "A measured fulfilled close is required for this calibration",
);
const control = structuredClone(reference);
assert.equal(control.api_close.operation_status, "fulfilled");
if (control.api_close.settle_duration_ms <= 10000) {
  control.api_close.settle_duration_ms = 10001;
  control.api_close.settled_at_ms = control.api_close.started_at_ms + 10001;
  control.api_close.observed_duration_ms = 10001;
  control.api_close.within_deadline = false;
}
control.claims.timely_close = "PASS";
const reject = (record, label) =>
  assert.throws(
    () => assertCaseEvidence(record),
    (error) => error.name === "AssertionError" && error.message.includes(label),
  );
reject(control, "CLOSE_DEADLINE_CLAIM_MISMATCH");
const foreign = structuredClone(records[0]);
foreign.ownership.browser_process.run_id = "foreign-control-run";
reject(foreign, "OWNER_RUN_ID_MISMATCH");
const recheck = await Promise.all(
  names.map((name) => readFile(join(directory, name + ".json"))),
);
raw.forEach((bytes, i) => assert.deepEqual(recheck[i], bytes));
const receipt = {
  schema: "browser-close-calibration-v1",
  status: "PASS_RECORD_CONSISTENCY_AND_TWO_NEGATIVE_CONTROLS",
  positive_records: positives,
  controls: [
    { label: "CLOSE_DEADLINE_CLAIM_MISMATCH", rejected: true },
    { label: "OWNER_RUN_ID_MISMATCH", rejected: true },
  ],
  new_browser_launches: 0,
  new_product_writes: 0,
  originals_unchanged: true,
  input_sha256: Object.fromEntries(
    raw.map((bytes, i) => [
      names[i],
      createHash("sha256").update(bytes).digest("hex"),
    ]),
  ),
};
await writeFile(
  join(directory, "CALIBRATION.json"),
  JSON.stringify(receipt, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
process.stdout.write(JSON.stringify(receipt) + "\n");
