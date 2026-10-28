# Fresh browser observation on the corrected baseline

On 2026-10-28 one public `capture-browser-scenario` run met the
[predeclared bounded contract](CONTRACT.md) at commit
`81d7006b0b333b7fd34f67f57f1d847d72f10307`, tree
`a70849eaa5a0e633fc72a7f4d0001f7c6fa0c158`. The unchanged harness observed
four expected states in 21,810 ms including cleanup. This establishes a fresh
synthetic runtime observation after the three source corrections described in
[the earlier recheck](../RECHECK.md).

| Authored case          | Observed presence | Independent receiver    | Native request body              |
| ---------------------- | ----------------- | ----------------------- | -------------------------------- |
| GET without body       | absent            | 0 bytes, empty SHA-256  | not_exposed                      |
| Empty text POST        | present-empty     | 0 bytes, empty SHA-256  | not_exposed                      |
| Fixed Unicode POST     | present           | 43 exact authored bytes | captured, same length and digest |
| Observer disabled POST | unknown           | 50 exact authored bytes | captured, same length and digest |

The receiver checked payload bytes, base64, digest and completion independently
of the capture. Four requests shared `/presence` and had distinct retained
transactions and correlation identities. Source-event linkage and all five steps
(initial navigation plus four actions) passed. Owned command/browser resources,
temporary runtime and receiver were closed. The actual provider reported
Chromium 156.0.8078.48; the selected installed launcher was Google Chrome of the
same version, with Node 24.22.1 and Playwright 1.58.2.

The disabled observer is the live negative control: neither receiver delivery
nor native exposure promoted `unknown` to `present`. Afterward,
[calibrate.mjs](calibrate.mjs) used two separate in-memory copies with the same
`assertPresenceCapture` oracle. False promotion to `present` and a corrupted
Unicode receiver payload both produced the intended `ERR_ASSERTION` inside that
oracle. The positive originals passed again and their raw bytes were unchanged.
These are two offline calibration checks, not two additional browser runs or
independent replications. A parameter-grouping cleanup removed one lint warning;
the same two mutations were repeated on a separate artifact copy with byte-identical
calibration output (two offline invocations, four mutated evaluations total).
[The calibration receipt](raw/CALIBRATION.json) records
the mismatched values.

## Exact inputs and retained artifacts

[RECEIPT.json](RECEIPT.json) binds the observed Evidence identity, raw file hashes,
source tree, 6,538 tracked entries, 2,391 built runtime files, 363 Playwright files,
lockfiles, Node/compiler binaries and Chrome launcher/framework engine. These
bindings matched before and after the run. Five source entries are gitlinks:
their referenced commits were recorded, not their submodule contents. Array
manifest digests use compact UTF-8 `JSON.stringify`; they are not hashes of the
pretty-printed manifest files. This is a selected-input binding, not a hermetic
attestation of the entire dependency installation, browser bundle or host OS.

`npm run build:cached` succeeded with three tasks, no cache hits, in 72.983 s.
Existing experimental-TypeScript and ineffective-dynamic-import warnings remain.
No runtime source, harness, dependencies or acceptance conditions changed for
this run. Source suites from the earlier recheck were not rerun or counted again.

The [raw directory](raw/) contains exact new CLI Evidence, parsed capture,
authored scenario, receiver receipts and calibration output. These files are
excluded from formatting to preserve their bytes. The original local summary
is retained separately; the public receipt removes only its absolute-path
command object and labels the relative command projection. Its original digest
is retained. The existing historical artifact hashes were checked and match;
no historical files were overwritten.

To repeat the experiment, build the stated baseline and invoke its unchanged
`scripts/lib/browser-presence-e2e.mjs` with an absolute browser path and a new
output directory. Then run this directory's `calibrate.mjs ABS_BASELINE ABS_RUN`.
Calibration imports built runtime modules but starts no browser or server.
It creates `CALIBRATION.json` exclusively; retain any existing result and use a
separate artifact copy if recalibrating recorded files. Replay was not run.

## Supported decision and remaining boundary

The ordinary four-state synthetic path now has fresh runtime evidence on the
corrected baseline. Further identical smoke runs are unnecessary for this task.
An expansion needs a concrete consumer decision and a separate bounded contract.
Malformed evidence and secret-reason failures retain their previous targeted
source coverage; this smoke did not inject those conditions into the browser.

**Historical `full_capture_acceptance: FAIL` remains FAIL.** This new capture is
also `incomplete`, with `equality_eligible: false`; response bodies were not
selected. Pre-dispatch presence cannot replace missing native request bytes or
authorize replay. The receiver independently observes payload delivery, while
Request identity still relies on the producer and correlation. This result
does not resolve the older `net::ERR_ABORTED` browser/protocol cause, qualify
current EdOS UI/save/auth/server behavior, or establish release, adoption or
product effect. The fork remains a draft lab prototype.
