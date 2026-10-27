import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  loadProducer,
  readPinnedInputs,
  qualify,
  sha256,
} from "./preflight.mjs";
import { selectRecordedResponse } from "./consumer.mjs";

const [reaRoot, pinsPath, expectedPinsSha256, outputDirectory] =
  process.argv.slice(2);
if (process.argv.length !== 6)
  throw new Error(
    "Usage: node calibrate.mjs REA_ROOT PINS_JSON PINS_SHA NEW_OUTPUT_DIRECTORY",
  );
const checks = [];
function check(name, condition) {
  checks.push({ name, pass: Boolean(condition) });
  if (!condition) throw new Error(name);
}
const jsonBytes = (value) => Buffer.from(JSON.stringify(value));
async function sourceBinding() {
  const git = (...args) =>
    execFileSync("git", args, { cwd: reaRoot, encoding: "utf8" }).trim();
  const files = git(
    "ls-files",
    "-z",
    "--",
    "src",
    "scripts",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  const hashes = await Promise.all(
    files.map(async (f) => [f, sha256(await readFile(join(reaRoot, f)))]),
  );
  return {
    head: git("rev-parse", "HEAD"),
    tracked_source_diff: git(
      "diff",
      "HEAD",
      "--",
      "src",
      "scripts",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
    ),
    files: files.length,
    sha256: sha256(JSON.stringify(hashes)),
  };
}
const before = await sourceBinding();
check(
  "pinned producer HEAD and tracked source unchanged",
  before.head === "669e617eec5422ebce1ab271af0fc7b51e90dc11" &&
    before.tracked_source_diff === "",
);
const pinsBytes = await readFile(pinsPath);
check(
  "external raw input-pins SHA matches",
  sha256(pinsBytes) === expectedPinsSha256,
);
const pins = JSON.parse(pinsBytes),
  producer = await loadProducer(reaRoot);
check(
  "exact known corpus is present",
  isDeepStrictEqual(
    pins.cases.map((c) => c.id),
    ["v010", "v011", "v012"],
  ),
);
const loaded = await Promise.all(
  pins.cases.map(async (spec) => ({ spec, raw: await readPinnedInputs(spec) })),
);
const outcomes = loaded.map(({ spec, raw }) => ({
  id: spec.id,
  ...qualify(spec, raw, producer),
}));
check(
  "v010 rejects missing candidates response",
  outcomes[0].status === "REJECTED" &&
    outcomes[0].reason === "RESPONSE_WHOLE:candidates",
);
check(
  "v011 rejects missing reference response",
  outcomes[1].status === "REJECTED" &&
    outcomes[1].reason === "RESPONSE_WHOLE:reference",
);
check(
  "v012 qualifies exactly three historical responses",
  outcomes[2].status === "QUALIFIED_RESPONSE_SUBSET" &&
    outcomes[2].pack.records.length === 3,
);
const { spec, raw } = loaded[2];
const negatives = [];
function mutation(name, mutate, expectedReason) {
  const s = structuredClone(spec),
    r = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, Buffer.from(v)]),
    );
  const replace = (key, value, repin = true) => {
    r[key] = jsonBytes(value);
    if (repin) s.files[key].sha256 = sha256(r[key]);
  };
  mutate(s, r, replace);
  const result = qualify(s, r, producer);
  check(
    name,
    result.status === "REJECTED" &&
      (expectedReason
        ? result.reason === expectedReason
        : !result.reason.startsWith("RAW_PIN")),
  );
  negatives.push({
    name,
    decision: result.status,
    reason:
      expectedReason ?? "producer semantic validation refused altered evidence",
    repinned_for_inner_guard_test: !result.reason.startsWith("RAW_PIN"),
  });
}
mutation(
  "raw artifact mutation refused",
  (_s, _r, set) => set("reference", {}, false),
  "RAW_PIN:reference",
);
mutation(
  "semantically unchanged reserialization still needs external raw pin",
  (_s, _r, set) => set("capture", JSON.parse(raw.capture), false),
  "RAW_PIN:capture",
);
mutation(
  "wrong externally expected evidence ID refused",
  (s) => {
    s.capture_evidence_id = "ev_" + "0".repeat(64);
  },
  "CAPTURE_ID",
);
mutation(
  "authentic manifest from another capture refused",
  (s, _r, set) => {
    set("manifest", JSON.parse(loaded[1].raw.manifest));
    s.manifest_evidence_id = loaded[1].spec.manifest_evidence_id;
  },
  "SOURCE_PAIR",
);
mutation(
  "semantic evidence tamper refused even with calibrated raw repin",
  (_s, _r, set) => {
    const c = JSON.parse(raw.capture);
    c.normalized_result.duration_ms += 1;
    set("capture", c);
  },
);
mutation(
  "truncated recorded MCP reply refused",
  (_s, _r, set) => {
    const r = JSON.parse(raw.reference);
    r.structuredContent.replay.truncated = true;
    set("reference", r);
  },
  "REPLAY_BINDING:reference",
);
mutation(
  "MCP error envelope refused",
  (_s, _r, set) => {
    const r = JSON.parse(raw.reference);
    r.isError = true;
    set("reference", r);
  },
  "REPLAY_BINDING:reference",
);
mutation(
  "missing recorded MCP body refused",
  (_s, _r, set) => {
    const r = JSON.parse(raw.reference);
    r.structuredContent.body = null;
    set("reference", r);
  },
  "RESPONSE_ORACLE:reference",
);
mutation(
  "wrong response oracle content refused",
  (_s, _r, set) => {
    const r = JSON.parse(raw.reference);
    r.structuredContent.body.text = "different";
    set("reference", r);
  },
  "RESPONSE_ORACLE:reference",
);
mutation(
  "wrong filesystem revision refused",
  (_s, _r, set) => {
    const v = JSON.parse(raw.revision);
    v.items[0].text = "different";
    set("revision", v);
  },
  "ORACLE_BINDING:revision",
);
mutation(
  "empty successful oracle cannot qualify",
  (_s, _r, set) => {
    const v = JSON.parse(raw.oracle);
    v.checks = [];
    set("oracle", v);
  },
  "ORACLE_STATUS",
);
const pack = outcomes[2].pack,
  packBytes = Buffer.from(JSON.stringify(pack, null, 2) + "\n"),
  packSha = sha256(packBytes);
const intentFor = (r) => ({
  purpose: "offline-regression-fixtures",
  method: r.method,
  path: r.path,
  query: r.query,
  request_body: r.request_body,
});
for (const record of pack.records) {
  const result = selectRecordedResponse(packBytes, intentFor(record), {
    expectedPackSha256: packSha,
  });
  check(
    `consumer exact ${record.method} ${record.path}`,
    isDeepStrictEqual(result.body, record.response_body) &&
      result.provenance.full_capture_acceptance === "FAIL" &&
      result.provenance.historical &&
      result.provenance.untrusted_content,
  );
}
const consumerNegatives = [];
function refuse(name, intent, bytes = packBytes, pin = packSha) {
  let reason = null;
  try {
    selectRecordedResponse(bytes, intent, { expectedPackSha256: pin });
  } catch (error) {
    reason = error.message;
  }
  check(name, reason !== null);
  consumerNegatives.push({ name, decision: "REJECTED", reason });
}
refuse("unknown literal reference query refused", {
  ...intentFor(pack.records[2]),
  query: "?id=unknown",
});
refuse("changed POST text refused", {
  ...intentFor(pack.records[0]),
  request_body: { ...pack.records[0].request_body, text: "UNRECORDED" },
});
refuse("live auth purpose refused", {
  ...intentFor(pack.records[1]),
  purpose: "authenticated-live-replay",
});
refuse("authorization header intent refused", {
  ...intentFor(pack.records[1]),
  headers: { Authorization: "synthetic" },
});
refuse(
  "tampered pack refused against external raw pin",
  intentFor(pack.records[1]),
  Buffer.concat([packBytes, Buffer.from(" ")]),
);
refuse(
  "external pack pin required",
  intentFor(pack.records[1]),
  packBytes,
  null,
);
for (const { spec: s, raw: r } of loaded) {
  const afterRaw = await readPinnedInputs(s);
  check(
    `${s.id} original artifacts unchanged`,
    Object.keys(r).every((k) => r[k].equals(afterRaw[k])),
  );
}
const after = await sourceBinding();
check("producer source binding unchanged", isDeepStrictEqual(before, after));
const result = {
  schema: "edos-response-fixture-calibration-v1",
  scope: "offline-regression-fixtures",
  calibration: "retrospective-known-cases",
  status: "QUALIFIED_RESPONSE_SUBSET",
  full_capture_acceptance: "FAIL",
  node: process.version,
  new_browser_or_server_runs: 0,
  producer_source_binding: before,
  input_pins_sha256: expectedPinsSha256,
  inputs: loaded.map(({ spec: s }) => ({
    id: s.id,
    capture_evidence_id: s.capture_evidence_id,
    manifest_evidence_id: s.manifest_evidence_id,
    sha256: Object.fromEntries(
      Object.entries(s.files).map(([k, v]) => [k, v.sha256]),
    ),
  })),
  corpus: outcomes.map(({ pack: _pack, ...rest }) => rest),
  preflight_negative_controls: negatives,
  consumer_negative_controls: consumerNegatives,
  checks,
  pack_sha256: packSha,
  records: pack.records.map(
    ({ response_body: _b, request_body: request, ...record }) => ({
      ...record,
      request_body_sha256: sha256(JSON.stringify(request)),
    }),
  ),
  limitations: pack.limitations,
};
await mkdir(outputDirectory);
await writeFile(join(outputDirectory, "qualified-pack.json"), packBytes, {
  flag: "wx",
});
await writeFile(
  join(outputDirectory, "RESULTS.json"),
  JSON.stringify(result, null, 2) + "\n",
  { flag: "wx" },
);
process.stdout.write(
  JSON.stringify(
    {
      status: result.status,
      full_capture_acceptance: "FAIL",
      checks: checks.length,
      pass: checks.filter((c) => c.pass).length,
      pack_sha256: packSha,
      corpus: result.corpus,
    },
    null,
    2,
  ) + "\n",
);
