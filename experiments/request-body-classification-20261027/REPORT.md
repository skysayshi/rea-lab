# GET request body classification and Evidence completeness

The GET classification reported on 27 October 2026 is **not a demonstrated
producer defect**. Playwright's `Buffer | null` observation cannot distinguish
all absent bodies from bodies whose bytes were not exposed. REA correctly
preserves `null` as `not_exposed` and keeps full capture incomplete.

A separate, reproducible defect existed in semantic capture validation:
selected unknown content could be labelled `complete`, admitted by the capture
schema and compared with itself as `unchanged`. The accompanying fix rejects
that contradiction. It does not manufacture missing bytes or qualify EdOS.

## Scope and source versions

The published [lifetime report](https://github.com/skysayshi/rea-lab/blob/d1ac77d36ced2353e6acd5323b2f0beba6aa76cd/experiments/edos-capture-replay/lifetime-diagnostic-20261027/REPORT.md)
and [PR 1](https://github.com/skysayshi/rea-lab/pull/1) are historical inputs.
The inspected REA producer, completeness owner and affected schemas are
identical between that report's source baseline
`669e617eec5422ebce1ab271af0fc7b51e90dc11` and publication commit
`d1ac77d36ced2353e6acd5323b2f0beba6aa76cd`. This change branches directly from
the former, keeping the earlier experiment's changes out of its diff.

Only public source and synthetic observations are used. No EdOS private source,
browser, server, live request, capture/replay integration, dependency upgrade or
runtime rebuild is required or performed for this review.

## What the observations establish

| Observation                                     | Supported classification                      | Limit                                                                             |
| ----------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| `postDataBuffer()` returns a zero-length Buffer | `captured`, zero bytes, empty-content SHA-256 | A zero-length browser-exposed representation; not an independent wire attestation |
| A nonempty Buffer, including for GET            | `captured`, retained bytes and digest         | Method does not override the observation                                          |
| `null`                                          | `not_exposed`                                 | Cannot distinguish absent body from unavailable producer bytes                    |
| Body API throws, times out or is cancelled      | `unavailable` with the corresponding reason   | Never evidence of absence                                                         |
| Request body was not selected                   | `not_requested`                               | Completeness covers selected facets only                                          |

Playwright 1.58.2's [Chromium adapter](https://github.com/microsoft/playwright/blob/v1.58.2/packages/playwright-core/src/server/chromium/crNetworkManager.ts#L552-L562)
constructs post data from exposed `postDataEntries` bytes. It drops entries
without bytes and does not preserve the protocol's `hasPostData` distinction in
the public request body result. Both no entries and non-byte entries can yield
null. This is source-derived evidence of information loss before REA, not a new
browser reproduction.

The exact [Chromium revision in the report](https://github.com/chromium/chromium/blob/804d6b05f089b27af8342622a36558c49401a1d4/third_party/blink/renderer/core/inspector/inspector_network_agent.cc#L842-L872)
distinguishes absent/empty data from non-byte elements or data exceeding its
exposure limit. Its [request serializer](https://github.com/chromium/chromium/blob/804d6b05f089b27af8342622a36558c49401a1d4/third_party/blink/renderer/core/inspector/inspector_network_agent.cc#L976-L1012)
emits `hasPostData` only when true. Missing optional fields therefore require a
known producer contract; they are not universally false.

`sizes().requestBodySize === 0` does not provide an independent oracle:
[Playwright's size calculation](https://github.com/microsoft/playwright/blob/v1.58.2/packages/playwright-core/src/server/network.ts#L286-L292)
can fall back to the same post-data buffer and then zero. `postData()` also
does not recover the lost distinction. `Network.getRequestPostData` is not a
general completeness oracle: its [protocol contract](https://github.com/microsoft/playwright/blob/v1.58.2/packages/playwright-core/src/server/chromium/protocol.d.ts#L12485-L12502)
allows multipart files to be omitted.

GET/HEAD restrictions in the [Fetch constructor](https://fetch.spec.whatwg.org/#dom-request)
describe that creation path, not every observed or subsequently intercepted
request. Complete actual HTTP/1.1 framing can establish a zero-length message
body under [RFC 9112 section 6.3](https://www.rfc-editor.org/rfc/rfc9112.html#section-6.3),
but REA's current request seam does not attest those premises. Playwright
[request headers can fall back to provisional headers](https://github.com/microsoft/playwright/blob/v1.58.2/packages/playwright-core/src/server/network.ts#L236-L243).
Neither missing headers nor `Content-Length: 0` in that seam is sufficient.

An absence-aware producer would need a retained, versioned observation tied to
the exact target, session, request and redirect hop, with interception changes
accounted for. Full framing or a protocol-level absence fact could supply such
evidence within its documented scope. Merely adding a guessed `absent` state or
calling another API that repeats the same unknown cannot do so. A new producer
channel requires separate design and real-provider qualification.

## Completeness ownership and the fix

The existing production chain is:

1. `PlaywrightNetworkContent.captureNetworkBody`: null becomes `not_exposed`;
   an explicit empty Buffer becomes a normal captured body.
2. `PlaywrightScenarioNetwork.collect`: selected `not_exposed` or `unavailable`
   body content, and unavailable headers, add an event-coverage limitation.
3. `PlaywrightScenarioEvents` and `PlaywrightScenarioSession` retain that
   limitation. The browser provider adds `events` to missing sections.
4. `classifyBrowserScenarioCompleteness` produces `incomplete` and
   `equality_eligible: false`. `createBrowserScenarioEvidence` preserves it.

This requirement is consistent with strict full capture, but the API does not
guarantee enough observations to satisfy it for every bodyless request. A
correct failed gate can therefore coexist with all response bodies retained.

The defect was at semantic admission of supplied captures, not this producer
chain. The retained capture schema checked links and counts but accepted
selected `not_exposed` content with `complete` and equality enabled. A synthetic
self-comparison then returned `unchanged`; the same content labelled incomplete
returned `unknown`.

The minimal change requires missing `events` whenever a retained event contains
selected `not_exposed`/`unavailable` body content or selected unavailable headers.
It lives in `retainedBrowserScenarioCaptureSchema`, inherited by the current
schema and used by comparison inputs, browser analysis views and environment
projections. It rejects inconsistent input; it does not rewrite it. Correctly
incomplete historical captures and captured empty buffers remain admissible.
This is one consistency invariant, not proof that arbitrary supplied captures
are truthful or that every possible coverage inconsistency is detected.

Generic Evidence envelope identity remains separate from this semantic check.
An unchanged external Evidence ID already rejects tampering. This regression
concerns synthetic or independently repinned contradictory input, not bypass of
an immutable external pin.

## Synthetic regression results

Executed with Node 24.22.1, Vitest 5.0.3 and the existing dependencies whose
lockfile matches this checkout. The host denied creating `node_modules` in the
new checkout, so the source snapshot was mirrored into an owned temporary
directory and reused the existing installation. No install scripts or browser
downloads ran. This is not clean-install or whole-dependency qualification.

Twenty new test cases cover null versus an explicitly empty buffer, a nonempty
GET body, read errors, GET/HEAD/POST method neutrality, misleading header hints,
unselected body reads, propagation through collector/provider/Evidence, and
semantic rejection of false completeness. Tables exercise both request and
response phases, current and legacy-compatible schemas, and correctly partial
inputs. The tests use synthetic request objects and a fake session; the
collector, content producer, provider and Evidence functions are production code.

- Baseline negative calibration: run the three new rejection cases with the
  original `browserScenarioCapture.ts` from `669e617…`. **3 fail, 10 skipped**,
  because contradictory captures are admitted. The production baseline is
  restored only in the temporary test snapshot, not in the published fix.
- Patched regression suite below: **152/152 PASS in 9 files**. After final
  test-only organization and typing corrections, the provider file was rerun:
  **36/36 PASS**. The four producer-to-Evidence cases retain a successful response
  while varying the request body observation.
- `node scripts/run-typescript.mjs --noEmit`: **PASS**.
- Scoped `oxlint` on the five changed TypeScript files: **PASS**.
- `node scripts/verify-module-boundaries.mjs`: **PASS**, 3,157 source files.
- Scoped `oxfmt --check` and `git diff --check`: **PASS**.

The regression suite is reproducible from a checkout with its locked dependencies:

```sh
node scripts/run-development-tests.mjs local \
  src/browser/network/PlaywrightNetworkContent.test.ts \
  src/browser/network/PlaywrightScenarioNetwork.test.ts \
  src/browser/PlaywrightBrowserScenarioProvider.test.ts \
  src/domain/browserScenarioCapture.test.ts \
  src/domain/browserScenarioDiff.test.ts \
  src/domain/browserNetworkEvidence.test.ts \
  src/application/BrowserScenarioCaptureService.test.ts \
  src/application/analysisView/BrowserScenarioViews.test.ts \
  src/domain/analysisView/scenarioCaptureRecords.test.ts
```

For the baseline negative control, use the added tests with the original schema:

```sh
node node_modules/vitest/vitest.mjs run --project domain \
  src/domain/browserScenarioCapture.test.ts \
  -t 'requires missing event coverage|rejects false complete'
```

Independent read-only review found no blocking issue. The complete repository
gate, generated documentation checks, compiled CLI/MCP and real-browser lanes
were not run. Only the authored contract text changed; no generated schema or
tool catalog was edited. Publication uses a separate branch: opening a PR would
select the repository's real-browser CI lane for these files, contrary to this
task's explicit no-additional-browser-integration boundary.

## Remaining qualification blocker

For the published fresh pilot, the precise unresolved facts are the original
request body or demonstrated absence of a body for GET `/`,
`/api/scene-workspace`, `/api/scene-workspace/candidates`, and
`/api/scene-workspace/source?id=reference`. Those four `not_exposed` observations
still block full capture. The historical result remains **61/62 assertions,
full gate FAIL, exit 1, PARTIAL_CONTROLS_COMPLETE**.

The prior missing responses and unexplained `net::ERR_ABORTED` remain separate
failures. The report's Chrome/Playwright version mismatch and response API
provenance limitations also remain qualification limits, not demonstrated
causes. Synthetic regression success establishes the classification and
validation rules only. It neither repairs those captures nor establishes
reliable full capture in a real browser.
