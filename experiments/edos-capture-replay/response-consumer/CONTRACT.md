# Apply recorded responses to the existing EdOS consumer

2026-10-27, declared before execution. Follow v0.13's usable fixture pack with a
bounded application to the real frozen `SceneWorkspace` source. Recipient: an
EdOS developer maintaining source-reading and draft-preservation behavior.

Use the unchanged private TSX SHA
`3fb2400bc64d676516d08798a715cf3c5d76296d3c3431ed5ddb52d64db04c17`
from the previously isolated scene-recovery baseline. Git HEAD alone does not
identify that dirty historical product checkout. This test does not claim to run
the latest EdOS release or to establish product-team adoption.

Extract the actual `api`, `openSource` and `save` callback AST nodes using the
already installed TypeScript compiler. Execute their unaltered code with explicit
in-memory refs/setters and a fixture-backed fetch adapter. Do not import the whole
React component or start DOM/browser/server machinery. These are trusted local
executable inputs, not sandboxed hostile source. Record compiler and source hashes
before/after. Publish harness/tooling and sanitized results, never private source.

Keep the v0.13 raw pack pin and strict intent matching. The adapter may translate
the product's declared synthetic transport headers into the explicit offline
consumer call; it must validate those headers, preserve method/path/literal query
and every JSON body field, and never perform networking. Authentication is not
being simulated or renewed. A successful POST JSON decoding alone would not prove
the actual editor-save flow is compatible.

Independent expected source content comes from the original synthetic fixture and
its source-text digest, not from the selected response. Required observations:

1. The actual current-generation source callback consumes the reference and sets
   exact source identity/title/file/revision/text, source pane and settled loading.
2. With two overlapping reads, the older completion does not install source/pane;
   the current completion installs the expected source exactly once.
3. An unknown source query is refused, reports error and does not install content.
4. The actual dirty editor-save request includes fields absent from the recorded
   POST intent. The strict consumer must refuse it; the draft and dirty state stay
   available, no success notice or saved-state update is fabricated. An attempted
   source transition depending on that save must also remain closed.
5. A separately labelled in-memory mutation that removes only the source-install
   generation guard must fail the same stale-response oracle. It is a calibration
   mutant, never a proposed product fix or an edit to baseline source.

No permissive fallback, filtering of POST fields, synthesized bootstrap capture,
historical receipt rewrite, product source change, installation, full build or new
browser/capture is authorized by this narrow test contract. A real newly confirmed
product defect would require an explicit revised bounded correction contract.
Full capture acceptance stays FAIL. Preserve unknown browser cause, auth, DOM/UI,
stateful-save, release, adoption and effect boundaries. Stop after meaningful tests,
review, evidence and updates to the two existing draft PRs.
