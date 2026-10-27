# GET-body diagnosis and one fresh authenticated pilot

**Full acceptance remains FAIL. Cause remains unknown; no REA core fix or rebuild is justified.** The bounded investigation reproduced native `net::ERR_ABORTED` while the page-side request action completed. Neither temporary route removal nor explicit reader release was a necessary condition. One fresh actual CLI capture retained POST and candidates GET bodies but lost the reference GET body. Independent filesystem checks and negative controls completed without changing that failed gate.

The [sanitized receipt](RESULTS.json) binds the results to baseline `669e617eec5422ebce1ab271af0fc7b51e90dc11`, exact source/runtime hashes, Node 24.22.1, Playwright 1.58.2 and installed Chrome 155.0.8059.86. Native probes loaded the unchanged source request producer. The public pilot used the existing compiled baseline with earlier test/helper/doc/lab changes in its checkout; it was not a clean installation or newly rebuilt fork. No dependency or browser update was performed.

## Bounded native diagnosis

The [initial contract](CONTRACT.md), [one permitted reader follow-up](READER-CONTROL.md) and [fresh pilot contract](FRESH-PILOT.md) were written before their respective executions. A shell output-redirection failure occurred before the first Node/browser launch; execution moved to a private temporary directory. It is preparation history, not a browser trial.

| Intervention                               | A                     | B                     | A2                    | Supported conclusion                                                                   |
| ------------------------------------------ | --------------------- | --------------------- | --------------------- | -------------------------------------------------------------------------------------- |
| B keeps a neutral fallback route installed | 0/5 failed, 5 bodies  | 2/5 failed, 3 bodies  | 1/5 failed, 4 bodies  | Failure occurs before temporary `unroute` receipt and while interception stays enabled |
| B suppresses `reader.releaseLock`          | 2/10 failed, 8 bodies | 4/10 failed, 6 bodies | 4/10 failed, 6 bodies | Explicit reader release is not required for the observed failure                       |

Every page-side action returned successfully in both experiments. Each tagged request reached the synthetic server, which completed the declared response. Retained bodies matched the independently declared payload. There were 15 and 30 tagged requests respectively, plus one incidental favicon request in each run. Each experiment also included a deliberate route-abort negative that was observed and did not reach the data endpoint.

The second probe observed ten suppressed release calls and zero instrumented JavaScript `AbortController.abort` calls. That does not rule out native cancellation. No reader `done`, object lifetime or garbage-collection measurement was made. The small sequential cells are counterexamples to necessary-cause hypotheses, not failure-rate estimates or evidence of a beneficial intervention. See [probe methods and exact executed/published script bindings](PROBES.md).

The source review is consistent with the evidence: the request producer installs routing, runs page fetch/drains its reader, then removes its route in `finally`; the successful path clears its deadline without explicitly aborting. The network observer reads a body for `requestfinished`, but preserves explicit unavailable state for `requestfailed`. Re-fetching, synthesizing or filling a body from another capture would conceal that distinction. No such repair was made.

## Fresh actual CLI/MCP pilot

The fresh browser trial had neither diagnostic intervention. All five declared actions completed. Its Evidence ID is `ev_9ce5a7f7c1e875c4a8ccd1e0f49cb2ab0990c772bed2c746840f6dfb535c5e2d`; the manifest ID is `ev_21f26fe1771682f3c34e03715a9c69d00148819b40683aacf1e4a962fbe30293`.

| Surface                                                  | Observed result                                                                                                        | Acceptance meaning                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Capture                                                  | Incomplete, equality ineligible, missing events, no truncation                                                         | FAIL                                                                          |
| POST ordinal 2                                           | Full retained body equals candidate file state plus saved ID                                                           | Selected body oracle PASS                                                     |
| Candidates GET ordinal 3                                 | Full retained body equals independent file state                                                                       | Selected body oracle PASS                                                     |
| Reference GET ordinal 4                                  | `request-failed`, `net::ERR_ABORTED`; content sequence 25/source event 23                                              | Body unavailable; full-body gate FAIL                                         |
| Query negative                                           | Live unknown source returns 404; replay selects ordinal 4 with `exact_match:false` and null body                       | Fallback metadata observed; body equivalence unavailable, full-body gate FAIL |
| Altered POST body                                        | Replays original successful body with `exact_match:true`                                                               | Confirms recorded replay does not validate request body                       |
| Wrong token/current sequence; valid token/stale sequence | 403; 409 in the original captured session                                                                              | Candidate revision, source and reference unchanged                            |
| Oracle calibration; semantic tamper                      | False empty-state rejected; altered Evidence rejected with exit 1                                                      | Negative controls detect their declared violations                            |
| Offline replay                                           | Two fresh TCP probes return `ECONNREFUSED`; no candidate mutation                                                      | Original target was stopped                                                   |
| Cleanup and bindings                                     | Target exit 0, replay exit 143; session file removed; declared 2,393 runtime and four harness/fixture inputs unchanged | Current-run checks pass within their declared scope                           |

The runner returned exit **1**, `PARTIAL_CONTROLS_COMPLETE`, `full_acceptance:FAIL`: **61 assertions, 58 PASS, three failed acceptance assertions around one missing response body**. The same independent oracle reads disk and an authored fixture, without importing REA or EdOS. The reviewer independently compared fifteen raw artifact facts. That is shared-environment first-party review, not external replication.

The earlier capture lost candidates while retaining reference; this one retained candidates while losing reference. Bodies from those two Evidence objects must not be combined into a complete-capture claim. The symptom is not established as candidates-endpoint-specific.

## Runner changes and their verification scope

The executed v2 runner records completeness/body gates as failed while allowing the already-authorized independent controls to finish. It never replaces a positive retained-body requirement with a null-body check, and exits 1 if a gate fails. Its exact hash is in the receipt. This improves diagnostic collection, not REA capture behavior.

Independent review also found two prospective false-green risks in the reusable runner: acceptance could be computed before a later cleanup failure, and target shutdown lacked a clean-exit assertion. The published runner hardens both. Its focused failure-path tests and hashes are reported in [validation](VALIDATION.json). These subsequent edits were **not** executed in the recorded browser trial; that original run already failed correctly, and its raw receipt remains unchanged. There was no additional native rerun to seek a green result.

## Decision and next discriminator

The conditional product-fix prerequisite was not met. Keep the full-capture gate closed. A future separately bounded experiment could distinguish response/reader object lifetime from browser/protocol behavior, or compare the same producer against a compatible installed browser pair. Neither explanation is confirmed here. Do not adopt speculative waits, body backfill or `Response.finished()` as a fix without a discriminating result and failure/cancellation coverage.

Raw private protocol traces and the frozen private EdOS source stay local; published code, sanitized observations and hashes are reviewable but do not reproduce that private target unaided. Hash domains are explicit: response JSON hashes, null-sentinel hashes, raw file hashes and semantic Evidence IDs are not interchangeable or signatures. No merge, release, production readiness, full UI qualification, stateful replay equivalence or productivity improvement is established.
