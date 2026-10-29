// Pure record consistency checks. Original-promise and OS identity provenance
// comes from the reviewed observer/controller, not from JSON authentication.
import assert from "node:assert/strict";

const statuses = ["PASS", "FAIL", "UNKNOWN"];
const operationId = "browser-close-1";
const configurations = {
  "no-context": { contexts: 0, pages_per_context: 0 },
  "one-empty": { contexts: 1, pages_per_context: 0 },
  "two-empty": { contexts: 2, pages_per_context: 0 },
  "two-blank": { contexts: 2, pages_per_context: 1 },
};
const operationEvents = [
  "invoked",
  "deadline",
  "fulfilled",
  "rejected",
  "ceiling",
];

function finiteTime(value, label) {
  assert.ok(Number.isFinite(value) && value >= 0, label);
  return value;
}

function errorShape(value) {
  assert.equal(typeof value?.name, "string", "Error name is retained");
  assert.equal(typeof value?.message, "string", "Error message is retained");
}

function ownerRun(value, runId) {
  if (value === undefined || value === null) return false;
  assert.equal(value, runId, "OWNER_RUN_ID_MISMATCH");
  return true;
}

function timingEvidence(api, runId) {
  if (api === undefined || api === null) return { status: "UNKNOWN" };
  assert.equal(api.run_id, runId, "CLOSE_RUN_ID_MISMATCH");
  assert.equal(api.operation_id, operationId);
  assert.ok(
    ["fulfilled", "rejected", "pending"].includes(api.operation_status),
  );
  assert.equal(api.deadline_ms, 10000, "Original deadline remains unchanged");
  assert.equal(
    api.observation_ms,
    45000,
    "Diagnostic ceiling remains separate",
  );
  finiteTime(api.started_at_ms, "Close invocation time");
  finiteTime(api.observed_duration_ms, "Observed duration");
  assert.ok(Array.isArray(api.observer_errors));
  api.observer_errors.forEach(errorShape);
  if (api.operation_status === "pending")
    return { status: "FAIL", duration: null };
  finiteTime(api.settled_at_ms, "Close settlement time");
  const duration = api.settled_at_ms - api.started_at_ms;
  assert.ok(duration >= 0, "Settlement follows invocation");
  if (api.operation_status === "rejected" || duration > 10000)
    return { status: "FAIL", duration };
  return {
    status: api.observer_errors.length === 0 ? "PASS" : "UNKNOWN",
    duration,
  };
}

function hasCompleteIdentity(child, browser) {
  for (const value of [child.pid, browser.pid]) {
    if (value !== undefined && value !== null)
      assert.ok(Number.isSafeInteger(value) && value > 0, "Owned process PID");
  }
  const profile = browser.profile_relative;
  if (typeof profile === "string") {
    assert.ok(
      profile.length > 0 &&
        !profile.startsWith("/") &&
        !profile.split(/[\\/]/u).some((part) => part === ".." || part === "."),
      "Profile is a relative path inside the owned run",
    );
  }
  return Boolean(
    child.pid &&
    browser.pid &&
    typeof profile === "string" &&
    child.identity_validated === true &&
    browser.identity_validated === true &&
    browser.launch_log_observed === true &&
    typeof child.exited === "boolean",
  );
}

function hasCompleteFinalSampler(final) {
  return (
    final.sampler_error === null &&
    Number.isSafeInteger(final.owned_processes) &&
    Array.isArray(final.profile_dirs_present) &&
    Array.isArray(final.artifact_dirs_present)
  );
}

function assertFinalSamplerValues(final) {
  assert.ok(final.owned_processes >= 0);
  for (const name of [
    ...final.profile_dirs_present,
    ...final.artifact_dirs_present,
  ])
    assert.equal(typeof name, "string", "Observed directory name");
}

function releaseEvidence(ownership, runId) {
  if (ownership === undefined || ownership === null) return "UNKNOWN";
  const child = ownership.child_process;
  const browser = ownership.browser_process;
  const final = ownership.final;
  // Examine all supplied identities before considering missing observations.
  const ids = [
    ownership.run_id,
    child?.run_id,
    browser?.run_id,
    final?.run_id,
  ].map((value) => ownerRun(value, runId));
  if (!ids.every(Boolean) || !child || !browser || !final) return "UNKNOWN";
  if (!hasCompleteIdentity(child, browser) || !hasCompleteFinalSampler(final))
    return "UNKNOWN";
  assertFinalSamplerValues(final);
  return child.exited &&
    final.owned_processes === 0 &&
    final.profile_dirs_present.length === 0 &&
    final.artifact_dirs_present.length === 0
    ? "PASS"
    : "FAIL";
}

function assertApiConsistency(api, timing) {
  if (!api) return;
  const pending = api.operation_status === "pending";
  assert.equal(api.settle_duration_ms, timing.duration);
  assert.equal(api.within_deadline, !pending && timing.duration <= 10000);
  assert.equal(api.ownership_retained, api.operation_status !== "fulfilled");
  if (pending) {
    assert.equal(api.settled_at_ms, null);
    assert.ok(api.observed_duration_ms >= 45000);
  } else {
    assert.equal(api.observed_duration_ms, timing.duration);
  }
  if (api.operation_status === "rejected") errorShape(api.error);
  else assert.equal(api.error, null);
}

function relevantEvents(record) {
  assert.ok(Array.isArray(record.events));
  let previousSequence = -1;
  for (const event of record.events) {
    assert.ok(Number.isSafeInteger(event.seq) && event.seq > previousSequence);
    previousSequence = event.seq;
    if (event.received_at_ms !== undefined)
      finiteTime(event.received_at_ms, "Parent receipt time");
    if (operationEvents.includes(event.event)) {
      assert.equal(
        event.operation_id,
        operationId,
        "CLOSE_EVENT_OPERATION_MISMATCH",
      );
      assert.equal(event.run_id, record.run_id, "CLOSE_EVENT_RUN_ID_MISMATCH");
    }
  }
  return record.events.filter(
    (event) =>
      event.operation_id === operationId &&
      operationEvents.includes(event.event),
  );
}

function assertSettlementEvents(events, api) {
  const settlements = events.filter((event) =>
    ["fulfilled", "rejected"].includes(event.event),
  );
  const ceilings = events.filter((event) => event.event === "ceiling");
  assert.ok(
    settlements.length <= 1,
    "One original operation settles at most once",
  );
  if (api.operation_status === "pending") {
    assert.equal(ceilings.length, 1);
    assert.equal(ceilings[0].elapsed_ms, api.observed_duration_ms);
    if (settlements.length) {
      assert.equal(settlements[0].after_ceiling, true);
      assert.ok(settlements[0].at_ms >= ceilings[0].at_ms);
    }
  } else {
    assert.equal(ceilings.length, 0);
    assert.equal(settlements.length, 1);
    assert.equal(settlements[0].event, api.operation_status);
    assert.equal(settlements[0].at_ms, api.settled_at_ms);
    assert.equal(settlements[0].elapsed_ms, api.settle_duration_ms);
    assert.equal(settlements[0].after_ceiling, false);
    assert.deepEqual(settlements[0].error, api.error);
  }
  return settlements.length;
}

function assertOperationEvents(record, api) {
  const events = relevantEvents(record);
  const count = (name) => events.filter((event) => event.event === name).length;
  const counts = {
    child_events: record.events.length,
    api_invocations: count("invoked"),
    api_settlements: count("fulfilled") + count("rejected"),
    deadline_events: count("deadline"),
    ceiling_events: count("ceiling"),
  };
  if (!api) return counts;
  let previousTime = api.started_at_ms;
  for (const event of events) {
    assert.equal(event.run_id, record.run_id, "CLOSE_EVENT_RUN_ID_MISMATCH");
    finiteTime(event.at_ms, "Operation event time");
    assert.ok(event.at_ms >= previousTime, "Monotonic operation events");
    assert.equal(event.elapsed_ms, event.at_ms - api.started_at_ms);
    previousTime = event.at_ms;
  }
  // Emission errors explicitly preserve incomplete evidence rather than invent it.
  if (api.observer_errors.length) return counts;
  assert.equal(counts.api_invocations, 1, "One recorded close invocation");
  assert.equal(events[0].event, "invoked");
  assert.equal(events[0].at_ms, api.started_at_ms);
  assert.equal(events[0].elapsed_ms, 0);
  assert.ok(counts.deadline_events <= 1);
  for (const event of events.filter((value) => value.event === "deadline")) {
    assert.equal(event.deadline_ms, 10000);
    assert.ok(event.elapsed_ms >= 10000);
  }
  for (const event of events.filter((value) => value.event === "ceiling")) {
    assert.equal(event.observation_ms, 45000);
    assert.ok(event.elapsed_ms >= 45000);
  }
  if (api.operation_status === "pending" || api.settle_duration_ms > 10000)
    assert.equal(counts.deadline_events, 1);
  assertSettlementEvents(events, api);
  return counts;
}

export function assertCaseEvidence(record) {
  assert.equal(record.schema, "browser-close-timing-case-v1");
  assert.ok(typeof record.run_id === "string" && record.run_id.trim() !== "");
  assert.ok(Object.hasOwn(configurations, record.case_id));
  assert.deepEqual(record.configuration, configurations[record.case_id]);
  assert.ok(statuses.includes(record.claims?.timely_close));
  assert.ok(statuses.includes(record.claims?.release));
  const timing = timingEvidence(record.api_close, record.run_id);
  // Check the claimed outcome before comparing duplicated event/summary fields.
  // A late-settlement calibration must fail its timing claim, not its old events.
  assert.equal(
    record.claims.timely_close,
    timing.status,
    "CLOSE_DEADLINE_CLAIM_MISMATCH",
  );
  const release = releaseEvidence(record.ownership, record.run_id);
  assert.equal(record.claims.release, release, "OWNED_RELEASE_CLAIM_MISMATCH");
  assertApiConsistency(record.api_close, timing);
  const counts = assertOperationEvents(record, record.api_close);
  return {
    case_id: record.case_id,
    timely_close: timing.status,
    release,
    operation_status: record.api_close?.operation_status ?? "unobserved",
    counts,
  };
}

export function assertTimelyOwnedRelease(record) {
  const derived = assertCaseEvidence(record);
  assert.equal(derived.timely_close, "PASS", "TIMELY_CLOSE_REQUIRED");
  assert.equal(derived.release, "PASS", "VERIFIED_OWNED_RELEASE_REQUIRED");
  return derived;
}
