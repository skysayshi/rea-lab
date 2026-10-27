# Response/reader lifetime and browser/protocol boundary

**The bounded diagnosis found a counterexample to insufficient Response/reader/signal retention and temporary routing as necessary explanations. Root cause remains unknown; no core fix or rebuild was made.** The separate fresh CLI pilot retained all five response bodies, including every selected replay response. Its full-capture gate still failed because four GET **request** bodies were `not_exposed`. These are different observations.

See the pre-execution [contract](CONTRACT.md), exact executed [driver](diagnose-lifetime.mjs), [sanitized evidence](RESULTS.json) and [validation](VALIDATION.json). Previous [GET-body diagnosis](../getbody-diagnostic-20261027/REPORT.md) and earlier failed captures remain unchanged.

## Fixed inputs and design

The source producer is baseline `669e617eec5422ebce1ab271af0fc7b51e90dc11`, SHA-256 `e2a9354907bb9aa76249bfbd37fff7bf26fe0c2c841d6a3d8303b7418a14b2cf`. Both arms call the unchanged `performScenarioRequest`; a bound page facade changes only `route/unroute` to logged no-ops for gate OFF. That removes its dispatch-cancellation guard solely for an owned synthetic loopback diagnostic. It is not a proposed production fix.

The two instrumented pages have identical WeakMaps and scalar event tracing. A/A2 retain no Response/reader objects; B retains Response, reader and AbortSignal until native terminal and body-observer settlement, then checks and releases them. The read wrapper returns the original Promise, without suppressing release or cancellation. Every instrumented ordinary request reached `reader.done` with the independent expected byte count. The shared fetch wrapper and trace callbacks can still perturb timing.

Node 24.22.1 and installed Playwright 1.58.2 were unchanged. `Browser.getVersion` reports Chrome 155.0.8059.86, protocol 1.3, revision `@804d6b05f089b27af8342622a36558c49401a1d4`. Playwright's installed descriptor expects Chromium 145.0.7632.6/revision 1208; no matching executable was found in the checked local locations. No browser was installed or upgraded. That mismatch is a qualification limit, not a proven cause. The receipt includes a hash of the actual Chrome framework file as well as its launcher; this is not a whole-app/host attestation or a version comparison.

For a separately commissioned replay, use the pinned Node, an existing reviewed checkout with its locked dependencies and an absent private output directory. The driver rejects a different request-producer hash. Keep debug output private; no install or browser download is performed:

```sh
DEBUG=pw:protocol,pw:browser node \
  experiments/edos-capture-replay/lifetime-diagnostic-20261027/diagnose-lifetime.mjs \
  /absolute/rea-checkout /absolute/chrome /absolute/new-private-output \
  2>/absolute/private-protocol.log
```

## Native result

| Group                         | Ordinary requests | Native failures | Retained bodies | Reader done / exact byte count |
| ----------------------------- | ----------------: | --------------: | --------------: | ------------------------------ |
| Uninstrumented anchor before  |                 4 |               0 |               4 | Not instrumented               |
| Gate ON, A                    |                 6 |               1 |               5 | 6/6                            |
| Gate ON, B: strong retention  |                 6 |               0 |               6 | 6/6                            |
| Gate ON, A2                   |                 6 |               0 |               6 | 6/6                            |
| Gate OFF, A                   |                 6 |               1 |               5 | 6/6                            |
| Gate OFF, B: strong retention |                 6 |               1 |               5 | 6/6                            |
| Gate OFF, A2                  |                 6 |               0 |               6 | 6/6                            |
| Uninstrumented anchor after   |                 4 |               0 |               4 | Not instrumented               |

All 44 ordinary page-side actions completed successfully. Three distinct negatives also behaved as declared: real route abort before a server hit, explicit in-flight AbortController cancellation with reader rejection and native failure, and a changed response rejected by the independent payload oracle. There were 46 unique server hits: 44 ordinary plus signal/payload negatives, with no duplicates. The route-abort negative never reached the endpoint.

The decisive request is **`off-B-5`**. It read all **328 bytes** and reported `done:true`; Response, reader and signal were still strongly held when the native failure had settled. Chromium reported `net::ERR_ABORTED`, and the body observer retained no body. Selected timestamps on 2026-10-27:

| Observation                                 | Timestamp / clock                                                  |
| ------------------------------------------- | ------------------------------------------------------------------ |
| Server finished 328-byte response           | 00:45:16.267Z, host receipt                                        |
| Reader read 328 bytes                       | 1793061916268.8 ms, page timeOrigin + performance.now              |
| Reader closed / read done                   | 1793061916269.2 ms, page clock                                     |
| Reader releaseLock                          | 1793061916269.3 ms, page clock                                     |
| Native loadingFailed, canceled              | 00:45:16.273–.274Z, protocol receipt; native timestamps in receipt |
| Source action returned successfully         | 00:45:16.275Z, host receipt                                        |
| Strong references released after settlement | 00:45:16.285Z, host receipt                                        |

Different clocks and observer delivery are not a general causal ordering proof. The recorded object retention and no-op gate treatment are the relevant counterexample. Independent protocol review found **zero `Fetch.*` sends on both gate-off sessions**, zero `Network.loadNetworkResource` sends across the run, 42 `Network.getResponseBody` sends and one `Fetch.failRequest` for the deliberate negative. Matching retained payloads therefore did not rely on observed refetches or duplicate fixture requests in this run.

The native driver completed with exit 0 / `OBSERVED`, **255 diagnostic assertions passed**, source/driver hashes unchanged and browser/server closed. This does not mean all GET response bodies were captured. Sequential cells are not reliability estimates; eight green anchors do not establish instrumentation as the cause. Retaining AbortSignal does not separately retain AbortController. No forced-GC or compatible-browser experiment was performed. The criterion for the optional causal follow-up was not met, so no extra native trial was run.

## One fresh authenticated CLI/MCP pilot

This run used the existing compiled baseline and the unchanged, published hardened runner `63bacf9fb16d40da164349a76d8e995e86ff009d32ad44b2f9c0c021e5f8138f`, without native diagnostic interventions. The frozen private EdOS module operated only on synthetic data. The independent oracle imports neither EdOS nor REA.

New Evidence: `ev_a1e684d81bd28c160fb8a60628d1f1f0e18c0a7f7b1e7e2d043c05d4e78fe829`; manifest: `ev_0d0ae147f67180c9b7e7b52486dc0425e1c5128cb8072d91b2379ee4160abaef`.

All five response bodies were retained. POST ordinal 2 and candidates GET ordinal 3 matched committed file state; reference GET ordinal 4 matched the independent fixture. The unknown query replayed the reference with `exact_match:false`, while the altered POST input replayed its original response with `exact_match:true`. These controls expose matcher limits rather than prove renewed authorization or body validation.

Original-session wrong-token 403 and stale-sequence 409 preserved the candidate revision, source and reference. The oracle rejected a false empty-state expectation; semantic Evidence tampering was rejected. Both TCP probes reported `ECONNREFUSED` while replaying against the stopped target. Browser and target exited cleanly, replay exited 143, the private session was removed, and 2,393 runtime bindings plus five harness/fixture inputs matched before/after.

The exact result is **61/62 assertions PASS, one full-capture gate FAIL; exit 1 / `PARTIAL_CONTROLS_COMPLETE`**. No `request-failed` or `ERR_ABORTED` appears in this new capture. The four remaining coverage gaps are request-phase `not_exposed` bodies:

| Request                                        | Content event / source event |
| ---------------------------------------------- | ---------------------------- |
| GET `/`                                        | 2 / 1                        |
| GET `/api/scene-workspace`                     | 5 / 4                        |
| GET `/api/scene-workspace/candidates`          | 17 / 16                      |
| GET `/api/scene-workspace/source?id=reference` | 22 / 21                      |

This follows the pinned producer's declared semantics: `PlaywrightNetworkContent.ts` maps null `postDataBuffer()` to `not_exposed`; `PlaywrightScenarioNetwork.collect` adds a coverage gap for that state; the provider maps event limitations to missing events. The overall failure is not a stale completeness flag or a lost response body. `not_exposed` is not proof of body absence, so the existing gate remains closed. Earlier missing-response failures were not the only possible contributors to their global flags either; those historical receipts are not rewritten.

## Decision and reuse limits

The new native evidence rejects two proposed necessary explanations, without locating the fault in Chrome, Playwright, fetch semantics or instrumentation. The fresh pilot supports selected recorded-response replay against an independent oracle, while broader request-content coverage remains incomplete. These results are useful separately; neither is a production fix or general qualification.

No body backfill, cross-capture splicing, weakened completeness requirement, dependency update, merge, release or human-readiness attestation was introduced. Raw traces/captures and private EdOS source stay local. Hashes identify their stated raw/API/JSON/semantic domains, not actors or original wire provenance. Any further experiment should first choose whether to isolate instrumentation/consumer behavior or examine body availability after native failure; a compatible-browser comparison requires its own declared environment change.
