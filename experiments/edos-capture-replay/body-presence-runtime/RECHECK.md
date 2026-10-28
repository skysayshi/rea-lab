# Body-presence review and reusable recorded evidence

2026-10-28, Europe/Berlin. This checkpoint reviews the existing local prototype
and makes its synthetic observation reviewable in the fork's existing draft PR.
It does not merge or qualify an official capability. [Receipt](RECHECK.json).

## Confirmed corrections

1. The scenario schema reserved `X-Rea-Presence-*` headers even for ordinary
   requests. Reservation now applies only to the explicit presence probe; the
   ordinary caller-selected header is preserved. Both accepted ordinary and
   rejected instrumented cases are covered.
2. A complete measurement with positive length and the empty-body SHA was
   accepted as `present`. The owning classifier now checks zero-length/digest
   consistency in both directions and preserves contradictory observations as
   `unknown`. The retained schema refuses the former positive claim.
3. Free-form producer error reasons bypassed declared-secret redaction. The
   network collector now applies its existing redactor after raw resource
   admission and validates the sanitized observation. If redaction expands a
   reason beyond the bounded schema, it returns a typed refusal and records a
   coverage gap. No raw reason is emitted, and native `not_exposed` remains intact.

These cases failed before the changes. The first two checks produced 2 failures
and 10 passes; the four secret-reason checks failed before correction and passed
afterward. Tests cover literal and encoded secret spellings and both incomplete
measurement and disabled-observer reasons. Independent read-only review found no
remaining material issue in these corrections or the portable verifier.

## Recorded observation and current checks

The original synthetic public-CLI observation used Node 24.22.1 and Chromium
156.0.8078.48. Four requests to one owned loopback URL produced:

| Request                     | Presence      | Receiver bytes | Native body state |
| --------------------------- | ------------- | -------------: | ----------------- |
| GET without body            | absent        |              0 | not_exposed       |
| POST with empty text        | present-empty |              0 | not_exposed       |
| POST with Unicode text      | present       |             43 | captured          |
| POST with observer disabled | unknown       |             50 | captured          |

The raw capture, Evidence envelope, receiver receipts and scenario are copied
byte-for-byte into [historical/](historical/). Raw SHA pins are checked before
parsing. The original 24 source-file hashes matched the checkout at the start
of this review. Those historical source-test results were 174/174; they are not
counted as new tests. Original build/typecheck/docs results and the earlier
timing-sensitive test failure retain their historical scope.

The current selected source coverage is **179 tests in 14 files across two
runs**: the first run passed 118 tests in 11 files, while three suites failed
to load a missing Vitest temporary SSR transform file (`ENOENT`). An unchanged
retry of only those three suites passed all 61 tests. The initial loading failure
is retained; its root cause was not diagnosed, and it is not reported as a clean
single-run pass. Exact check receipts and log digests are in `RECHECK.json`.

`verify-recorded.mjs` uses the rebuilt runtime schemas, semantic Evidence parser
and the same independent synthetic-payload assertions as the original CLI
verifier. The small refactor exports that pure assertion function; it does not
start the browser/server path on import. A separate temporary tampered copy
checks that raw-pin mismatch fails before the PASS result. Immutable raw artifacts
are excluded from autoformatting; their original bytes are part of the evidence.

## Limits and next decision

No new browser or server was run in this recheck. The browser producer and request
dispatch bridge are unchanged from the recorded observation. Current tests cover
the corrected validation/retention boundaries; replaying retained artifacts does
not measure a live provider on the changed version.

The new capture remains `incomplete`, `equality_eligible: false`. Historical
`full_capture_acceptance: FAIL` and unknown browser/protocol cause remain intact.
Presence proves a declared Fetch pre-dispatch property, not delivery, wire bytes,
current EdOS save compatibility, full UI, authentication renewal, release or
adoption. Earlier GET transactions are not reclassified. The v0.14 strict
dirty-save mismatch remains the result for that older fixture pack.

Use the portable offline check for this recorded synthetic evidence. A broader
product or live-provider claim requires a separately bounded current run; this
checkpoint supplies no such claim and does not weaken matching or capture gates.
