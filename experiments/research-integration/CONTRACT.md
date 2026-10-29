# Synthetic reconstruction readiness testnet contract

Recorded before execution on 2026-10-26. This is a bounded research integration experiment on the user's REA fork, not a replacement for REA's existing verification or a new provider.

## Subject and authority

- Initial source baseline: `624ebb2a1e633ce14b6d6828eef50bf7d7db68ac` from `skysayshi/rea-lab`. The executed baseline is upstream `669e617eec5422ebce1ab271af0fc7b51e90dc11`; the four intervening fixes do not change this experiment's declared domain inputs. The explicit revision and input hashes in each receipt determine its actual scope.
- Only this new `experiments/research-integration/` directory may be edited by this workstream. Core source, package metadata, original assertions, host settings and remote refs remain outside its mutation scope.
- Inputs are self-authored synthetic data through existing domain APIs and fixtures. No target executable, debugger, original application, model, network service or credentials are required or exercised.
- Existing source loader `scripts/lib/verifier-source-loader.mjs` loads the production TypeScript domain implementation. Do not reimplement the closure evaluator.

## Ten scenario families

1. Complete synthetic closure is a positive `ready` control.
2. An Evidence envelope with an unrecomputed semantic alteration is rejected.
3. Stale verifier contract, owner or artifact commitments cannot reuse a green result.
4. Stale/future time cannot reuse a current observation.
5. An unallowed active residual unknown remains gating.
6. Producer omission means unknown coverage; deleting required serialized coverage is rejected.
7. All registered verifiers passing does not close a missing required inventory surface.
8. A successful domain Result envelope is distinct from semantic `ready`. This is not an actual CLI invocation; CLI parity requires a separate receipt.
9. Raw byte SHA-256 and canonical JSON SHA-256 have distinct domains.
10. Self-consistent synthetic observed/authority labels can satisfy metadata policy but do not authenticate an actually executed replay.

Some families have positive/negative subcontrols. Family count is ten, not an independence count; subcontrols and repeated runs do not create additional independent experiments.

## Acceptance, outputs and stops

The driver must fail nonzero on an unexpected assertion, zero executed scenarios, wrong source baseline, import/setup failure or input mutation. It writes an outer JSON receipt plus exact synthetic input/result packets into a newly created caller-owned output directory. Existing outputs must not be overwritten. Receipt data includes runtime, source commit, actual HEAD, declared raw input hashes, family results, failures and explicit non-promotion flags. A canonical Evidence identifier is not a raw-file hash or trusted external attestation.

Run only after the primary executor reviews the files and prepares isolated locked dependencies. Start with one invocation under an external 120-second watchdog; no automatic retries. Preserve the first failure. Stop for unexpected network/target execution, writes outside owned outputs, unbounded resource use or unavailable required reports. A specific repaired setup cause can justify one new run; changing the evaluator or oracle to manufacture a green result is outside scope.

Passing qualifies these synthetic policy checks on the recorded source. It does not establish real CLI/MCP parity, a real reconstruction, provider compatibility, independent provenance, clean installation, release, adoption, safety containment or causal productivity. Product and maintainer acceptance are separate decisions.
