import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Frozen synthetic observations, ordered exactly as the captured scenario.
// An error or mismatch neither consumes the step nor falls back to network.
export function loadReplay(bytes, externalPin) {
  assert.match(externalPin, /^[a-f0-9]{64}$/u);
  assert.equal(hash(bytes), externalPin, "Flow fixture SHA mismatch");
  const fixture = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  assert.equal(fixture.schema, "edos-normal-editor-flow-v1");
  assert.equal(fixture.provenance.kind, "synthetic-isolated-handler");
  assert.equal(fixture.full_capture_acceptance, "FAIL");
  assert.equal(fixture.records.length, 3);
  for (const [ordinal, record] of fixture.records.entries()) {
    assert.equal(record.ordinal, ordinal);
    assert.equal(record.request.method, "POST");
    assert.equal(record.request.path, "/api/scene-workspace/candidates");
    assert.equal(record.request.query, null);
    assert.equal(hash(record.request.body_text), record.request.body_sha256);
    assert.deepEqual(JSON.parse(record.request.body_text), record.request.body);
    assert.equal(hash(record.response.body_text), record.response.body_sha256);
    assert.deepEqual(
      JSON.parse(record.response.body_text),
      record.response.body,
    );
    assert.equal(record.response.status, ordinal === 2 ? 409 : 200);
  }
  return {
    fixture: structuredClone(fixture),
    newSession() {
      let next = 0;
      return {
        count: () => next,
        select(intent) {
          const record = fixture.records[next];
          if (!record) throw new Error("Recorded flow exhausted");
          const { method, path, query, body } = record.request;
          if (!isDeepStrictEqual(intent, { method, path, query, body }))
            throw new Error("No exact next recorded request match");
          next++;
          return structuredClone(record.response);
        },
      };
    },
  };
}
