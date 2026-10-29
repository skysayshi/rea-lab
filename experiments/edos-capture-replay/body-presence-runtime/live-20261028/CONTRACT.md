# One fresh body-presence browser observation

Declared 2026-10-28, Europe/Berlin, before building or running this observation.
Recipient: a developer reviewing the corrected fork-local prototype. Execution
baseline is commit `81d7006b0b333b7fd34f67f57f1d847d72f10307`, tree
`a70849eaa5a0e633fc72a7f4d0001f7c6fa0c158`. Research input is `b9e39937`.

Use the unchanged `scripts/lib/browser-presence-e2e.mjs` from that baseline,
Node 24.22.1, the existing locked installation and the selected installed Chrome.
Record exact source, dependency and browser bindings before execution and compare
them afterward. Build with the supported `build:cached` command in an isolated
execution checkout. Do not install or upgrade software or alter the runtime
producer, collector, validators, fixtures or acceptance conditions to obtain PASS.

Run one public `capture-browser-scenario` command against the harness-owned
literal-loopback receiver, with its existing 60-second command bound, four
5-second request bounds and owned browser/profile cleanup. The four requests
share `/presence` but have distinct Request identities:

| Request                     | Expected Fetch pre-dispatch state | Independent receiver payload            |
| --------------------------- | --------------------------------- | --------------------------------------- |
| GET without body            | absent                            | zero bytes                              |
| POST empty text             | present-empty                     | zero bytes                              |
| POST fixed Unicode text     | present                           | exact authored text, byte count and SHA |
| POST with observer disabled | unknown                           | exact authored nonempty text            |

The last request is the live negative control: receiving nonempty bytes or native
body exposure must not promote disabled observation to known presence. The receiver
independently observes delivered bytes; it does not independently authenticate
the producer's Request identity. The unchanged oracle also checks source-event
and transaction bindings, cardinality, completed steps, native byte provenance and
cleanup. Capture must retain `incomplete` and `equality_eligible: false`.

After the run, require the same `assertPresenceCapture` oracle to reject two
separate in-memory copies: disabled-control presence falsely promoted to `present`,
and the Unicode receiver's payload corrupted. Record `AssertionError` at the oracle
with the expected mismatched values; schema or setup errors are not successful
calibrations. Recheck the positive originals and their raw hashes. These are two
offline oracle calibrations, not extra browser requests or independent replications.

Keep every attempt and raw result. Do not repeat merely to obtain a convenient
answer. A failed run triggers bounded diagnosis and an explicit evidence-based
decision about any follow-up; it cannot silently disappear into the passing count.
Do not overwrite prior artifacts. Publish only reviewed synthetic artifacts and
sanitized receipts; local paths in the original summary stay in local evidence.

Historical `full_capture_acceptance: FAIL` remains FAIL. This run can establish
only current synthetic runtime behavior at this exact baseline. It cannot establish
current EdOS/UI/save/auth behavior, wire semantics, complete capture/replay,
official capability readiness, release, adoption or product effect. The malformed
evidence and secret-reason corrections retain their prior targeted-test coverage;
this ordinary browser smoke does not separately inject those failures live.
