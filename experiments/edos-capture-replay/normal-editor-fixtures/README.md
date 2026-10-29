# Recorded normal editor flow

This portable fixture checks one recorded EdOS sequence: normal candidate
creation, editing and saving the same candidate, then refusing a stale save.
It makes the full seven-field/ten-field editor requests available to a developer
or CI job while retaining exact matching and the older fixture refusals.

```sh
node experiments/edos-capture-replay/normal-editor-fixtures/check-portable.mjs
```

Use Node 24.22.1 for the check. Only Node built-ins and the checked-in synthetic
fixture are required. The
portable module is `loadReplay(bytes, externalPin)` from [replay.mjs](replay.mjs).
An expected raw pin must be supplied separately from incoming fixture bytes:
`120b70977be11e62cff41b0282dbb6786cb008f342a210092c8364792b6aad13`.
Each `newSession()` owns an ordered cursor; `select(intent)` requires exactly
`{method,path,query,body}` matching the next recorded request. A refusal consumes
nothing, returned responses are clones, and exhausted sessions refuse further
operations. JSON object key order is immaterial; every field and value matters.
Reading a recorded response never executes a save or renews authorization.

| Operation                      | Complete POST fields                                   | Recorded response                   |
| ------------------------------ | ------------------------------------------------------ | ----------------------------------- |
| Normal create                  | 7, including `dirty`, `expectedSequence`, `readingKey` | 200, sequence 1                     |
| Edit and resave                | 10, including candidate identity and prior timestamp   | 200, same id, sequence 2            |
| Separately opened stale editor | 10, with stale sequence and its own text               | 409, no historical revision changed |

## Origin and current verification

The exact [fixture](fixture.json) and [historical capture receipt](HISTORICAL_CAPTURE.json)
come from the separate 2026-10-27 EdOS experiment. That experiment executed eight
actual source callbacks and the real handler in memory against temporary
synthetic files. It retained the two revision payloads and the unchanged revision
hashes after the stale write. It did not mount React or use a browser. Source,
compiler, generator, callback and oracle pins are retained in these artifacts.
Private source and local input-path manifests are not published.

On 2026-10-28 the unchanged historical offline runner was executed once after
checking its saved validation manifest. All six grouped cases passed, including
73 refused intent variations and preservation of the old five-/six-field fixture
refusals. All 52 selected input/artifact hashes matched before and after.
The runner used the pinned product callbacks and TypeScript 5.9.3 with an injected
recorded transport; it read the handler source to verify its hash but did not
import or execute the handler. No new capture, browser, server or storage write
occurred. [RECEIPT.json](RECEIPT.json) records the separate scopes and digests.

The existing oracle independently declares text, fields, sequence and expected
dirty-state preservation. Server UUID/time are validated and cross-linked rather
than independently predicted. Four matching snapshot hashes establish consistency
between the old isolated-handler run and current replay; they are not an
independent correctness oracle. The standalone portable check uses known fixture
cases and does not execute product source. Its results must be counted separately
from the six actual-callback groups and from the historical runs.

The portable replay changes only the old module's hash dependency: Node crypto
replaces the import from a private producer helper. The historical module and
original files remain unchanged. Immutable synthetic JSON files are excluded from
formatting to retain their external raw pins.

## Why the browser capture is still incomplete

The [fresh body-presence capture](../body-presence-runtime/live-20261028/REPORT.md)
has three native request-body gaps: content events 2, 6 and 11, belonging to the
initial navigation, the explicit GET and the empty POST. Its disabled-observer
control also retains `unknown` at event 24. The collector records these gaps and
the provider maps them to `missing_sections: ["events"]`; no events were dropped.
All five action/artifact steps completed, which does not make global event
coverage complete. Native `not_exposed` is not evidence of semantic absence.

`response_body: false` is an unselected facet, not an additional missing selected
facet or the cause of `incomplete`. It does mean that this particular capture
cannot supply recorded response bytes. The fixture here comes from the different
historical isolated-handler experiment; no response is invented or borrowed into
the browser capture. A positive-only action set would still include the initial
navigation GET under the current launch lifecycle.

## Supported use and boundary

Use this exact fixture for the declared create/update/stale-save regression and
its full request bodies. The older five-field response pack and minimal six-field
fixture continue to refuse these normal editor requests under their own contracts.
Their historical failures and refusals are not relabelled.

**Historical full-capture acceptance remains FAIL**, and the fresh browser
capture remains incomplete/equality-ineligible. This fixture does not repair native
body exposure or the earlier browser/protocol cause. Its scope does not establish
arbitrary editor compatibility, auth renewal, mounted React/DOM, live disk saving
during replay, current bundle behavior, official capability, release, adoption or
product effect. No product or REA core correction is warranted by this evidence.

This bounded reuse is complete when the preserved-input recheck and portable
consumer are verified. Further expansion should answer a concrete application
question, such as a separately declared mounted editor/transport check; repeating
the same synthetic body-presence smoke does not close that boundary.

## Mounted follow-up

[The 2026-10-29 mounted editor/HTTP pilot](../mounted-editor/README.md) observes
the real component create/update/stale-save path with a separate oracle. Its
functional assertions passed, but overall acceptance is FAIL because browser
close exceeded the cleanup deadline. This recorded fixture keeps its own scope.
