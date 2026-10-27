/** A refused listener is insufficient evidence of a successful target shutdown. */
export const targetShutdownPassed = (exit) =>
  exit?.code === 0 && exit?.signal === null;

/** Assess only after final cleanup and credential-log inspection have settled. */
export function assessPilot({
  checks,
  cleanup,
  failure,
  controlsCompleted,
  targetExit,
}) {
  const gates = checks.filter((item) => item.gating === true);
  const fatalFailure =
    controlsCompleted !== true ||
    failure !== undefined ||
    !targetShutdownPassed(targetExit) ||
    gates.length === 0 ||
    checks.some((item) => item.pass !== true && item.gating !== true) ||
    cleanup.some(
      (item) =>
        item.forced === true ||
        item.error !== undefined ||
        item.token_in_local_log === true ||
        item.exit_confirmed === false ||
        item.removed === false,
    );
  const accepted = !fatalFailure && gates.every((item) => item.pass === true);
  return {
    status: fatalFailure
      ? "FAIL"
      : accepted
        ? "PASS"
        : "PARTIAL_CONTROLS_COMPLETE",
    full_acceptance: accepted ? "PASS" : "FAIL",
    exit_code: accepted ? 0 : 1,
  };
}
