import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { selectRecordedResponse } from "./consumer.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const body = { title: "Сцена ё 🚀", text: "Строка\n", expectedSequence: 0 };
const state = { sequence: 1, items: [{ id: "synthetic-id", ...body }] };
const record = (request, responseBody, ordinal) => ({
  ...request,
  response_body: responseBody,
  record_ordinal: ordinal,
  response_sha256: hash(JSON.stringify(responseBody)),
});
const fixture = () => ({
  schema: "edos-recorded-responses-v1",
  scope: "offline-regression-fixtures",
  source_evidence_id: `ev_${"a".repeat(64)}`,
  full_capture_acceptance: "FAIL",
  records: [
    record(
      {
        method: "POST",
        path: "/api/scene-workspace/candidates",
        query: null,
        request_body: body,
      },
      { ...state, savedId: "synthetic-id" },
      2,
    ),
    record(
      {
        method: "GET",
        path: "/api/scene-workspace/candidates",
        query: null,
        request_body: null,
      },
      state,
      3,
    ),
    record(
      {
        method: "GET",
        path: "/api/scene-workspace/source",
        query: "?id=reference",
        request_body: null,
      },
      { id: "reference", text: "Источник\n" },
      4,
    ),
  ],
  limitations: ["Historical responses do not authenticate or execute writes."],
});
const intent = (overrides = {}) => ({
  purpose: "offline-regression-fixtures",
  method: "GET",
  path: "/api/scene-workspace/candidates",
  query: null,
  request_body: null,
  ...overrides,
});
const encode = (pack = fixture()) => {
  const raw = Buffer.from(JSON.stringify(pack));
  return { raw, options: { expectedPackSha256: hash(raw) } };
};
const select = (request = intent(), pack = fixture()) => {
  const { raw, options } = encode(pack);
  return selectRecordedResponse(raw, request, options);
};

await test("selects GET response with historical untrusted provenance and retained full FAIL", () => {
  const result = select();
  assert.deepEqual(result.body, state);
  assert.equal(result.provenance.record_ordinal, 3);
  assert.equal(result.provenance.full_capture_acceptance, "FAIL");
  assert.equal(result.provenance.untrusted_content, true);
  assert.equal(result.provenance.historical, true);
  assert.equal(
    result.provenance.source_evidence_id,
    fixture().source_evidence_id,
  );
  assert.equal(
    result.provenance.pack_sha256,
    encode().options.expectedPackSha256,
  );
});

await test("POST inspection requires structurally equal body regardless of object key order", () => {
  const result = select(
    intent({
      method: "POST",
      request_body: {
        expectedSequence: 0,
        text: "Строка\n",
        title: "Сцена ё 🚀",
      },
    }),
  );
  assert.deepEqual(result.body, { ...state, savedId: "synthetic-id" });
});

await test("literal query rejects unknown, differently spelled and missing queries", () => {
  const request = intent({
    path: "/api/scene-workspace/source",
    query: "?id=reference",
  });
  assert.deepEqual(select(request).body, {
    id: "reference",
    text: "Источник\n",
  });
  for (const query of [
    null,
    "?id=unknown",
    "?%69d=reference",
    "?id=reference&extra=1",
  ]) {
    assert.throws(
      () => select({ ...request, query }),
      /exact recorded request/u,
    );
  }
});

await test("rejects changed POST body independently of replay exact_match semantics", () => {
  for (const requestBody of [
    { ...body, text: "changed" },
    { ...body, extra: true },
    { title: body.title },
    { ...body, expectedSequence: "0" },
  ]) {
    assert.throws(
      () => select(intent({ method: "POST", request_body: requestBody })),
      /exact recorded request/u,
    );
  }
});

await test("requires explicit purpose, GET null body and no implied auth/header arguments", () => {
  for (const request of [
    intent({ purpose: "live-authentication" }),
    intent({ request_body: {} }),
    { ...intent(), headers: { Authorization: "synthetic" } },
    { ...intent(), purpose: undefined },
  ]) {
    assert.throws(() => select(request));
  }
});

await test("checks mandatory external raw-byte pin before parsing or trusting embedded values", () => {
  const { raw, options } = encode();
  assert.throws(
    () => selectRecordedResponse(raw, intent()),
    /external expectedPackSha256/u,
  );
  assert.throws(
    () =>
      selectRecordedResponse(raw, intent(), {
        expectedPackSha256: "b".repeat(64),
      }),
    /external pin/u,
  );
  assert.throws(
    () =>
      selectRecordedResponse(
        Buffer.concat([raw, Buffer.from(" ")]),
        intent(),
        options,
      ),
    /external pin/u,
  );
  assert.throws(
    () => selectRecordedResponse("not json", intent(), options),
    /external pin/u,
  );
});

await test("rejects externally repinned malformed, ambiguous and self-relabelled packs", () => {
  const mutations = [
    (pack) => {
      pack.records[0].response_body.sequence = 2;
    },
    (pack) => {
      pack.records[1].response_body = null;
    },
    (pack) => {
      pack.records.push(structuredClone(pack.records[0]));
    },
    (pack) => {
      pack.records[1].record_ordinal = 2;
    },
    (pack) => {
      pack.full_capture_acceptance = "PASS";
    },
    (pack) => {
      pack.scope = "production-qualified";
    },
    (pack) => {
      pack.source_evidence_id = [pack.source_evidence_id];
    },
    (pack) => {
      pack.pack_sha256 = "a".repeat(64);
    },
  ];
  for (const mutate of mutations) {
    const pack = fixture();
    mutate(pack);
    assert.throws(() => select(intent(), pack));
  }
});

await test("caller mutations cannot alter subsequent selections from the same pinned bytes", () => {
  const { raw, options } = encode();
  const before = Buffer.from(raw);
  const first = selectRecordedResponse(raw, intent(), options);
  first.body.items[0].title = "caller mutation";
  first.limitations.push("caller mutation");
  first.provenance.full_capture_acceptance = "PASS";
  const next = selectRecordedResponse(raw, intent(), options);
  assert.deepEqual(next.body, state);
  assert.deepEqual(next.limitations, fixture().limitations);
  assert.equal(next.provenance.full_capture_acceptance, "FAIL");
  assert.equal(raw.equals(before), true);
});
