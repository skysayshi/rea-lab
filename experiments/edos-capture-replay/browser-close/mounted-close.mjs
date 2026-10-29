import { observeOwnedClose } from "./observe-close.mjs";

/** Retain the original close outcome before applying the mounted pilot's gate. */
export async function closeMountedBrowser({
  browser,
  runId,
  result,
  now = () => performance.now(),
}) {
  const events = [];
  result.api_close_events = events;
  result.api_close = null;
  const snapshot = await observeOwnedClose({
    runId,
    close: () => browser.close(),
    deadlineMs: 10000,
    observationMs: 45000,
    now,
    emit: (event) => events.push(event),
  });
  result.api_close = snapshot;
  result.api_close_disconnected = browser.isConnected() === false;

  if (snapshot.operation_status !== "fulfilled")
    throw new Error(
      `browser_closed cleanup did not fulfill: ${snapshot.operation_status}`,
    );
  if (!snapshot.within_deadline)
    throw new Error("browser_closed cleanup deadline");
  if (snapshot.observer_errors.length)
    throw new Error("browser_closed cleanup observation failed");
  if (!result.api_close_disconnected)
    throw new Error("browser_closed cleanup remains connected");
  return snapshot;
}
