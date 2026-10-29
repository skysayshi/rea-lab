# Bounded browser-close timing and ownership diagnosis

Declared 2026-10-29, Europe/Berlin, before execution. Fork input is
`ae7b1b926ac1d20c37d995683f4ef5df2fdacccc`, tree
`4e0c04537d458bd8c011bfc46f4c13179073fd68`; research input is `5900dee`.
The original mounted result SHA is
`9d86346e17a3455d8281f3d46260b0bd3fcb868f9b5b1b39d3efbcaa38905b44`:
functional oracle PASS, overall FAIL at a 10-second browser-close deadline.
Its API settlement time and close-delay cause remain unknown.

Use the same existing Node 24.22.1, Playwright 1.58.2 and selected installed Chrome
with headless launch defaults. Bind the current launcher/framework, Node, full
Playwright file manifest and authored code before/after. No install or upgrade.
Do not import/build EdOS, start its handler/server, replay its workflow, access
its data, or perform any new product write. New browser profiles and diagnostic
files are created only under newly owned temporary/output directories.

Contexts use the preceding mounted pilot’s viewport (1440×1000), ru-RU locale,
UTC timezone and blocked service workers. Run each of four cells once,
sequentially, with a fresh launched browser:

| Cell       | State before closing                                                                  |
| ---------- | ------------------------------------------------------------------------------------- |
| no-context | No explicitly created context                                                         |
| one-empty  | One empty context, then await its close                                               |
| two-empty  | Two empty contexts, close them sequentially                                           |
| two-blank  | Two isolated contexts with one about:blank page each, then the same sequential closes |

This bounded matrix separates minimal launch, context count and blank-page
lifetime without product behavior. Cells are not independent replications.
Do not repeat to obtain PASS or add product traffic. A failed setup may be
corrected once with all original receipts preserved; a behavioral or timing
failure is evidence, not permission to weaken the criterion.

The original close acceptance threshold stays **10,000 ms**. Retain and timestamp
one actual `browser.close()` promise per cell. Continue observing that same
operation through a separate **45,000 ms diagnostic ceiling**. Late fulfilment
does not change deadline FAIL. Rejection or a pending operation retains ownership.
Do not call close a second time as an observer and do not send a second CDP close.
The installed SDK's source has an internal 30-second graceful-close/kill budget;
the public API also waits for launcher cleanup. That source fact alone does not
diagnose the old failure.

Record monotonic API invocation/settlement and public disconnected/context-close
events. Retain `pw:browser,pw:protocol` logs separately. Log-derived phase times
are parent receipt times; cross-stream receipt order is not exact causality.
The SDK's `<process did exit>` line comes from Node child **close**, not the exact
OS exit event. An absent SEND Browser.close line is expected because this SDK
sends that command directly; an optional reply is not required acceptance proof.

The controller owns the child and its output root by an exclusive run marker.
Validate the launched browser PID against its own launch log, start/command
identity and profile path inside that run's TMPDIR. Sample only the resulting
owned process tree/group; retain known identities after reparenting. Record
process absence and actual profile/artifact-directory absence separately from
API settlement. A PID alone, a sampler error or a foreign run identity never
authorizes cleanup. A hard per-cell watchdog may terminate only verified owned
processes and must be recorded as intervention/FAIL; it is not a successful close.
Retain ownership until completion or verified recovery, and remove only owned
temporary files. The outer safety bound is 90 seconds per cell.

A pure oracle checks record consistency and derives timing/ownership outcomes.
On separate in-memory copies, require it to reject (1) a successful timely-close
claim whose original settlement lies after 10 seconds, and (2) a release claim
with a foreign run identity. Both must fail their intended assertion, not parsing
or unrelated setup. These controls invoke no browser or process signal.

A separate close-observation utility is tested with deterministic synthetic
promises/clocks: one invocation, early fulfilment, late fulfilment, rejection and
pending-at-ceiling ownership. These are helper regressions, not native browser
observations. A confirmed loss of ownership/settlement evidence in the lab driver
may be fixed using this observer while preserving its 10-second acceptance gate.
Do not change REA core, SDK, browser options or acceptance threshold to explain
unconfirmed native behavior. Validate any lab fix without another EdOS write.

Preserve the initial setup FAIL, original mounted overall FAIL, historical REA
full-capture FAIL and incomplete captures. New empty-browser observations cannot
retrospectively establish the original API settlement or native cause. Report
observed SDK fallback/phase intervals separately from causal hypotheses. The
result does not qualify a mounted workflow, full capture/replay, production auth,
release, adoption or product effect.
