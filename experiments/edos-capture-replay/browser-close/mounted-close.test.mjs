import assert from "node:assert/strict";
import test from "node:test";
import { closeMountedBrowser } from "./mounted-close.mjs";

function controlled(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let at = 1000,
    calls = 0,
    connected = true,
    fulfil,
    reject;
  const original = new Promise((resolve, rejectPromise) => {
    fulfil = resolve;
    reject = rejectPromise;
  });
  const result = {};
  const completion = closeMountedBrowser({
    browser: {
      close() {
        calls++;
        return original;
      },
      isConnected: () => connected,
    },
    runId: t.name,
    result,
    now: () => at,
  });
  return {
    result,
    completion,
    calls: () => calls,
    fulfil: (disconnect = true) => {
      if (disconnect) connected = false;
      fulfil();
    },
    reject,
    advance: (milliseconds) => {
      at += milliseconds;
      t.mock.timers.tick(milliseconds);
    },
  };
}

await test("timely fulfilled and disconnected close records evidence and permits success", async (t) => {
  const probe = controlled(t);
  probe.advance(4);
  probe.fulfil();
  const snapshot = await probe.completion;
  assert.equal(probe.calls(), 1);
  assert.equal(probe.result.api_close, snapshot);
  assert.equal(snapshot.operation_status, "fulfilled");
  assert.equal(snapshot.within_deadline, true);
  assert.equal(snapshot.deadline_ms, 10000);
  assert.equal(snapshot.observation_ms, 45000);
  assert.equal(probe.result.api_close_disconnected, true);
  assert.deepEqual(
    probe.result.api_close_events.map((event) => event.event),
    ["invoked", "fulfilled"],
  );
});

await test("late fulfilment remains a failure with its actual settlement retained", async (t) => {
  const probe = controlled(t);
  let completed = false;
  void probe.completion.then(
    () => {
      completed = true;
    },
    () => {
      completed = true;
    },
  );
  probe.advance(10000);
  await Promise.resolve();
  assert.equal(
    completed,
    false,
    "The 10-second gate does not abandon observation",
  );
  assert.equal(probe.calls(), 1);
  probe.advance(1);
  probe.fulfil();
  await assert.rejects(probe.completion, /browser_closed cleanup deadline/u);
  assert.equal(probe.result.api_close.operation_status, "fulfilled");
  assert.equal(probe.result.api_close.settle_duration_ms, 10001);
  assert.equal(probe.result.api_close.within_deadline, false);
  assert.equal(probe.result.api_close_disconnected, true);
  assert.deepEqual(
    probe.result.api_close_events.map((event) => event.event),
    ["invoked", "deadline", "fulfilled"],
  );
  assert.equal(probe.calls(), 1);
});

await test("pending at ceiling retains its snapshot and observes the same later settlement", async (t) => {
  const probe = controlled(t);
  const rejected = assert.rejects(
    probe.completion,
    /browser_closed cleanup did not fulfill: pending/u,
  );
  probe.advance(45000);
  await rejected;
  assert.equal(probe.result.api_close.operation_status, "pending");
  assert.equal(probe.result.api_close.settled_at_ms, null);
  assert.equal(probe.result.api_close.ownership_retained, true);
  assert.equal(probe.result.api_close_disconnected, false);
  assert.deepEqual(
    probe.result.api_close_events.map((event) => event.event),
    ["invoked", "deadline", "ceiling"],
  );
  probe.advance(1);
  probe.fulfil();
  await Promise.resolve();
  assert.equal(probe.result.api_close_events.at(-1).event, "fulfilled");
  assert.equal(probe.result.api_close_events.at(-1).after_ceiling, true);
  assert.equal(probe.result.api_close.operation_status, "pending");
  assert.equal(probe.calls(), 1);
});

await test("early rejection retains details before the adapter rejects", async (t) => {
  const probe = controlled(t);
  probe.advance(3);
  probe.reject(new TypeError("synthetic close refusal"));
  await assert.rejects(
    probe.completion,
    /browser_closed cleanup did not fulfill: rejected/u,
  );
  assert.equal(probe.calls(), 1);
  assert.equal(probe.result.api_close.within_deadline, true);
  assert.equal(probe.result.api_close.ownership_retained, true);
  assert.deepEqual(probe.result.api_close.error, {
    name: "TypeError",
    message: "synthetic close refusal",
  });
  assert.deepEqual(
    probe.result.api_close_events.map((event) => event.event),
    ["invoked", "rejected"],
  );
});

await test("timely fulfilment alone cannot pass while the browser is connected", async (t) => {
  const probe = controlled(t);
  probe.advance(2);
  probe.fulfil(false);
  await assert.rejects(probe.completion, /cleanup remains connected/u);
  assert.equal(probe.result.api_close.within_deadline, true);
  assert.equal(probe.result.api_close_disconnected, false);
  assert.equal(probe.calls(), 1);
});

await test("a synchronous close throw still leaves the result and events available", async () => {
  const result = {};
  let calls = 0;
  await assert.rejects(
    closeMountedBrowser({
      browser: {
        close() {
          calls++;
          throw new Error("synthetic synchronous close failure");
        },
        isConnected: () => true,
      },
      runId: "synchronous-adapter-failure",
      result,
      now: () => 1000,
    }),
    /browser_closed cleanup did not fulfill: rejected/u,
  );
  assert.equal(calls, 1);
  assert.equal(result.api_close.operation_status, "rejected");
  assert.equal(
    result.api_close.error.message,
    "synthetic synchronous close failure",
  );
  assert.deepEqual(
    result.api_close_events.map((event) => event.event),
    ["invoked", "rejected"],
  );
});
