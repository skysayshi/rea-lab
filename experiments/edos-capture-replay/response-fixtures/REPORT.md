# Response fixture qualification, 2026-10-27

## Result and decision

A small offline consumer is usable for three synthetic EdOS response fixtures.
It rejects unknown query strings and altered POST requests that stock historical
replay can answer from a recorded exchange. This is a new, explicit consumer
contract; it does not replace or relax the previous full-capture gate.

| Historical corpus | Consumer qualification | Preserved full capture |
| --- | --- | --- |
| v0.10 | REJECTED: missing candidates response | FAIL |
| v0.11 | REJECTED: missing reference response | FAIL |
| v0.12 | QUALIFIED_RESPONSE_SUBSET: three exact JSON responses | FAIL |

The recipient is an EdOS developer/CI test inspecting historical response shapes,
content and Unicode preservation. `example.mjs` is a runnable adoption example.
No EdOS production code, REA core, browser configuration or old receipt changed.

## Method and checks

Inputs were frozen before calibration: external pins SHA
`3a9bd4d0254eb29daa0ff1f9fbbd93c2f0a4febc7bf6d81680f185da6e44a549`.
Capture/manifest semantic identity and ordinal mapping use the pinned producer's
own parser. Each selected JSON body must be complete and equal both the recorded
MCP reply and the independent prior filesystem/fixture oracle. The POST request
bytes are checked separately; replay `exact_match` alone does not attest its body.

30 checks passed: three corpus outcomes, 11 preflight negative controls, three
consumer positive controls, six consumer refusals, and seven pin/source/corpus
checks. External pins reject raw mutation and equivalent reserialization; calibrated
repins exercise inner guards separately (they do not simulate breaking an immutable
external pin). A wrong parent manifest, semantic tamper, truncated/missing/incorrect
MCP body, MCP error envelope, wrong revision and empty oracle all fail closed.

Independent code review found a missing `isError` check on MCP envelopes; it was
added before final calibration, with a dedicated negative control. An initial
development invocation also exposed a test-helper error: passing `undefined` used
its default valid pin. The missing-pin case was corrected to pass `null`. That
invocation produced no qualification output; its partial assertions are not counted.

The raw pack SHA is
`c9cfc0f66b4c50b7dc6da21b20bf66a82928e12caa3573c869dd2a67849bac17`.
Published bodies are solely the reviewed synthetic candidate/reference values.
`RESULTS.json` preserves per-input raw hashes, source binding and refusal reasons;
`VALIDATION.json` binds final tooling checks. Original private captures stay local.

## Interpretation and stop condition

This is retrospective known-case calibration and a working lab artifact. It does
not re-authenticate sessions, execute saves, reproduce the browser failure, prove
its cause, or show deployment/use by an external product team. The original 403/409
controls remain historical findings; this qualification does not renew them.
No new browser/server run was performed. The producer source and raw inputs remained
unchanged. Tooling imports a trusted checkout; the whole host/dependency graph was
not independently requalified in this step.

Further browser diagnosis is deferred until a concrete consumer requires a new live
capture or evidence can discriminate another cause. A product team can now adopt the
three pinned fixtures in response-consumer tests; that adoption and its effect are
still unobserved. The original full-capture FAIL and unresolved browser/protocol cause
remain explicit. The reusable PWP already covers this distinction, so no global
protocol change was needed.
