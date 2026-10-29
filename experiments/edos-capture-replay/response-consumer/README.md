# Apply fixtures to the real frozen EdOS source reader

This lab uses the actual `api`, `openSource` and `save` callback code from the
previously isolated private `SceneWorkspace` baseline. It verifies that one
reference record from the [qualified pack](../response-fixtures/README.md) can
exercise source-reading behavior and controlled failures in an existing product
consumer. It does not run a mounted React component, DOM, browser or server.

For an EdOS developer with the exact private baseline and existing TypeScript
5.9.3 installation:

```sh
node experiments/edos-capture-replay/response-consumer/run-checks.mjs \
  "$PINNED_SCENE_WORKSPACE_TSX" "$PINNED_TYPESCRIPT_JS" \
  "$QUALIFIED_PACK_JSON" "$NEW_OUTPUT_DIRECTORY"
```

All three inputs must be absolute paths. The TSX SHA must be
`3fb2400bc64d676516d08798a715cf3c5d76296d3c3431ed5ddb52d64db04c17`,
the compiler library SHA `3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675`,
and pack SHA `c9cfc0f66b4c50b7dc6da21b20bf66a82928e12caa3573c869dd2a67849bac17`.
The compiler package is also pinned. No dependency installation is performed.
Source/compiler are trusted executable inputs; the harness is not a sandbox.
Private source is read locally and never copied into the output or published.

The command writes a sanitized `RESULTS.json` into a new directory and exits 0
only when all six declared cases pass. Pin mismatch or a failed case closes the
gate. `CONTRACT.md` predates execution; `oracle.mjs` derives expected content from
the independently pinned synthetic fixture, not from the response under test.

| Case | Expected outcome |
| --- | --- |
| Actual current source read | Exact reference fields/text, source pane, loading settled |
| Two overlapping reads | Older completion ignored; current source installed once |
| Unknown source ID | Strict refusal, error exposed, no source/pane installation |
| Actual save with minimal dirty editor | Recorded-intent refusal; draft retained, no saved state/notice |
| Source navigation after refused save | No source GET; dirty draft remains available |
| In-memory generation-guard mutant | Same stale-response oracle detects the forbidden installation |

`probe.mjs` extracts AST nodes and transpiles their exact text. It injects explicit
in-memory refs/setters and a fetch adapter returning real Node `Response` objects.
The adapter checks synthetic transport headers, preserves all JSON fields and
delegates to the existing strict fixture consumer. It never falls back to network.
Queued responses support controlled completion ordering; the normal source guard
is untouched. The calibration mutant changes only its install predicate in memory.

The minimal valid dirty editor adds `dirty: true` to the recorded five-field POST
intent. Full decoded body equality against an independent draft confirms this
specific mismatch. **This pack is not compatible with that actual save request.**
No body fields are stripped to make it pass. The save-success-only helper throws
if reached; the measured refusal occurs earlier at strict matching. Reading-place
migration, successful saving, storage persistence and write tracking are not tested.

The passing receipt establishes bounded application to existing callback code.
It does not establish latest-release compatibility, UI correctness, authentication,
live product writes, external team adoption or product effect. Original full capture
acceptance remains FAIL; the browser/protocol cause is still unknown. See
[report](REPORT.md), [results](RESULTS.json) and [validation](VALIDATION.json).
