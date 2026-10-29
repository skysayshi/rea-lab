# Bounded reuse of the recorded normal editor flow

Declared 2026-10-28, Europe/Berlin, before current verification. Recipient: a
developer or CI job checking the recorded EdOS create/update/stale-save contract.
Fork input is `d148c9e1fdc23fda38b761338eea75786b5ff421`, tree
`a60b749ae6bdae883deae8eddf2b197a2b157476`; research input is `6451704`.

The preceding synthetic browser capture is correctly incomplete: request content
sequences 2, 6 and 11 are `not_exposed`, and presence sequence 24 is intentionally
`unknown`. No events were dropped. Response bodies were not selected, so that
corpus cannot provide recorded response fixtures. Neither changing completeness
nor inventing response bytes is an admissible next step.

Reuse the existing separate EdOS experiment from 2026-10-27. Its fixture was
produced by actual source callbacks and the real handler in memory with temporary
synthetic storage. The producer and independent oracle are distinct modules.
Preserve that historical capture and its original results. Record all imported
artifact digests and check the existing validation manifest before execution.
This is a known-case retrospective reuse, not a newly blinded experiment.

Run its unchanged `run-checks.mjs` once with Node 24.22.1 and the already installed
trusted product source/compiler. Verify the exact component, server, fingerprint,
compiler and callback pins against the fixture. The current run must execute only
offline callbacks with explicit dependencies and the strict recorded transport;
it must not invoke the capture generator, handler, browser, HTTP listener or new
storage writes. Keep stdout/stderr in a new local directory. Require six grouped
cases, all 73 declared mismatched requests refused, four state snapshots matching
the historical isolated-handler capture, and original input/artifact hashes
unchanged afterward. Preserve any failure; do not retry merely to obtain PASS.

Publish the exact synthetic fixture bytes only after review for author data,
credentials and private paths. Expected raw SHA-256 is externally fixed:
`120b70977be11e62cff41b0282dbb6786cb008f342a210092c8364792b6aad13`.
Make its existing ordered replay module portable by replacing only its hash-helper
dependency with Node crypto. It must keep exact method/path/query/full JSON body
matching, no fallback, no consumption on refusal, cloned results and exhaustion.
The original historical module stays unchanged.

The standalone portable check covers create/update/stale replies, independent
expected field sets and status/sequence boundaries, the 73 known mismatches,
ordering, refusal preservation, external pin/tamper and returned-copy isolation.
Its expected requests are known fixture cases; this portable check is not an
independent product oracle. The actual-callback recheck uses the separate existing
oracle. Counts from different runs or grouped assertions must not be added into
an independent-sample count. Any helper correction and repeated verification
must be labelled.

Keep the old five-field and six-field fixture refusals. The recorded normal
create has seven fields; update/stale requests have ten. Compatibility applies
only to these three exact ordered operations and these source pins. No arbitrary
editor, auth renewal, mounted React/DOM, current bundle, disk save during replay,
browser capture, official capability, release, adoption or effect is qualified.
Historical full-capture FAIL and current browser incompleteness remain unchanged.

Stop when the preserved-input recheck and portable strict consumer are supported
and published with current evidence. A further browser experiment needs its own
consumer question and predeclared selection/acceptance contract.
