import assert from "node:assert/strict";
import test from "node:test";
import { observeOwnedClose } from "./observe-close.mjs";

function controlled(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let at = 1000,
    calls = 0,
    fulfil,
    reject;
  const original = new Promise((resolve, rejectPromise) => {
    fulfil = resolve;
    reject = rejectPromise;
  });
  const events = [];
  const observed = observeOwnedClose({
    runId: t.name,
    close: () => {
      calls++;
      return original;
    },
    deadlineMs: 10,
    observationMs: 45,
    now: () => at,
    emit: (event) => events.push(event),
  });
  return {
    observed,
    events,
    fulfil,
    reject,
    calls: () => calls,
    advance: (ms) => {
      at += ms;
      t.mock.timers.tick(ms);
    },
    clockOnly: (ms) => {
      at += ms;
    },
  };
}

await test("invokes close once and records early fulfilment with no deadline", async (t) => {
  const probe = controlled(t);
  assert.equal(probe.calls(), 1);
  probe.advance(4);
  probe.fulfil();
  const result = await probe.observed;
  assert.equal(result.operation_status, "fulfilled");
  assert.equal(result.within_deadline, true);
  assert.equal(result.ownership_retained, false);
  assert.equal(result.started_at_ms, 1000);
  assert.equal(result.settled_at_ms, 1004);
  assert.equal(result.settle_duration_ms, 4);
  assert.equal(result.error, null);
  assert.deepEqual(result.observer_errors, []);
  assert.deepEqual(
    probe.events.map((event) => event.event),
    ["invoked", "fulfilled"],
  );
  probe.advance(100);
  assert.equal(probe.events.length, 2);
  assert.equal(probe.calls(), 1);
});

await test("deadline does not release or reinvoke the original late close", async (t) => {
  const probe = controlled(t);
  let returned = false;
  void probe.observed.then(() => {
    returned = true;
  });
  probe.advance(10);
  await Promise.resolve();
  assert.equal(returned, false);
  assert.deepEqual(
    probe.events.map((event) => event.event),
    ["invoked", "deadline"],
  );
  probe.advance(5);
  probe.fulfil();
  const result = await probe.observed;
  assert.equal(result.operation_status, "fulfilled");
  assert.equal(result.within_deadline, false);
  assert.equal(result.ownership_retained, false);
  assert.equal(result.settle_duration_ms, 15);
  assert.equal(probe.calls(), 1);
  assert.deepEqual(
    probe.events.map((event) => event.event),
    ["invoked", "deadline", "fulfilled"],
  );
});

await test("elapsed time rejects a late close even when the timer callback did not run", async (t) => {
  const probe = controlled(t);
  probe.clockOnly(15);
  probe.fulfil();
  const result = await probe.observed;
  assert.equal(result.operation_status, "fulfilled");
  assert.equal(result.within_deadline, false);
  assert.equal(result.settle_duration_ms, 15);
  assert.equal(probe.events[1].event, "deadline");
  assert.equal(probe.events[1].basis, "elapsed");
  assert.equal(probe.calls(), 1);
});

await test("early rejection remains owned despite settling within the deadline", async (t) => {
  const probe = controlled(t);
  probe.advance(3);
  probe.reject(new TypeError("synthetic close refusal"));
  const result = await probe.observed;
  assert.equal(result.operation_status, "rejected");
  assert.equal(result.within_deadline, true);
  assert.equal(result.ownership_retained, true);
  assert.equal(result.settle_duration_ms, 3);
  assert.deepEqual(result.error, {
    name: "TypeError",
    message: "synthetic close refusal",
  });
  assert.deepEqual(
    probe.events.map((event) => event.event),
    ["invoked", "rejected"],
  );
  assert.equal(probe.calls(), 1);
});

await test("ceiling returns pending with ownership retained and still observes the original", async (t) => {
  const probe = controlled(t);
  probe.advance(45);
  const result = await probe.observed;
  assert.equal(result.operation_status, "pending");
  assert.equal(result.within_deadline, false);
  assert.equal(result.ownership_retained, true);
  assert.equal(result.settled_at_ms, null);
  assert.equal(result.settle_duration_ms, null);
  assert.equal(result.observed_duration_ms, 45);
  assert.deepEqual(
    probe.events.map((event) => event.event),
    ["invoked", "deadline", "ceiling"],
  );
  probe.advance(5);
  probe.fulfil();
  await Promise.resolve();
  assert.equal(probe.events.at(-1).event, "fulfilled");
  assert.equal(probe.events.at(-1).after_ceiling, true);
  assert.equal(probe.events.at(-1).elapsed_ms, 50);
  assert.equal(result.operation_status, "pending");
  assert.equal(result.ownership_retained, true);
  assert.equal(probe.calls(), 1);
});

await test("synchronous close rejection is observed once without losing the lease", async () => {
  let calls = 0;
  const result = await observeOwnedClose({
    runId: "synchronous-refusal",
    close: () => {
      calls++;
      throw new Error("synthetic sync refusal");
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.operation_status, "rejected");
  assert.equal(result.ownership_retained, true);
  assert.deepEqual(result.error, {
    name: "Error",
    message: "synthetic sync refusal",
  });
});

await test("observer callback failure is retained while the close operation completes", async () => {
  let calls = 0;
  const result = await observeOwnedClose({
    runId: "observer-refusal",
    close: () => {
      calls++;
      return Promise.resolve();
    },
    emit: () => {
      throw new Error("synthetic log refusal");
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.operation_status, "fulfilled");
  assert.deepEqual(result.observer_errors, [
    { name: "Error", message: "synthetic log refusal" },
    { name: "Error", message: "synthetic log refusal" },
  ]);
});
