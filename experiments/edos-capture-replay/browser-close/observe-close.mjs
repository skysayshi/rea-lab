const operationId = "browser-close-1";

function errorFields(error) {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "NonErrorRejection", message: String(error) };
}

function validate({ runId, close, deadlineMs, observationMs, now, emit }) {
  if (typeof runId !== "string" || runId.trim() === "")
    throw new TypeError("runId must be a nonempty string");
  if ([close, now, emit].some((value) => typeof value !== "function"))
    throw new TypeError("close, now and emit must be functions");
  for (const value of [deadlineMs, observationMs]) {
    if (!Number.isFinite(value) || value <= 0 || value > 2 ** 31 - 1)
      throw new RangeError("Timing bounds must fit positive Node timer delays");
  }
  if (observationMs < deadlineMs)
    throw new RangeError("observationMs must not precede deadlineMs");
}

/**
 * Observe one close operation without cancelling or invoking it again.
 * A returned result is a snapshot; a pending original operation remains observed
 * and can emit a later settlement with after_ceiling:true. Rejection/pending keep
 * the lease. Fulfilment releases only this operation lease: the caller still
 * needs independent process/profile ownership and cleanup evidence.
 */
export async function observeOwnedClose({
  runId,
  close,
  deadlineMs = 10000,
  observationMs = 45000,
  now = () => performance.now(),
  emit = () => {},
}) {
  validate({ runId, close, deadlineMs, observationMs, now, emit });
  const startedAt = now();
  if (!Number.isFinite(startedAt))
    throw new TypeError("now must return a finite monotonic timestamp");
  let status = "pending",
    settledAt = null,
    failure = null;
  let deadlineRecorded = false,
    ceilingRecorded = false;
  const observerErrors = [];
  const record = (event, at, extra = {}) => {
    try {
      emit({
        run_id: runId,
        operation_id: operationId,
        event,
        at_ms: at,
        elapsed_ms: at - startedAt,
        ...extra,
      });
    } catch (error) {
      observerErrors.push(errorFields(error));
    }
  };
  const deadline = (at, basis) => {
    if (deadlineRecorded) return;
    deadlineRecorded = true;
    record("deadline", at, { basis, deadline_ms: deadlineMs });
  };
  const snapshot = (at) => ({
    run_id: runId,
    operation_id: operationId,
    operation_status: status,
    within_deadline: settledAt !== null && settledAt - startedAt <= deadlineMs,
    ownership_retained: status !== "fulfilled",
    started_at_ms: startedAt,
    settled_at_ms: settledAt,
    settle_duration_ms: settledAt === null ? null : settledAt - startedAt,
    observed_duration_ms: at - startedAt,
    deadline_ms: deadlineMs,
    observation_ms: observationMs,
    error: failure,
    observer_errors: observerErrors.map((error) => ({ ...error })),
  });
  return await new Promise((resolve) => {
    const deadlineTimer = setTimeout(
      () => deadline(now(), "timer"),
      deadlineMs,
    );
    const ceilingTimer = setTimeout(() => {
      const at = now();
      ceilingRecorded = true;
      deadline(at, "observation-ceiling");
      record("ceiling", at, { observation_ms: observationMs });
      clearTimeout(deadlineTimer);
      resolve(snapshot(at));
    }, observationMs);
    const settle = (nextStatus, error = null) => {
      settledAt = now();
      status = nextStatus;
      failure = error;
      if (settledAt - startedAt > deadlineMs) deadline(settledAt, "elapsed");
      record(status, settledAt, { after_ceiling: ceilingRecorded, error });
      clearTimeout(deadlineTimer);
      clearTimeout(ceilingTimer);
      resolve(snapshot(settledAt));
    };
    record("invoked", startedAt);
    let originalPromise;
    try {
      originalPromise = close();
    } catch (error) {
      originalPromise = Promise.reject(error);
    }
    Promise.resolve(originalPromise).then(
      () => settle("fulfilled"),
      (error) => settle("rejected", errorFields(error)),
    );
  });
}
