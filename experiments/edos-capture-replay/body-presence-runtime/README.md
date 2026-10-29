# Controlled runtime Request body presence

This opt-in experiment extends the existing declarative request action. It is
restricted to a launched browser, an HTTP literal loopback origin and the exact
`/presence` path, with an explicit action timeout and no query or fragment.
The caller must own the synthetic endpoint and explicitly select network events
in `capture.events`. It is not a live EdOS qualification.

```json
{
  "step_id": "empty",
  "action": "request",
  "method": "POST",
  "path": "/presence",
  "text": "",
  "body_presence": {
    "mode": "synthetic-loopback",
    "observe": true,
    "measure": true
  },
  "timeout_ms": 5000,
  "expected_status": [200]
}
```

`text` is restricted to this experiment and is mutually exclusive with `json`.
Neither body form is allowed for GET or HEAD. An empty string creates a present
body stream; `json: ""` would instead send two quotation-mark bytes. Actions
without `body_presence` retain their existing execution path.

The page producer constructs one Request, uses intrinsic getters to observe it,
and passes that exact object to the captured fetch function. A private WeakMap
and opaque handle bind observation and dispatch. A clone read is optional and
bounded to 4096 bytes and 250 ms; incomplete reads establish no complete length.
The original must remain unused and unlocked. Redirects are refused.

The host generates correlation identifiers and rejects caller-defined
`X-Rea-Presence-*` headers for instrumented actions. Ordinary request actions
retain caller-selected headers. Its cancellation route retains the actual Playwright
Request object for the matching page, method, URL and fresh identifiers. The
network collector resolves this same object through its existing transaction
Map; it never creates a transaction from a URL or producer assertion. Missing,
omitted, duplicate, foreign, redirected or sealed bindings fail closed. Resource
omissions retain the existing gap accounting.

The additive `request-body-presence` event contains the earlier request event's
sequence and transaction ID, request phase, root hop, producer provenance and
the observation from which the schema rederives the claim:

| State           | Required evidence at the declared Fetch pre-dispatch boundary                 |
| --------------- | ----------------------------------------------------------------------------- |
| `absent`        | Intrinsic `Request.body === null`                                             |
| `present-empty` | Non-null body and complete zero-byte clone measurement with the empty SHA-256 |
| `present`       | Non-null body; length stays null without a complete measurement               |
| `unknown`       | Disabled observer or conflicting direct facts                                 |

These facts describe the Request before fetch dispatch. Correlation headers and
local provenance do not independently authenticate a target or prove wire-level
semantics. The controlled page must supply trustworthy realm intrinsics.
An outer finalized Evidence identity or externally pinned capture digest scopes
the event to its capture; a capture never embeds its own file digest.
An observed Request may still fail or be cancelled during the fetch attempt;
its pre-dispatch facts do not claim receiver delivery. The instrumented traffic
has runtime correlation headers, `cache: no-store` and `redirect: error`.
With header values selected, those run-local identifiers also remain visible
to existing network comparisons.

Native `network-content.body`, `not_exposed`, completeness gaps, strict request
matching and response fixture consumption are unchanged. Presence is advisory
and excluded from existing target-network equality projection; this experiment
does not establish cross-capture presence comparison coverage. A presence event
cannot make missing native body bytes complete or authorize replay.

After building the runtime with the repository's supported build command, run:

```bash
node scripts/lib/browser-presence-e2e.mjs /absolute/path/to/chrome /absolute/new/output-directory
```

The verifier uses the public `capture-browser-scenario` CLI against an owned
loopback receiver. It preserves raw Evidence, parsed capture, authored scenario,
independent payload receipts and a summary with external artifact hashes after
cleanup. It checks absent GET, empty POST, Unicode POST and disabled-observer
unknown, all using the same URL with distinct Request objects. Unit regressions
also cover exact identity, duplicate and foreign witnesses, deadlines, budgets,
schema linkage and unchanged default execution.

Historical `full_capture_acceptance: FAIL` remains FAIL. This scoped synthetic
runtime verification does not qualify mounted EdOS, a live save, its server, a
current product release or full browser capture/replay acceptance.

## Recorded artifacts and recheck

[Recheck](RECHECK.md) separates the original four-request CLI observation from
the later source corrections and offline verification. The four synthetic raw
artifacts in [historical/](historical/) retain their original bytes and digests.
`SOURCE_FILES.json` projects the original 24-file source manifest without its
local directory; it describes the code at observation time, before the corrections.

After building, verify these recorded artifacts without starting a browser or server:

```bash
node experiments/edos-capture-replay/body-presence-runtime/verify-recorded.mjs
```

The verifier checks fixed raw SHA-256 pins, parses Evidence and capture with the
built runtime, and reuses the CLI probe's payload oracle and transaction assertions.
Its output means `PASS_RECORDED_ARTIFACTS`; it is not a new capture or replay run.
Digest pins identify bytes, not independent authentication of the producer.

## Fresh observation on the corrected baseline

[2026-10-28 report](live-20261028/REPORT.md) records one new public-CLI browser
run at `81d7006`, with four observed states, an independent payload receiver,
the live disabled-observer control and two offline oracle calibrations.
[Its receipt](live-20261028/RECEIPT.json) binds unchanged inputs and runtime
to the exact raw artifacts. The older results above remain historical;
full-capture acceptance stays FAIL.

## Completeness attribution and useful consumer scope

[The subsequent reuse report](../normal-editor-fixtures/README.md#why-the-browser-capture-is-still-incomplete)
traces the fresh capture to three native body gaps and the disabled-observer gap.
Unselected response bodies are not the cause of incomplete; they prevent response
fixture export from that corpus. A separate historical normal-editor fixture
provides a strict consumer regression without changing that capture or its FAIL.
