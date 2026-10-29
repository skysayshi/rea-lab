# Research integration: synthetic readiness testnet

Read [the pre-run contract](CONTRACT.md). The driver imports existing REA domain APIs and the repository's synthetic fixtures; it does not add a runtime tool or change core semantics.

From the repository root, after isolated dependency preparation with the pinned Node development runtime:

```sh
node experiments/research-integration/run-testnet.mjs --output-dir /caller/owned/new-output-directory
```

The output directory must not exist. Use an external watchdog; results belong outside the tracked checkout. `receipt.json` distinguishes scenario execution success from the `ready/partial/unknown/failed` values being tested. The `packets/` directory contains actual serialized synthetic domain inputs and results for downstream stateless auditing, bound by raw hashes in `packet-index.json`.

Baseline source commit defaults to `669e617eec5422ebce1ab271af0fc7b51e90dc11`; `--source-commit SHA` selects another explicit source baseline. The driver verifies its declared production inputs against that Git revision and records the actual execution HEAD. Changing the baseline requires reviewing applicability again. The receipt retains the effective source revision in its reproduction command; only the output directory is redacted.

The `command_success_vs_semantic_status` scenario exercises a domain-produced `Result`, not the REA CLI. Add a separately generated actual CLI/MCP receipt for parity. All packaged proofs and replay labels in these packets are synthetic. A green receipt must not be reported as authenticating real replay or full product readiness.

No result is claimed in these files before execution. Do not commit generated reports, binaries, `node_modules` or private runtime paths. Reruns use a new output directory and retain the original attempt.
