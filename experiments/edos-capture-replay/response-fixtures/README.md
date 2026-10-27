# Pinned offline EdOS response fixtures

For an EdOS developer or CI job that needs the **recorded JSON response values**
for one synthetic candidate save/read/reference scenario. The checked-in pack and
consumer need only Node; they can support response-shape, Unicode and preview
regression checks without starting EdOS, REA or a browser.

```sh
node --test experiments/edos-capture-replay/response-fixtures/consumer.test.mjs
node experiments/edos-capture-replay/response-fixtures/example.mjs
```

The example checks the saved candidate's text including Unicode and newlines,
then rejects an unknown query. It uses the independently reviewed raw pack SHA:
`c9cfc0f66b4c50b7dc6da21b20bf66a82928e12caa3573c869dd2a67849bac17`.
An integration must keep this expected value outside incoming pack bytes. Hashing
an untrusted pack and using that hash as its expected pin defeats the boundary.

`selectRecordedResponse(rawBytes, intent, {expectedPackSha256})` returns a fresh
`body` plus historical/untrusted provenance and limitations, or throws on refusal.
Supply exactly `purpose`, `method`, `path`, `query`, and `request_body`:

- Purpose is `offline-regression-fixtures`.
- Path and query must match literally; query includes `?` or is `null`.
- GET intent requires `request_body: null`; this is an imposed caller contract,
  not evidence that the original GET request had no body.
- POST requires structural equality with the captured, independently checked JSON
  request. Inspecting its response does not execute a save.
- Headers, auth arguments, extra fields, missing pins and ambiguous packs fail closed.

The pack contains three selected responses: POST candidates (ordinal 2), GET
candidates (3), and GET source `?id=reference` (4). It contains no bootstrap reply,
authentication token, private source, raw capture, or listening endpoint.
`response_sha256` hashes UTF-8 `JSON.stringify(response_body)`; it is not a wire hash.

## Qualification and reproduction

`CONTRACT.md` was written before this known-case retrospective calibration.
`preflight.mjs` reads local capture/manifest/MCP replies and independently recorded
filesystem-oracle outputs, pinned by raw SHA. It reuses REA's `parseEvidence`,
`loadEnvironmentSource` and `replayedBody` for semantic identity, parent/ordinal
binding and whole-body classification. Captured POST bytes must also match the
predeclared fixture. It writes a pack only after all three selected replies match
the independent filesystem/fixture oracle.

The source receipt is pinned for provenance only; its historical auth/cleanup
controls are not re-executed or interpreted as new qualification prerequisites.
Oracle outputs are historical observations bound to the unchanged revision,
source, reference, config and fixture bytes; no new target observation is claimed.

Original inputs remain private/local. A maintainer with those inputs can supply a
reviewed pins file with `{cases:[{id,capture_evidence_id,manifest_evidence_id,files}]}`;
each file maps its role to `{path,sha256}`. Required roles appear in `RESULTS.json`.
The expected pins-file SHA must be supplied separately:

```sh
node experiments/edos-capture-replay/response-fixtures/preflight.mjs \
  "$REVIEWED_REA_ROOT" "$INPUT_PINS" "$EXPECTED_PINS_SHA256" v012 "$NEW_PACK_PATH"
node experiments/edos-capture-replay/response-fixtures/calibrate.mjs \
  "$REVIEWED_REA_ROOT" "$INPUT_PINS" "$EXPECTED_PINS_SHA256" "$NEW_OUTPUT_DIRECTORY"
```

`REVIEWED_REA_ROOT` is a **trusted executable dependency**: the loader imports its
TypeScript source. Do not point it at an unreviewed repository. Calibration checks
the original `669e617eec5422ebce1ab271af0fc7b51e90dc11` baseline, tracked source
diff and source digest before/after. Dependencies/host are not newly installed or
fully requalified. Both commands refuse to overwrite output. A rejected preflight
exits nonzero; consumer refusals are exceptions.

## Evidence and limits

`RESULTS.json` records three old-corpus decisions, 11 preflight refusals, three
consumer successes, six consumer refusals and unchanged input/source bindings:
30/30 checks. Eight separate consumer unit tests and the standalone example pass.
The v0.10 missing-candidates and v0.11 missing-reference bodies remain unusable;
v0.12 qualifies only this three-response subset. `REPORT.md` records the decision.

**Full capture acceptance remains FAIL for every corpus.** GET request bodies
remain `not_exposed`; browser/protocol cause is unresolved. These are known cases,
not a hidden holdout or evidence of a new successful capture, authenticated replay,
stateful server emulation, production acceptance, release or product effect.

The inherited Playwright limitation still applies: `Response.body()` may obtain
bytes through a follow-up load; original wire-transaction identity is not guaranteed.
Use this artifact for historical response consumers only. Live authorization,
handler semantics, ordering and future response correctness need separate evidence.
