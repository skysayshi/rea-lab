# Bounded EdOS capture / replay pilot

Pre-execution contract, 2026-10-26. User authorized this local project pilot and updates to existing draft PRs. No deployment, live project data, shared configuration changes, or upstream merge.

## Frozen subjects

- REA product baseline: `669e617eec5422ebce1ab271af0fc7b51e90dc11`. Worklab branch before this experiment: `383a705be141777a0e5691fa9eeaf9dbf6645d34`. Existing compiled runtime is the earlier baseline build; record all dist bytes and the lockfile. Current test-only/helper/doc/lab changes do not qualify a rebuild or clean installation.
- EdOS: reuse the isolated scene-recovery pilot baseline, original recorded Git head `6b1b7c4ca050b42f001d9a62c1383f8e1cd5a060`. Execute an unchanged copy of `scripts/scene-workspace.mjs`, identify it by raw SHA-256 before and after. This is an older frozen project module, not a claim about current EdOS HEAD or full UI.
- Inputs: newly authored synthetic scene text/config/reference only, under a newly owned temporary directory. Original project and baseline files remain read-only. No personal scene text or production credentials.

## Operation and independent oracle

An owned loopback HTTP wrapper imports the real EdOS handler. REA launches an installed Chrome with its own temporary profile. A tiny bootstrap page calls the real GET endpoint and obtains its ephemeral session token. REA browser request actions then POST one candidate with the real token and read it back. This is a browser-mediated API scenario, not the full EdOS frontend journey.

Before execution, the independent checker commits the exact fixture text, candidate title/text, section id and expected sequence. The application generates a fresh candidate UUID; the first-create request must omit id. The checker reads the actual filesystem directly without importing EdOS or REA: exactly one sequence file, expected payload/status and a well-formed generated UUID, unchanged original text and no pending publication files. Run after capture, after live negative controls, and after offline replay. Derive expected revision independently with SHA-256.

## Distinct authentication and replay checks

1. Product authentication: correct fresh token permits the write; wrong token must return 403 with no extra write. Reusing the accepted request against the live target with stale sequence must return 409 with no extra write.
2. Evidence integrity: consume the actual CLI-produced complete Evidence via the public `inspect-analysis-view` evidence-file route with its externally retained original ID; derive an environment manifest. A semantic alteration without recomputing the ID must be rejected. This is unkeyed content identity and source binding, not cryptographic signer/actor attestation.
3. Offline replay: stop the original target, then serve the derived manifest and original Evidence with `environment-serve --replay-only`. Use actual MCP tools/list and tools/call. Compare recorded successful POST and GET bodies with the independently read filesystem. Require `replay.exact_match:true`, correct capture ID, retained body and no truncation. Assert the target remains unavailable and filesystem unchanged.
4. Replay negative: change an observed source-read query argument. A replay response may still fall back to a recording; require `exact_match:false` and treat any 200 status as insufficient. This tests detection, not a guarantee of rejection or renewed authorization. REA replay matching considers paths/query, not POST bodies or tokens. A POST `exact_match:true` therefore does not attest either of those inputs; explicitly test an altered POST body as an additional limitation control, expecting the recorded response to remain unchanged.

## Bounds and handling

One coherent capture and replay trial. Each CLI command has a watchdog, browser actions have explicit deadlines, owned target and replay server are closed in finally. A concrete setup failure permits one corrected attempt with the first failure retained; no oracle relaxation or silent retries. Stop on target mutation outside the owned directory, unresolved cleanup, missing body/provenance or token leakage in publishable artifacts.

Declare the ephemeral token as a redaction secret before capture. Raw scenario/capture, temporary session file, MCP replies and command logs stay local. Publish only reviewed authored harness/docs and sanitized hashes/outcome receipts; no private source or token. A source or artifact digest is not a signature.

Passing qualifies this frozen local browser/API capture and offline response replay only. It does not establish fresh authorization during replay, stateful application emulation, full EdOS UI correctness, production readiness, deployment, causal productivity, or adoption of REA in a main workflow. Preserve earlier synthetic and lifecycle evidence with their own scopes.
