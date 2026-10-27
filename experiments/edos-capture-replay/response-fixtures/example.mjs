import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { selectRecordedResponse } from "./consumer.mjs";

const raw = await readFile(new URL("./qualified-pack.json", import.meta.url));
// Reviewed outside the pack; do not derive this expected value from incoming bytes.
const options = {
  expectedPackSha256:
    "c9cfc0f66b4c50b7dc6da21b20bf66a82928e12caa3573c869dd2a67849bac17",
};
const intent = {
  purpose: "offline-regression-fixtures",
  method: "GET",
  path: "/api/scene-workspace/candidates",
  query: null,
  request_body: null,
};
const saved = selectRecordedResponse(raw, intent, options);
assert.equal(saved.body.sequence, 1);
assert.equal(saved.body.items.length, 1);
assert.equal(saved.body.items[0].title, "Синтетический вариант");
assert.equal(
  saved.body.items[0].text,
  "Синтетический кандидат: ё, й и 🚀.\nВторая строка сохранена точно.\n",
);
assert.throws(
  () =>
    selectRecordedResponse(raw, { ...intent, query: "?unexpected=1" }, options),
  /No unique response/u,
);
console.log(
  JSON.stringify({
    scope: saved.provenance.scope,
    candidate_count: saved.body.items.length,
    unicode_and_newlines_preserved: true,
    unknown_query: "REJECTED",
    full_capture_acceptance: saved.provenance.full_capture_acceptance,
  }),
);
