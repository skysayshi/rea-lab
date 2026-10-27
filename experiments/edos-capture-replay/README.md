# Bounded EdOS browser capture and offline replay

**Latest result: full acceptance remains FAIL.** The bounded
[GET-body diagnosis and fresh pilot](getbody-diagnostic-20261027/REPORT.md)
reproduced `ERR_ABORTED` on the pinned baseline, without establishing a cause or
justifying a core fix. The new capture retained POST and candidates GET but lost
reference GET. Independent oracle and negative controls completed: 58 of 61
assertions passed, with three failed gates around that one missing body. See the
[new receipt](getbody-diagnostic-20261027/RESULTS.json).

**Earlier 2026-10-26 result, preserved:** Two browser attempts produced one real
capture with all actions completed, but its GET-candidates response body was
unavailable (`net::ERR_ABORTED`). The strict capture gate failed. A separate
continuation verified 58 selected diagnostic assertions on that unchanged
incomplete Evidence. See [results](RESULTS.json), [independent review](REVIEW.md),
and the pre-execution [contract](CONTRACT.md).

This lab executes a pinned existing EdOS API module on newly authored synthetic
data. A tiny bootstrap page obtains its real ephemeral token; REA sends the
declared requests through the browser. This is not the complete EdOS frontend.
The private EdOS source is not distributed here. No provider or product code is
changed by this lab.

## Earlier 2026-10-26 observed checks

| Surface                          | Actual result                                                     | Boundary                                                |
| -------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| Real authenticated POST          | One candidate saved; independent disk oracle passes               | Original captured browser session                       |
| Wrong token / stale sequence     | HTTP 403 / 409, protected files unchanged                         | Fresh diagnostic session after original server closed   |
| Oracle negative calibration      | False empty-state expectation rejected                            | Same independent checker, no product import             |
| Evidence import and tamper       | Original pinned ID accepted; semantic alteration rejected, exit 1 | Unkeyed content identity, not signer authentication     |
| Offline MCP POST / source replay | Retained bodies match disk / fixture                              | Both live listeners stopped; no new candidate write     |
| Unknown source query             | Live 404; replay 200 with `exact_match: false`                    | Replay can return fallback content                      |
| Altered POST body                | Same recorded successful response, `exact_match: true`            | Matcher does not validate request body or authorization |
| Missing candidates body          | HTTP 200, body/content type null, `body_recorded: false`          | Remains unavailable; full acceptance is FAIL            |

The original failures remain in the receipt: launch deadline with unconfirmed
cleanup, incomplete capture, and a failed fetch-based stopped-listener probe.
The final continuation uses new TCP connections and records `ECONNREFUSED`.
Neither the initial launch cause nor the GET-abort cause was established. The
successful launch ran below the old deadline, so increasing it is not a proven
fix. See [attempt correction](ATTEMPT-02.md) and
[partial-evidence continuation](CONTINUATION.md).

## Prerequisites and execution

Use a caller-owned, already built REA checkout, Node 24, its pinned npm 11 lockfile
dependencies, and an explicitly selected installed Chrome-family browser. The
recorded runtime is the earlier build of baseline
`669e617eec5422ebce1ab271af0fc7b51e90dc11`, with existing test/helper/doc/lab work
in the checkout. It is not a clean installation or a newly rebuilt release.
No install, provider configuration or browser download is performed here.

Supply the private EdOS `scene-workspace.mjs` whose raw SHA-256 is
`705e2b4873772e9649bc3b52b445658e10592c1f62b8f79a4f6e191cc841676c`.
The old project checkout was dirty: its historical Git HEAD alone does not
identify these bytes. The runner refuses another module hash or an existing
output directory.

```sh
node experiments/edos-capture-replay/run-pilot.mjs \
  /absolute/rea-checkout /absolute/scene-workspace.mjs \
  /absolute/chrome /absolute/new-private-output
```

The runner copies the module into an owned directory, writes only synthetic
sources/config, launches a loopback target and asks REA to own the browser
profile. It declares the actual token as a redaction secret before navigation.
Raw outputs stay in that private directory; never publish them without a
separate review. The independent `oracle.mjs` imports neither EdOS nor REA.

The current runner retains failed completeness/body acceptance gates while
collecting the independent controls, then exits 1 for partial acceptance. Cleanup
and target-exit failures also keep acceptance closed. Do not remove a failed gate
to manufacture a pass. Its post-trial hardening was checked separately from the
recorded browser execution. The older separately declared diagnostic continuation
can read original partial Evidence using an independently retained ID:

```sh
node experiments/edos-capture-replay/continue-partial.mjs \
  /absolute/rea-checkout /absolute/prior-private-output \
  ev_ORIGINALLY_RETAINED_ID /absolute/new-private-diagnostic-output
```

This continuation is intentionally tailored to the recorded missing-candidates
case. It never recaptures or reseals the source. It reopens the existing isolated
data in a new session solely for negative requests, stops that listener, then
serves the original capture with `environment-serve --replay-only`. It cannot
qualify a complete capture. Check its receipt and exit status together.

## Evidence scope

`RESULTS.json` and the dated diagnostic receipt are reviewed, sanitized first-party
exports. Exact raw artifacts
and the private source remain local; public readers cannot independently
reproduce the private target from this directory alone. The 58 assertions and
repeated diagnostic requests are not independent experimental samples.

Protected EdOS source/reference/candidate files remained unchanged during
controls and replay; experiment logs and manifests were written. The six-file
continuation binding and a separate unchanged 2,393-entry dist/launcher/package
hash audit have different scopes. Neither covers all dependencies or the host.
Semantic Evidence IDs, raw file hashes and output hashes are not signatures.

This work does not establish stateful replay equivalence, renewed authorization,
full UI correctness, all-provider compatibility, production readiness, release,
adoption or productivity improvement. The dated diagnosis supplies native event
correlation but leaves cause unknown. Its report states a future discriminator;
no core fix is claimed without a confirmed cause.
