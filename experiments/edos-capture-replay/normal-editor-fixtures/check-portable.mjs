import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadReplay } from "./replay.mjs";

const pin = "120b70977be11e62cff41b0282dbb6786cb008f342a210092c8364792b6aad13";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fields = [
  [
    "sectionId",
    "title",
    "text",
    "baseRevision",
    "dirty",
    "expectedSequence",
    "readingKey",
  ],
  [
    "id",
    "sectionId",
    "baseRevision",
    "title",
    "text",
    "updatedAt",
    "status",
    "dirty",
    "expectedSequence",
    "readingKey",
  ],
  [
    "id",
    "sectionId",
    "baseRevision",
    "title",
    "text",
    "updatedAt",
    "status",
    "dirty",
    "expectedSequence",
    "readingKey",
  ],
];
const intent = (record) => ({
  method: record.request.method,
  path: record.request.path,
  query: record.request.query,
  body: structuredClone(record.request.body),
});
const checks = [];
const verify = (name, operation) => {
  try {
    operation();
    checks.push({ name, status: "PASS" });
  } catch (error) {
    checks.push({ name, status: "FAIL" });
    throw error;
  }
};
let rejected = 0,
  sequenceTrace = [],
  failure;

try {
  assert.equal(
    process.version,
    "v24.22.1",
    "Use the declared Node 24.22.1 toolchain",
  );
  const bytes = await readFile(new URL("./fixture.json", import.meta.url));
  const replay = loadReplay(bytes, pin),
    fixture = replay.fixture;
  verify(
    "declared 7/10/10 body fields and recorded create/update/stale boundaries",
    () => {
      assert.deepEqual(
        fixture.records.map((record) =>
          Object.keys(record.request.body).sort(),
        ),
        fields.map((set) => [...set].sort()),
      );
      assert.deepEqual(
        fixture.records.map((record) => record.response.status),
        [200, 200, 409],
      );
      assert.deepEqual(
        fixture.records.map((record) => record.request.body.expectedSequence),
        [0, 1, 1],
      );
      assert.equal(fixture.seed.candidates.sequence, 0);
      assert.deepEqual(fixture.seed.candidates.items, []);
      assert.equal(fixture.seed.scene.token, undefined);
      assert.equal(
        fixture.records[0].request.body.readingKey,
        `draft:${fixture.seed.draftUUID}`,
      );
      const session = replay.newSession();
      let sequence = fixture.seed.candidates.sequence;
      sequenceTrace = [sequence];
      const responses = fixture.records.map((record) => {
        const response = session.select(intent(record));
        if (response.status === 200) sequence = response.body.sequence;
        sequenceTrace.push(sequence);
        return response;
      });
      assert.deepEqual(sequenceTrace, [0, 1, 2, 2]);
      const id = responses[0].body.savedId;
      assert.match(
        id,
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u,
      );
      assert.equal(responses[1].body.savedId, id);
      assert.deepEqual(
        responses
          .slice(0, 2)
          .map((response) => response.body.items.map((item) => item.id)),
        [[id], [id]],
      );
      assert.equal(fixture.records[1].request.body.id, id);
      assert.equal(fixture.records[2].request.body.id, id);
      assert.equal(
        fixture.records[1].request.body.readingKey,
        `candidate:${id}`,
      );
      assert.equal(
        fixture.records[2].request.body.readingKey,
        `candidate:${id}`,
      );
      assert.equal(
        responses[1].body.items[0].text,
        "Синтетический кандидат: ё, й и 🚀.\nВторая строка сохранена точно.\n",
      );
      assert.equal(typeof responses[2].body.error, "string");
      assert.equal(
        Object.hasOwn(responses[2].body, "sequence"),
        false,
        "409 does not supply a new state snapshot",
      );
      assert.equal(session.count(), 3);
      assert.throws(
        () => session.select(intent(fixture.records[2])),
        /Recorded flow exhausted/u,
      );
      assert.equal(session.count(), 3);
    },
  );

  const atStep = (index) => {
    const session = replay.newSession();
    for (let ordinal = 0; ordinal < index; ordinal++)
      session.select(intent(fixture.records[ordinal]));
    return session;
  };
  const rejectAt = (index, changed) => {
    const session = atStep(index);
    assert.throws(
      () => session.select(changed),
      /No exact next recorded request match/u,
    );
    assert.equal(
      session.count(),
      index,
      "Refusal does not consume the recorded operation",
    );
    assert.deepEqual(
      session.select(intent(fixture.records[index])),
      fixture.records[index].response,
    );
    rejected++;
  };
  verify(
    "73 known mismatched intents rejected without consuming the next record",
    () => {
      for (const [index, record] of fixture.records.entries()) {
        for (const field of Object.keys(record.request.body)) {
          const missing = intent(record);
          delete missing.body[field];
          rejectAt(index, missing);
          const changed = intent(record),
            value = changed.body[field];
          changed.body[field] =
            typeof value === "boolean"
              ? !value
              : typeof value === "number"
                ? value + 1
                : `${value} changed`;
          rejectAt(index, changed);
        }
        rejectAt(index, {
          ...intent(record),
          body: { ...record.request.body, unexpected: true },
        });
        rejectAt(index, { ...intent(record), method: "GET" });
        rejectAt(index, {
          ...intent(record),
          path: "/api/scene-workspace/unknown",
        });
        rejectAt(index, { ...intent(record), query: "?unknown=1" });
        rejectAt(index, {
          ...intent(record),
          body: {
            ...record.request.body,
            expectedSequence: String(record.request.body.expectedSequence),
          },
        });
        rejectAt(index, { ...intent(record), extra: true });
      }
      rejectAt(0, intent(fixture.records[1]));
      assert.equal(rejected, 73);
    },
  );

  verify(
    "JSON object key order does not weaken exact structural matching",
    () => {
      for (const [index, record] of fixture.records.entries()) {
        const reversed = intent(record);
        reversed.body = Object.fromEntries(
          Object.entries(reversed.body).reverse(),
        );
        const reordered = Object.fromEntries(
          Object.entries(reversed).reverse(),
        );
        assert.deepEqual(atStep(index).select(reordered), record.response);
      }
    },
  );

  verify(
    "external raw pin rejects wrong pin and byte tamper before loading",
    () => {
      assert.throws(
        () => loadReplay(bytes, "0".repeat(64)),
        /Flow fixture SHA mismatch/u,
      );
      assert.throws(
        () => loadReplay(Buffer.concat([bytes, Buffer.from(" ")]), pin),
        /Flow fixture SHA mismatch/u,
      );
      assert.throws(
        () => loadReplay(Buffer.from("not JSON"), pin),
        /Flow fixture SHA mismatch/u,
      );
      assert.throws(() => loadReplay(bytes, "embedded self-hash"));
    },
  );

  verify(
    "repinned internally inconsistent fixture cannot forge a response body",
    () => {
      const changed = structuredClone(fixture);
      changed.records[0].response.body.items[0].text = "changed fixture body";
      const changedBytes = Buffer.from(JSON.stringify(changed));
      assert.throws(() => loadReplay(changedBytes, hash(changedBytes)));
    },
  );

  verify(
    "returned responses and exported fixture metadata do not mutate frozen sessions",
    () => {
      const isolated = loadReplay(bytes, pin);
      const response = isolated.newSession().select(intent(fixture.records[0]));
      response.body.items[0].text = "changed caller body";
      response.headers["Content-Type"] = "changed caller header";
      isolated.fixture.records[0].response.body.items[0].text =
        "changed exported metadata";
      isolated.fixture.records[0].request.body.title =
        "changed exported request";
      assert.deepEqual(
        isolated.newSession().select(intent(fixture.records[0])),
        fixture.records[0].response,
      );
      assert.equal(hash(bytes), pin);
    },
  );
} catch (error) {
  failure = { name: error.name, message: error.message };
  process.exitCode = 1;
}

console.log(
  JSON.stringify(
    {
      schema: "edos-normal-editor-portable-check-v1",
      status: failure
        ? "FAIL_KNOWN_FIXTURE_PORTABLE_REPLAY"
        : "PASS_KNOWN_FIXTURE_PORTABLE_REPLAY",
      node: process.version,
      fixture_sha256: pin,
      checks,
      rejected_mutated_intents: rejected,
      recorded_statuses: [200, 200, 409],
      derived_recorded_sequence: sequenceTrace,
      verification_scope: "known-fixture-regression",
      independent_product_oracle: false,
      actual_product_execution: "NOT_RUN",
      new_handler_capture: "NOT_RUN",
      browser_runs: 0,
      network_calls: 0,
      disk_writes: 0,
      full_capture_acceptance: "FAIL",
      limitations: [
        "Checks the known recorded fixture and replay implementation; no actual product callbacks or handler execute here.",
        "The 409 sequence remains two only in the derived recorded-state interpretation, not a new persistence observation.",
        "The historical independent product oracle and actual-callback recheck are separate evidence.",
      ],
      ...(failure ? { failure } : {}),
    },
    null,
    2,
  ),
);
