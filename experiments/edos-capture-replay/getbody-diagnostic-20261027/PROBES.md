# Native GET-body diagnostic probes

Two bounded native probes observed `net::ERR_ABORTED` after successful scenario
actions on the unchanged producer. They exclude temporary-route teardown and
invoking the real `releaseLock()` as necessary causes of these observations. They
do not identify a cause or demonstrate a fix. The public CLI capture result and
its incomplete acceptance remain separate; see [REPORT.md](REPORT.md) and
[RESULTS.json](RESULTS.json).

The published scripts are readable derivatives of the executed inputs. They were
statically checked after formatting, **not executed again**. Private protocol logs,
browser profiles, and local run directories are not published.

## Baseline and method

- Producer baseline: `669e617eec5422ebce1ab271af0fc7b51e90dc11`.
- Producer: `src/browser/PlaywrightScenarioRequest.ts`, SHA-256
  `e2a9354907bb9aa76249bfbd37fff7bf26fe0c2c841d6a3d8303b7418a14b2cf`
  (11,593 bytes), equal to the file at that commit.
- The probes import `performScenarioRequest`, `BrowserScenarioSecrets`, and the
  scenario schema through `scripts/lib/verifier-source-loader.mjs`. This exercises
  the native producer, not the whole public CLI capture pipeline.
- Recorded Node: `v24.22.1`; installed `playwright-core`: `1.58.2`. Selected browser
  executable: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
  These native reports do not record `browser.version()`, so they do not
  independently attest a browser version.
- Each probe owns a synthetic loopback HTTP server and isolated browser
  HOME/TMPDIR/profile, uses headless Chromium with service workers blocked, and
  closes its browser context and server. The server returns deterministic JSON
  containing a unique request ID, Unicode text, and 256 `x` characters.
- A passive additional CDP session records network events. `requestfinished`
  observers read and hash `Response.body()`; failed requests retain a failure
  observation instead of a body. Scenario requests expect status 200 and use a
  10-second action timeout. Terminal-event and body-observer settlement waits are
  bounded separately at five seconds. Browser launch has a 60-second timeout.
- A deliberate `route.abort()` request calibrates failure observation. Its ID must
  not reach the server. Successful retained bodies must match the deterministic
  server payload. The producer digest must remain unchanged across the run.

`OBSERVED` and a zero diagnostic exit mean these diagnostic assertions completed;
they do not mean that every GET body was captured. The scripts record the
producer digest before/after but do not enforce the baseline digest above.

## Executed and published inputs

SHA-256 values below identify different byte sequences. Report `source_sha256`
identifies the producer, not the diagnostic driver. Executed-input hashes were
collected from the retained work inputs; the native reports do not contain
pre-run driver attestations.

| Input                                                                | Bytes | SHA-256                                                            |
| -------------------------------------------------------------------- | ----: | ------------------------------------------------------------------ |
| Executed `work/diagnose-getbody.mjs`                                 | 6,808 | `d1b47dbc8f66fe40f9d1ed6f14119e0f4d74b64cdafb3ae3afdb37ff78d1f033` |
| Published [diagnose-getbody.mjs](diagnose-getbody.mjs)               | 8,762 | `872cfde372cc4595e52a72ef9fcdd232438ab53e83c331ad00d78bfdaf0f3af3` |
| Executed `work/diagnose-getbody-reader.mjs`                          | 7,401 | `ac4220e6a02f7b1e14689d9016c4a567d36df88964c53064e8b3223413c4a23b` |
| Published [diagnose-getbody-reader.mjs](diagnose-getbody-reader.mjs) | 9,438 | `1f3faa0040fcc72312ccba6db6449621ed43cc9c4e17b8c75d3890a339cdab29` |

The first published copy has formatting changes only. The second has formatting
changes and removal of one unused `keeper` declaration reported by lint; that
declaration was never installed as a route in the reader probe. This deletion is
a nonexecuted edit. Both work originals remain unchanged.

## Manual replay

These are proposed replay commands, not additional runs performed for publication.
Use a reviewed checkout with its existing locked dependencies, the pinned Node
toolchain, and an explicitly selected local Chrome executable. Verify the producer
digest against the baseline above before running and against each report afterward.
Do not treat unchanged source at a different digest as the reviewed baseline.

```sh
NODE24=/absolute/path/to/node-24.22.1
REA_CHECKOUT=/absolute/path/to/reviewed-rea-checkout
CHROME=/absolute/path/to/installed/Chrome
PROBE_PARENT=/absolute/path/to/new/private-probe-parent
umask 077
mkdir -m 700 "$PROBE_PARENT"
DEBUG=pw:protocol "$NODE24" \
  "$REA_CHECKOUT/experiments/edos-capture-replay/getbody-diagnostic-20261027/diagnose-getbody.mjs" \
  "$REA_CHECKOUT" "$CHROME" "$PROBE_PARENT/native" \
  2>"$PROBE_PARENT/native.private.log"
DEBUG=pw:protocol "$NODE24" \
  "$REA_CHECKOUT/experiments/edos-capture-replay/getbody-diagnostic-20261027/diagnose-getbody-reader.mjs" \
  "$REA_CHECKOUT" "$CHROME" "$PROBE_PARENT/reader" \
  2>"$PROBE_PARENT/reader.private.log"
```

Each output directory must be absent; the scripts create it without recursive
reuse. Protocol logs can contain local paths and request contents. Keep them
private. An owner must bound the whole invocation and audit its owned browser and
server resources after interruption: these diagnostic scripts do not include an
outer process-family watchdog. No dependency install or native replay was part of
this publication check.

## Observed matrices

The sequential A/B/A2 groups are descriptive observations, not randomized rate
comparisons or independent replications. All scenario actions returned their
expected status; action success did not imply a retained response body.

### Persistent neutral route

Run interval: `2026-10-26T23:55:29.484Z`–`23:55:38.457Z`.

| Mode | Intervention                                | Actions | Action errors | Failed requests | Retained bodies |
| ---- | ------------------------------------------- | ------: | ------------: | --------------: | --------------: |
| A    | Baseline                                    |       5 |             0 |               0 |               5 |
| B    | Persistent neutral `route.fallback()` route |       5 |             0 |               2 |               3 |
| A2   | Baseline after removing keeper              |       5 |             0 |               1 |               4 |

There were 15 tagged data requests at the server plus one null-ID favicon request.
The deliberate abort did not reach the server. All retained body hashes matched
the server payload; producer bytes were unchanged. The retained local report
(route-lifetime `report.json`) has SHA-256
`5b13aecb3a5c2b59c724124e62df0adaafe851adb02ce6f47b265408357e9c55`.

### Reader intervention

Run interval: `2026-10-26T23:58:27.843Z`–`23:58:35.631Z`.

| Mode | Intervention                    | Actions | Action errors | Failed requests | Retained bodies |
| ---- | ------------------------------- | ------: | ------------: | --------------: | --------------: |
| A    | Normal `releaseLock()`          |      10 |             0 |               2 |               8 |
| B    | No-op `releaseLock()`           |      10 |             0 |               4 |               6 |
| A2   | Normal `releaseLock()` restored |      10 |             0 |               4 |               6 |

The installed main-world reader wrapper recorded 10 suppressed releases in B.
The installed `AbortController.prototype.abort` wrapper recorded zero calls.
The deliberate route-abort negative does not calibrate that JavaScript wrapper;
zero observed calls do not exclude native cancellation. There were 30 tagged data
server requests plus one null-ID favicon; the abort negative did not reach the
server. Retained bodies matched the payload and producer bytes were unchanged.
The local report (reader-release `report.json`) has SHA-256
`ab545ff92059af7d0831726ae6cb37eda23cb0e949674454fbb60342eebe062d`.

## Ordering counterexamples

The timestamps below are selected records from the retained reports and private
protocol logs. Different CDP sessions and callback delivery can record the same
event at slightly different times; millisecond ordering across observers is not
a causal proof. The first example includes a protocol failure and a Playwright
failure before `unroute.begin` in the persistent-route group.

| Native B-0 event                                                               | UTC on 2026-10-26 |
| ------------------------------------------------------------------------------ | ----------------- |
| Server response finish, 316 bytes                                              | `23:55:36.660Z`   |
| Response received                                                              | `23:55:36.670Z`   |
| Main protocol `Network.loadingFailed`, `39619.8`, `net::ERR_ABORTED`, canceled | `23:55:36.671Z`   |
| Playwright request failed                                                      | `23:55:36.672Z`   |
| Temporary `unroute.begin`                                                      | `23:55:36.673Z`   |
| `unroute.end` and action completion                                            | `23:55:36.674Z`   |

The persistent keeper remained installed throughout all five B operations. Its
removal sent `Fetch.disable` at `23:55:36.841Z`, after the last B action completed
at `23:55:36.835Z`. Thus the observations do not require temporary-route teardown
or disabling interception. There was one actual protocol `Fetch.failRequest`
send in this run, at `23:55:36.972Z`, for the deliberate negative.

| Reader B-1 event                                            | UTC on 2026-10-26 |
| ----------------------------------------------------------- | ----------------- |
| Server response finish/close, 316 bytes                     | `23:58:33.704Z`   |
| Main protocol `Network.loadingFailed`, `39877.14`, canceled | `23:58:33.750Z`   |
| Response received / Playwright failure                      | `23:58:33.751Z`   |
| Suppressed reader release / `unroute.begin`                 | `23:58:33.752Z`   |
| `unroute.end` and action completion                         | `23:58:33.754Z`   |

Failure persisted while real reader release was suppressed. The reader run's one
actual protocol `Fetch.failRequest` send was the deliberate negative at
`23:58:34.172Z`. This excludes the real `releaseLock()` invocation as necessary;
it does not identify the remaining cause.

## Limits and publication checks

The cause remains unknown. These probes do not instrument reader `done` timing,
strong response retention, or garbage collection; neither Response lifetime nor
browser/dependency behavior has been established as the cause. Server finish
proves that the synthetic server emitted the payload, not that Chromium retained
the entire original response. `Response.body()` provenance also needs care:
Playwright can refetch when CDP returns an empty body with a positive content
length. That fallback has not been established as the cause here. Matching body
hashes establish payload agreement, not original-wire attestation.

No core fix, retry/backfill policy, dependency change, or complete-capture success
is justified by these observations. Published copies have only the scoped static
checks: Node syntax on both scripts, repository oxfmt check on the two scripts and
this document, and repository oxlint on both scripts. On 2026-10-27 all four
scoped check invocations exited zero: syntax 2/2, format 3/3 files, and lint
2 scripts with no warnings. Static validation is not native producer execution
or a product test.
