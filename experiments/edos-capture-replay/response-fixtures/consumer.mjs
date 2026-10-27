import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const scope = "offline-regression-fixtures";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const requireValue = (condition, message) => {
  if (!condition) throw new Error(message);
};
const object = (value) =>
  value !== null &&
  typeof value === "object" &&
  Object.getPrototypeOf(value) === Object.prototype;
const keys = (value, expected, label) =>
  requireValue(
    object(value) &&
      isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort()),
    `${label}: unexpected or missing fields`,
  );
const json = (value) =>
  value === null ||
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value)) ||
  (Array.isArray(value) && value.every(json)) ||
  (object(value) && Object.values(value).every(json));

const requestShape = (value, label) => {
  requireValue(
    ["GET", "POST"].includes(value.method),
    `${label}: unsupported method`,
  );
  requireValue(
    typeof value.path === "string" &&
      value.path.startsWith("/") &&
      !/[?#]/u.test(value.path),
    `${label}: path must be literal and exclude query/fragment`,
  );
  requireValue(
    value.query === null ||
      (typeof value.query === "string" &&
        value.query.startsWith("?") &&
        !value.query.includes("#")),
    `${label}: query must be literal or null`,
  );
  requireValue(
    value.method === "GET"
      ? value.request_body === null
      : object(value.request_body) && json(value.request_body),
    `${label}: GET requires null body; POST requires a JSON object`,
  );
};

const validateRecord = (record) => {
  keys(
    record,
    [
      "method",
      "path",
      "query",
      "request_body",
      "response_body",
      "record_ordinal",
      "response_sha256",
    ],
    "Record",
  );
  requestShape(record, "Record");
  requireValue(
    object(record.response_body) &&
      json(record.response_body) &&
      record.response_sha256 === digest(JSON.stringify(record.response_body)) &&
      Number.isSafeInteger(record.record_ordinal) &&
      record.record_ordinal >= 0,
    "Record body, digest or ordinal is invalid",
  );
};

/** Inspect pinned historical responses; never dispatch requests or qualify live auth. */
export function selectRecordedResponse(rawPackBytes, intent, options = {}) {
  requireValue(
    typeof rawPackBytes === "string" || rawPackBytes instanceof Uint8Array,
    "Pack must be raw JSON bytes or text",
  );
  const { expectedPackSha256 } = options;
  requireValue(
    typeof expectedPackSha256 === "string" &&
      /^[a-f0-9]{64}$/u.test(expectedPackSha256),
    "An external expectedPackSha256 is required",
  );
  const bytes = Buffer.from(rawPackBytes);
  const packSha256 = digest(bytes);
  requireValue(
    packSha256 === expectedPackSha256,
    "Pack SHA-256 does not match external pin",
  );
  const pack = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  keys(
    pack,
    [
      "schema",
      "scope",
      "source_evidence_id",
      "full_capture_acceptance",
      "records",
      "limitations",
    ],
    "Pack",
  );
  requireValue(
    pack.schema === "edos-recorded-responses-v1" &&
      pack.scope === scope &&
      pack.full_capture_acceptance === "FAIL" &&
      typeof pack.source_evidence_id === "string" &&
      /^ev_[a-f0-9]{64}$/u.test(pack.source_evidence_id) &&
      Array.isArray(pack.limitations) &&
      pack.limitations.every((item) => typeof item === "string") &&
      Array.isArray(pack.records) &&
      pack.records.length > 0,
    "Pack contract or historical scope is invalid",
  );
  const endpoints = new Set(),
    ordinals = new Set();
  for (const record of pack.records) {
    validateRecord(record);
    const endpoint = JSON.stringify([record.method, record.path, record.query]);
    requireValue(
      !endpoints.has(endpoint) && !ordinals.has(record.record_ordinal),
      "Pack records must have unique endpoints and ordinals",
    );
    endpoints.add(endpoint);
    ordinals.add(record.record_ordinal);
  }
  keys(
    intent,
    ["purpose", "method", "path", "query", "request_body"],
    "Intent",
  );
  requireValue(
    intent.purpose === scope,
    "Intent purpose must be offline-regression-fixtures",
  );
  requestShape(intent, "Intent");
  const matches = pack.records.filter(
    (record) =>
      record.method === intent.method &&
      record.path === intent.path &&
      record.query === intent.query &&
      isDeepStrictEqual(record.request_body, intent.request_body),
  );
  requireValue(
    matches.length === 1,
    "No unique response matches the exact recorded request",
  );
  const record = matches[0];
  return {
    body: structuredClone(record.response_body),
    provenance: {
      untrusted_content: true,
      historical: true,
      scope,
      source_evidence_id: pack.source_evidence_id,
      pack_sha256: packSha256,
      record_ordinal: record.record_ordinal,
      full_capture_acceptance: "FAIL",
    },
    limitations: [...pack.limitations],
  };
}
