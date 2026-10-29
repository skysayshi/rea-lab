# Observations and supported decision

The bounded diagnosis did not reproduce a 10-second close failure on a browser
with no explicitly created context. Both attempts observed the single original
promise to fulfilment: 7.722089146 s and 7.313035729 s. Neither qualifies release: the
process sampler retained identity mismatches, so each matrix stopped after its
first cell. One-empty, two-empty and two-blank remain unexecuted. No more native
retry was performed after the one declared setup correction.

## What the evidence distinguishes

| Surface              | Observed result                                                                       | Supported limit                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Close API            | 2/2 measured no-context settlements below 10000 ms                                    | Different attempts, not independent replications or latency estimate                            |
| SDK phases           | Graceful start, reply -9999, Node child-close, temporary cleanup/end retained in each | Parent receipt times; Node close includes stdio, not exact OS exit                              |
| SDK fallback         | No force-kill phase marker in either retained log                                     | Does not diagnose the historical mounted delay                                                  |
| Ownership            | Original and corrected releaseUNKNOWN                                                 | Actual mismatched identities were not retained in those runs; do not infer PID reuse or a cause |
| Later resource check | No matching known PID/group/root command and empty owned tempdirs                     | Later scoped absence only; original UNKNOWN unchanged; marker/result dirs retained as evidence  |
| Oracle/control       | Each partial record consistent; false timely claim and foreign-owner claim rejected   | Consistency/calibration, not native successful release                                          |
| EdOS                 | 0 imports,0 servers,0 writes                                                          | No mounted or product replay claim                                                              |

## Confirmed fixes and remaining uncertainty

The old mounted cleanup raced browser.close against 10 s and discarded a recorder
of its eventual settlement. The lab adapter now retains exactly that original
promise, records invocation/deadline/settlement, and observes through 45 s. A late
fulfilment still throws the original deadline error and keeps the conservative
scratch-retention gate. Rejection, pending and connected-after-fulfilment also
fail. The outer 10 s race is removed only for this browser observation; context and
server cleanup keep their previous bounds. Six actual adapter regressions passed
without importing or running EdOS. The seven utility cases also passed.

A separate owned fork/waitpid probe confirmed that macOS ps can show the same
PID/start with stat Z and command `<defunct>` before reaping. The sampler now retains
an already owned zombie until actual absence. It cannot admit another process,
provide discovery authority or become a signal target. That fixes a demonstrated
sampler mechanism, not the unknown cause of the Chrome mismatches. The corrected
native observation retained one known Z; other identity mismatches persisted.

A further narrow observability change stores prior/current stat/start/command
hash on future mismatches. It was not present in either native attempt, so these
results do not validate it natively. Non-Z command/start mismatches still block
release and signals; the gate has not been weakened to obtain PASS.

Installed Playwright 1.58.2 source separately shows an internal 30 s graceful-close
budget followed by kill, and a public close waiting on the launcher/disconnection.
The<process did exit> debug line is emitted on Node child close. Browser.close
with id -9999 is sent directly, so absence of a normal SEND log is expected. Source
facts are hypotheses/discriminators for future work, not proof of the old cause.

## Preserved setup and evidence limits

The first preflight failed while reading 13 already removed prior snapshot files,
and the shell erroneously continued into the native attempt. The original
exception, post-execution source snapshot and first partial result remain local.
A complete pre-execution binding is not claimed. Corrected before/after bindings
match: Node/launcher/framework, full 363-file Playwright set, authored diagnostic
files, 1802 available prior EdOS build inputs. The 13 removed copies are explicit
exclusions. No product source file was written by the diagnostic.

The first adapter overlay failed with an OS PermissionError; the following test
command found no test file, so that run executed zero tests. Both setup logs are
retained; a concrete file patch was then applied and all six actual cases passed.
This was a tooling correction, with no additional native or product execution.

Historical mounted setup FAIL, mounted overall FAIL and full-capture FAIL are
unchanged and pinned in RECEIPT.json. The earlier mounted API settlement time is
unobserved. No native root-cause fix, REA-core fix, release/adoption, product effect
or productivity gain is claimed.

## Next discriminator

A future explicitly authorized bounded continuation can inspect the newly
retained prior/current mismatch identities before choosing another browser
variant. This task stops with the two partial observations and tested lab fixes;
it does not open another retry loop. No global PWP machinery was added: the useful
local protocol change is to gate native launch on completed preflight, distinguish
removed snapshots from current sources, and retain the one original operation.
