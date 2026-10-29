# Correcting the bounded launch setup

Recorded after attempt 01, before attempt 02 on 2026-10-26.

Attempt 01 failed before browser capture at the declared 20,000 ms launch deadline. REA returned `cleanup_incomplete`, retaining the primary `provider_timeout`. The nested 30,000 ms timeout is a fixed cleanup-confirmation wait (`PLAYWRIGHT_CLEANUP_CONFIRMATION_TIMEOUT_MS`), not an overall operation cap. We do not infer why Chrome startup exceeded 20 seconds from this message.

Post-exit local resource inspection found the explicitly owned TMPDIR empty, no process command line containing this exact run directory or a Playwright profile, target exit 0, and the private session file removed. The filesystem oracle still passed with sequence 0. These are later local observations; they do not rewrite REA's failed cleanup report as success.

One corrected attempt will use the supported `command_timeout_ms: 60000` and an outer capture command watchdog of 180,000 ms, preserving cleanup headroom. Browser process debug logging is enabled locally to retain a native failure if it recurs. Source baseline, browser executable, real actions, input data and acceptance assertions remain the same. No core or provider changes. Cold launch / isolated HOME remains a hypothesis.

Before retry the harness is formatted with the repository's existing formatter configuration, cleanup is bounded/coalesced, and checks are strengthened with an independent oracle negative calibration, nonzero CLI tamper refusal and copied-source hash check. The exact first-attempt authored bytes remain in its local `harness/` directory and are bound by its original receipt. No third automatic product trial is authorized by this local contract; preserve the outcome of the corrected attempt.
