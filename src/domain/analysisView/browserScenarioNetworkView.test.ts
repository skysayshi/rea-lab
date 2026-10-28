import { expect, it } from "vitest";

import { scenarioCaptureFixture } from "../../../tests/fixtures/browserScenarioCapture.js";
import { browserScenarioCaptureSchema } from "../browserScenarioCapture.js";
import {
  browserScenarioTransactionGroups,
  summarizeBrowserScenarioNetwork,
} from "./browserScenarioNetworkView.js";

it("keeps presence provenance in its transaction without treating it as URL metadata", () => {
  const original = scenarioCaptureFixture([
    { method: "GET", url: "/presence", status: 200, body: "{}" },
  ]);
  const request = original.events.items.find(
    (event) => event.kind === "request",
  );
  if (request?.kind !== "request") throw new Error("Missing fixture request");
  const proof = {
    kind: "request-body-presence",
    sequence:
      Math.max(...original.events.items.map(({ sequence }) => sequence)) + 1,
    step_index: request.step_index,
    transaction_id: request.transaction_id,
    source_event_sequence: request.sequence,
    phase: "request",
    redirect_hop: 0,
    presence: {
      scope: "fetch-request-pre-dispatch",
      state: "absent",
      reason: "direct-null-at-declared-boundary",
      observation: {
        status: "observed",
        body_is_null: true,
        measurement: { status: "not-applicable", reason: "body-is-null" },
      },
      producer: {
        source: "runtime-owned-fetch-request",
        run_id: "authored-view-regression-run",
        request_id: "authored-view-regression-request",
        dispatch_sequence: 1,
        same_request_verified: true,
      },
    },
  };
  const capture = browserScenarioCaptureSchema.parse({
    ...original,
    events: {
      ...original.events,
      retained: original.events.retained + 1,
      items: [
        ...original.events.items.map((event) =>
          event === request
            ? { ...event, redirected_from_transaction_state: "root" }
            : event,
        ),
        proof,
      ],
    },
  });
  const before = JSON.stringify(capture);
  expect(summarizeBrowserScenarioNetwork(capture)).toEqual(
    summarizeBrowserScenarioNetwork(original),
  );
  const groups = browserScenarioTransactionGroups(capture);
  expect(groups).toHaveLength(1);
  expect(groups[0]?.source_item_indices).toContain(
    capture.events.items.length - 1,
  );
  expect(groups[0]?.ambiguous).toBe(false);
  expect(JSON.stringify(capture)).toBe(before);
});
