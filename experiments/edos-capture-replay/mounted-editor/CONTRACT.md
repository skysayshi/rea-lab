# Mounted editor / HTTP transport pilot

Declared 2026-10-29, Europe/Berlin, before building or executing the pilot.
Recipient: an EdOS developer assessing one create/update/stale-save path through
the actual mounted scene component. Fork input is
`326617230eaa7d5914efac173368c3e721f6d7c7`, tree
`693ab10da8c432334f16fc4801e95a62cac06fbd`; research input is `05c849f`.

Use the existing product source and installed dependencies read-only. The product
checkout is shared and dirty: a Git head alone does not identify the tested code.
Require component SHA `3fb2400bc64d676516d08798a715cf3c5d76296d3c3431ed5ddb52d64db04c17`
and handler SHA `705e2b4873772e9649bc3b52b445658e10592c1f62b8f79a4f6e191cc841676c`.
Copy the complete component and its real local runtime dependencies unchanged to
a newly owned temporary source tree, bind every copied source and physical browser-bundle module by SHA, record
selected build-package entries, and compare originals afterward. Virtual module
identities are recorded separately. This is not a hermetic attestation of the
complete Node dependency graph or host. Use installed Node 24.22.1,
React/ReactDOM 19.2.8, Vite 8.2.1 and the selected installed Chrome. No install,
upgrade, product launcher, product build directory or author corpus is used.

A minimal entry mounts the actual `SceneWorkspace` with `ReactDOM.createRoot`.
StrictMode is off. React hooks, DOM event handlers, storage, fetch and local
imports are real. A stable before-leave registration holder supplies the required
outer prop; the outer Flightdeck, AccessGate and before-leave flow are outside
this test. No extracted callbacks, setter doubles, fetch interception, recorded
responses, state injection or altered save/sequence logic may obtain PASS.

Build once using a private root/cache/output directory. Serve that bundle and
the unchanged real `handleSceneRequest` on one owned HTTP literal-loopback origin.
Create source/config/candidate directories exclusively under the new temporary
tree using only [fixture.json](fixture.json). The GET bootstrap supplies the
ephemeral token naturally; POST must use the real token, browser Origin and
normal client headers. Record only token-match booleans, never its value.

One coherent trial uses two isolated browser contexts:

1. A mounts, opens a new variant, edits through visible fields and saves create.
   Require HTTP 200, exact seven-field request and revision 1.
2. B mounts after creation, opens the same saved candidate at sequence 1 and
   edits the independently authored stale title/text.
3. A edits and saves update. Require HTTP 200, exact ten-field request, same
   candidate ID and revision 2. Revision 1 must remain byte-identical.
4. B saves. Require real HTTP 409 for its sequence-1 ten-field request. This is
   the live negative control: exact title/text/reading key and dirty UI remain,
   save becomes enabled, the error is shown, and both revision files stay
   byte-identical with no new or pending file.

The separate oracle must not import the product, handler, build or driver.
It independently derives expected payloads from the predeclared input, checks
complete field sets and sequence 0/1/1, validates UUID/time shape and causal links,
and reads revision bytes directly. Browser requests/statuses and server-received
payloads must match; response bodies need not be read through Playwright's native
body API. DOM assertions require exact values and saved/dirty/button/alert states.
Dynamic server IDs and times are observed then validated, not independently
predicted. Saved file values, not the handler's returned object, are the storage
oracle. No reload recovery, selection/scroll or full internal React-state claim.

Use finite build and trial bounds, 10-second DOM/action waits and a 120-second
trial watchdog. Close contexts/browser/server in finally; retain results even on
failure. Remove only the newly owned temporary execution tree after retaining
synthetic receipts and bundle/source manifests. Verify original source/dependency
bindings afterward. One concrete setup-only correction may be tried if necessary,
with the original failed attempt retained and the reason stated; no quiet retry
of a failed behavioral oracle. Stop on unexpected data access or unresolved cleanup.

Publish reviewed authored harness/oracle, synthetic observations, hashes and
outcomes; private product sources, bundles, credentials and host paths stay local.
The 409 is a product/transport negative control, not an independent replication
or a calibrated mutant test. A scoped PASS establishes this mounted component
with this synthetic handler/storage and source pins. It does not qualify the full
studio, production auth, current deployed bundle, arbitrary editors, release,
adoption or product effect. Historical full-capture FAIL and previous REA
incomplete/equality-ineligible captures remain unchanged. This is not a new REA
capture/replay run or a fix for its native body exposure.
