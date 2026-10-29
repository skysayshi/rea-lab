// Offline verification of one immutable synthetic observation; never launches a browser.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { browserScenarioSchema } from "../../../dist/domain/browserScenario.js";
import { browserScenarioCaptureSchema } from "../../../dist/domain/browserScenarioCapture.js";
import { parseEvidence } from "../../../dist/domain/evidence.js";
import { assertPresenceCapture } from "../../../scripts/lib/browser-presence-e2e.mjs";

const pins = {
  "CAPTURE.json":
    "fde28e64ed51253d967a9c957a815e9995577715f805e1dd317d9949ba09bc7d",
  "EVIDENCE.json":
    "90c15e165eb8d39c16fac8d83a4cadda164f2d3c4d405a1d25cdfaf5376744b6",
  "SERVER.json":
    "38a6e7dd7571605885026bfa3a979e46a52ee27ab8fb9dd0857f94ea5fbaaf59",
  "SCENARIO.json":
    "149c9022e4251b44bc32e13270a63cf0898a2b55b7fe8bc5f473e33abdff6ea2",
};
const artifacts = {};
for (const [name, pin] of Object.entries(pins)) {
  const bytes = await readFile(
    new URL(`./historical/${name}`, import.meta.url),
  );
  assert.equal(createHash("sha256").update(bytes).digest("hex"), pin, name);
  artifacts[name] = JSON.parse(bytes);
}
const scenario = browserScenarioSchema.parse(artifacts["SCENARIO.json"]);
const parsed = parseEvidence(artifacts["EVIDENCE.json"]);
const capture = browserScenarioCaptureSchema.parse(artifacts["CAPTURE.json"]);
assert.deepEqual(parsed.normalized_result, artifacts["CAPTURE.json"]);
assert.equal(capture.completeness.equality_eligible, false);
const checked = assertPresenceCapture(
  capture,
  artifacts["SERVER.json"],
  new URL(scenario.start_url.url).origin,
);
console.log(
  JSON.stringify({
    status: "PASS_RECORDED_ARTIFACTS",
    new_browser_runs: 0,
    capture_sha256: pins["CAPTURE.json"],
    cases: checked.cases.map(({ case_id, state, receiver_bytes }) => ({
      case_id,
      state,
      receiver_bytes,
    })),
    completeness: capture.completeness,
    historical_full_capture_acceptance: "FAIL",
  }),
);
