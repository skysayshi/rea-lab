import assert from "node:assert/strict";
import test from "node:test";
import { assessPilot, targetShutdownPassed } from "./pilot-assessment.mjs";

const passing = (overrides = {}) => ({
  checks: [
    { label: "capture complete", pass: true, gating: true },
    { label: "independent file oracle", pass: true },
  ],
  cleanup: [
    { name: "target", forced: false },
    { name: "private-session-file", removed: true },
  ],
  controlsCompleted: true,
  targetExit: { code: 0, signal: null },
  ...overrides,
});
const failed = {
  status: "FAIL",
  full_acceptance: "FAIL",
  exit_code: 1,
};

await test("accepts completed gates only after clean target exit and cleanup", () => {
  const input = passing();
  const original = structuredClone(input);
  assert.deepEqual(assessPilot(input), {
    status: "PASS",
    full_acceptance: "PASS",
    exit_code: 0,
  });
  assert.deepEqual(input, original, "assessment does not rewrite observations");
});

await test("preserves diagnostic completion separately from failed acceptance gates", () => {
  const checks = [
    ...Array.from({ length: 58 }, (_, index) => ({
      label: `diagnostic ${index}`,
      pass: true,
    })),
    ...["capture completeness", "reference body", "query-negative body"].map(
      (label) => ({ label, pass: false, gating: true }),
    ),
  ];
  assert.equal(checks.length, 61);
  assert.deepEqual(assessPilot(passing({ checks })), {
    status: "PARTIAL_CONTROLS_COMPLETE",
    full_acceptance: "FAIL",
    exit_code: 1,
  });
});

await test("late cleanup and token-log failures override otherwise passing gates", () => {
  for (const cleanup of [
    [{ name: "mcp-client", error: "close failed" }],
    [{ name: "target", forced: true, exit_confirmed: true }],
    [{ name: "capture", token_in_local_log: true }],
    [{ name: "private-session-file", removed: false }],
    [{ name: "target", exit_confirmed: false }],
  ]) {
    assert.deepEqual(assessPilot(passing({ cleanup })), failed);
  }
});

await test("cleanup failure cannot retain the softer partial-controls status", () => {
  assert.deepEqual(
    assessPilot(
      passing({
        checks: [{ pass: false, gating: true }],
        cleanup: [{ name: "capture", token_in_local_log: true }],
      }),
    ),
    failed,
  );
});

await test("rejects abnormal, signalled and unconfirmed target shutdowns", () => {
  assert.equal(targetShutdownPassed({ code: 0, signal: null }), true);
  for (const targetExit of [
    { code: 7, signal: null },
    { code: null, signal: "SIGTERM" },
    { code: 0, signal: "SIGKILL" },
    { code: 0 },
    undefined,
  ]) {
    assert.equal(targetShutdownPassed(targetExit), false);
    assert.deepEqual(assessPilot(passing({ targetExit })), failed);
  }
});

await test("rejects unfinished controls and retained execution failures", () => {
  for (const overrides of [
    { controlsCompleted: false },
    { failure: { message: "capture failed" } },
    { checks: [{ pass: true, gating: true }, { pass: false }] },
  ]) {
    assert.deepEqual(assessPilot(passing(overrides)), failed);
  }
});

await test("does not infer acceptance when no gate was observed", () => {
  assert.deepEqual(assessPilot(passing({ checks: [{ pass: true }] })), failed);
});
