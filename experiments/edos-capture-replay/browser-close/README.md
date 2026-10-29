# Bounded browser.close timing and ownership diagnosis

Two no-context browser attempts fulfilled their original close promises in
7722.089146 ms and 7313.035729 ms. Both retain **release UNKNOWN** and partial
matrix status. The remaining three variants were not run because the ownership
gate stopped each attempt. The historical mounted overall FAIL and REA
full-capture FAIL remain unchanged; their native causes are unknown.

No EdOS import, server, save, capture or replay ran here. This work tests the
browser lifecycle and fixes lab observability. See [receipt](RECEIPT.json),
[report](REPORT.md), original [contract](CONTRACT.md),
[one setup correction](CORRECTION.md) and [setup limitations](SETUP-LIMITATIONS.json).

Use an existing Node 24.22.1/Playwright 1.58.2 installation and explicitly select
an installed Chrome executable. No download or install is performed. A fresh
output path is mandatory. The controller creates only its own temporary profiles.

```sh
node experiments/edos-capture-replay/browser-close/diagnose.mjs \
  /absolute/chrome /absolute/new-private-output
node experiments/edos-capture-replay/browser-close/calibrate.mjs \
  /absolute/new-private-output
node --test experiments/edos-capture-replay/browser-close/*.test.mjs
```

Controller exit0 means diagnostic completion, **not acceptance**. Read individual
claims, matrix status and setup outcomes. Record validation checks evidence
consistency; it does not authenticate JSON or prove original promise ownership
independently of the reviewed driver. Calibration invokes no browser.

Public observations omit only the private retained execution path and are
reserialized projections; raw record/log hashes and exact local sources are
retained. Process identities expose hashes rather than raw command arguments.
The delayed-reap probe output and source were reconstructed from the complete
tool record and are explicitly labelled; they are not attested raw stdout.

The mounted pilot now records one original close through a 45 s diagnostic ceiling
while retaining its 10 s gate. Its adapter was verified with six controlled promise
cases, without executing EdOS. It does not add OS ownership proof to the mounted
pilot. The latest mismatch-detail instrumentation is checked synthetically only.
