# Mounted EdOS editor / HTTP transport pilot

2026-10-29. The actual mounted `SceneWorkspace` completed create, update and a
stale-save refusal through real browser fetch and the unchanged HTTP handler.
The independent functional oracle passed all five declared groups. **Overall
pilot acceptance remains FAIL:** browser close exceeded its 10-second cleanup
deadline. Later resource absence and cleanup are recorded separately and do not
rewrite that failure.

| Attempt   | Observed result                                                                                                                               | Acceptance                                                 |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 01        | Vite built the page; progress text polluted the stdout metadata channel. Driver failed parsing JSON before handler/browser startup.           | SETUP FAIL; no browser trial or POST                       |
| 02        | One mounted two-context trial; HTTP 200/200/409 and functional oracle PASS. Browser-close deadline exceeded; scratch retained.                | Overall FAIL                                               |
| Follow-up | Expected Playwright processes/profile/artifact directories absent; 1815 bound inputs unchanged. The validated owned scratch tree was removed. | Resource absence observed; original deadline FAIL retained |

The one contract-permitted setup correction moved structured build metadata into
an exclusive file. Stdout remains a build log; no stripping or permissive parsing
is used. The deprecated Vite `envFile:false` setting became `envDir:false`.
The oracle, product files and behavioral criteria were unchanged. There were two
build attempts and exactly one browser trial. No further trial was run for PASS.

## Mounted path and oracle

A production build mounts the whole unchanged component with
`ReactDOM.createRoot`, real hooks, local helper modules, DOM events and browser
storage. StrictMode is off. A registration holder supplies the outer before-leave
prop; the full Flightdeck/AccessGate and navigation owner are outside this mount.
There is no callback extraction, setter replacement, fetch interception, response
replay or injected editor state.

One owned loopback HTTP server serves the bundle and the real
`handleSceneRequest`. It forwards the original Node request/response objects;
passive observers retain synthetic POST payloads and replies. The component gets
its fresh token through the normal GET and sends it with real browser Origin.
Receipts retain match booleans, never the credential value. All source/config/data
files belong to a new synthetic temporary tree.

| Action                                  | Exact body                            | HTTP/file outcome                                        | Mounted DOM outcome                                                               |
| --------------------------------------- | ------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| A creates                               | 7 fields, expectedSequence 0          | 200; one candidate, revision 1                           | exact title/text, saved status, disabled save                                     |
| B opens revision 1 and edits; A updates | A sends 10 fields, expectedSequence 1 | 200; same candidate ID, revision 2; revision 1 immutable | A displays exact update, saved status, disabled save                              |
| B saves its stale edit                  | 10 fields, expectedSequence 1         | 409; both revision files and filenames unchanged         | exact stale title/text/reading key, dirty status, enabled save and conflict alert |

The 409 is the live negative control. It demonstrates the conflict path through
the real UI/transport and handler. It is not a mutant calibration or independent
replication. Browser-observed request bytes/statuses match the server receipts.
Four DOM snapshots and direct revision bytes support the five oracle groups in
[oracle.mjs](oracle.mjs). Expected values come from the predeclared
[synthetic input](fixture.json), not from returned response objects. Server UUIDs
and timestamps are observed, validated and causally linked. Reload recovery,
selection/scroll and complete internal React state are untested.

## Inputs and retained evidence

Node 24.22.1, React/ReactDOM 19.2.8, Vite 8.2.1, React plugin 6.0.5, Rolldown
1.2.3 and Playwright 1.58.2 used the existing installations. The selected Chrome
and actual browser both reported **156.0.8078.73**, a different installed patch
from the preceding `.48` observations. No software was installed or upgraded by
this experiment and no browser-version comparison was performed.

The shared product checkout is dirty. Eleven selected original files, including
the complete component, runtime-local helper sources and package manifests, were
copied unchanged. Component SHA is `3fb2400b…04c17`; handler SHA is
`705e2b48…676c`. The loaded browser module graph has 1792 entries: 1781 dependency,
10 snapshot and one virtual module. Physical modules carry raw hashes; virtual
identity has a separate digest. Source/package/module bindings were rechecked
after build and trial, and again before removing the retained tree. Fourteen
external driver/environment inputs and 363 Playwright files also matched their
declared before/after bindings. These selected bindings are not a hermetic
attestation of all Node dependencies, the complete browser bundle or host OS.

[RECEIPT.json](RECEIPT.json) links the attempts, raw observation, exact original
result digests, build/source bindings, screenshots and cleanup follow-up.
[OBSERVATION.json](OBSERVATION.json) is the exact synthetic functional record.
[RESULT.public.json](RESULT.public.json) is a labelled projection of the original
FAIL result with its private scratch path omitted; it is not a replacement raw
result. Private source, compiled bundle, original local logs and screenshots are
not committed. The original failed results stay unchanged in local evidence.

## Cleanup boundary and supported decision

The contexts and HTTP server closed within the declared bounds. `browser.close()`
did not settle within 10 seconds. The original result retained the owned tree and
returned nonzero. A later bounded process/temp-directory check found no expected
Playwright Chromium processes, profiles or artifact directories. The follow-up
validated the retained tree's identity and source bindings before removing it.
This establishes the later observed resource state; it does not establish the
API completion time or diagnose the close delay. The cause remains unknown.

The mounted functional path is observed at these exact source/environment pins.
The complete pilot is not accepted until its lifecycle boundary is separately
understood and verified. A useful next discriminator is a predeclared browser-close
timing/ownership check with an appropriate empty-context baseline; repeating
product writes without that discriminator is unnecessary.

**Historical REA full-capture acceptance remains FAIL**, and its earlier native
body gaps remain. This experiment did not run REA capture/replay or read response
bodies through Playwright's native body API. It does not fix `net::ERR_ABORTED`,
qualify the complete studio, production auth, arbitrary editors, current deployed
bundle, release, adoption or product effect. REA core and product source were not
changed.

To repeat only under a separately chosen contract, use the trusted reviewed
product tree and existing installations with a new output directory:

```sh
node experiments/edos-capture-replay/mounted-editor/pilot.mjs ABS_PRODUCT ABS_CHROME NEW_OUTPUT
```

The tool imports trusted build tooling and executes the reviewed handler. It is
not a sandbox for an untrusted repository. Build is bounded to 60 seconds, the
browser trial to 120 seconds, DOM actions and each cleanup stage to 10 seconds.
