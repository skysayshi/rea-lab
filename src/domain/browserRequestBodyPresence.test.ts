import { expect, it } from "vitest";

import {
  BROWSER_REQUEST_BODY_PRESENCE_SCOPE,
  EMPTY_REQUEST_BODY_SHA256,
  browserRequestBodyPresenceObservationSchema,
  browserRequestBodyPresenceSchema,
  classifyBrowserRequestBodyPresence,
  type BrowserRequestBodyPresenceObservation,
} from "./browserRequestBodyPresence.js";
import { browserScenarioCaptureSchema } from "./browserScenarioCapture.js";
import { DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS } from "./browserScenarioCaptureLimits.js";
import { browserScenarioEventSchema } from "./browserScenarioCaptureValues.js";
import { sanitizeBrowserUrl } from "./browserObservation.js";
import { scenarioNetworkTransactions } from "./browserScenarioNetworkComparison.js";

const producer = {
  source: "runtime-owned-fetch-request",
  run_id: "fixture-run",
  request_id: "producer-request-1",
  dispatch_sequence: 3,
  same_request_verified: true,
} as const;
const absent = {
  status: "observed",
  body_is_null: true,
  measurement: { status: "not-applicable" },
} as const;
const empty = {
  status: "observed",
  body_is_null: false,
  measurement: {
    status: "complete",
    bytes: 0,
    sha256: EMPTY_REQUEST_BODY_SHA256,
  },
} as const;
const evidence = (observation: BrowserRequestBodyPresenceObservation) => ({
  scope: BROWSER_REQUEST_BODY_PRESENCE_SCOPE,
  ...classifyBrowserRequestBodyPresence(observation),
  observation,
  producer,
});

it("distinguishes a direct null body, a complete empty stream, and disabled observation", () => {
  expect(evidence(absent).state).toBe("absent");
  expect(evidence(empty)).toMatchObject({
    state: "present-empty",
    byte_length: 0,
  });
  expect(
    evidence({ status: "disabled", reason: "synthetic-disabled-control" }),
  ).toMatchObject({
    state: "unknown",
    reason: "observer-disabled",
  });
  for (const observation of [
    absent,
    empty,
    { status: "disabled", reason: "control" } as const,
  ])
    expect(
      browserRequestBodyPresenceSchema.safeParse(evidence(observation)).success,
    ).toBe(true);
});

it("preserves known presence when stream extent was not measured or measurement failed", () => {
  for (const status of ["not-requested", "incomplete"] as const)
    expect(
      evidence({
        status: "observed",
        body_is_null: false,
        measurement: { status },
      }),
    ).toMatchObject({
      state: "present",
      byte_length: null,
      reason: "presence-known-extent-unproven",
    });
  expect(
    evidence({
      ...empty,
      measurement: { status: "complete", bytes: 1, sha256: "a".repeat(64) },
    }),
  ).toMatchObject({
    state: "present",
    byte_length: 1,
  });
});

it("keeps contradictory direct facts unknown and rejects a forged semantic claim", () => {
  const nonemptyWithEmptyDigest = {
    ...empty,
    measurement: { ...empty.measurement, bytes: 1 },
  } as const;
  expect(evidence(nonemptyWithEmptyDigest)).toMatchObject({
    state: "unknown",
    reason: "conflicting-direct-observations",
  });
  expect(
    browserRequestBodyPresenceSchema.safeParse({
      ...evidence(nonemptyWithEmptyDigest),
      state: "present",
      byte_length: 1,
      reason: "complete-nonempty-at-declared-boundary",
    }).success,
  ).toBe(false);
  const contradictory = {
    ...empty,
    body_is_null: true,
    measurement: { status: "complete", bytes: 1, sha256: "a".repeat(64) },
  } as const;
  expect(evidence(contradictory)).toMatchObject({
    state: "unknown",
    reason: "conflicting-direct-observations",
  });
  expect(
    evidence({
      ...empty,
      measurement: { ...empty.measurement, sha256: "a".repeat(64) },
    }).state,
  ).toBe("unknown");
  expect(
    browserRequestBodyPresenceSchema.safeParse({
      ...evidence(empty),
      state: "absent",
      reason: "direct-null-at-declared-boundary",
    }).success,
  ).toBe(false);
  expect(
    browserRequestBodyPresenceObservationSchema.safeParse({
      status: "not_exposed",
    }).success,
  ).toBe(false);
  expect(
    browserRequestBodyPresenceSchema.safeParse({
      ...evidence(empty),
      scope: "receiver-payload",
    }).success,
  ).toBe(false);
});

const requestEvent = {
  sequence: 1,
  step_index: 0,
  kind: "request",
  transaction_id: "request-1",
  redirected_from_transaction_id: null,
  redirected_from_transaction_state: "root",
  method: "GET",
  url: sanitizeBrowserUrl("https://example.test/presence"),
  resource_type: "fetch",
  header_names: [],
  status: null,
  failure: null,
} as const;
const presenceEvent = {
  sequence: 2,
  step_index: 0,
  kind: "request-body-presence",
  transaction_id: "request-1",
  source_event_sequence: 1,
  phase: "request",
  redirect_hop: 0,
  presence: evidence(absent),
} as const;
const complete = {
  status: "complete",
  equality_eligible: true,
  missing_sections: [],
  truncated_sections: [],
} as const;
const capture = (items: readonly unknown[]) => ({
  browser: {
    mode: "launch",
    process_ownership: "provider-owned",
    cleanup: "terminated-owned-process",
    product: "fixture",
    version: "1",
  },
  scenario: {
    start_origin: "https://example.test",
    action_count: 1,
    secret_references: [],
    event_families: ["network"],
    network_content: {
      request_body: false,
      response_body: false,
      header_values: false,
    },
    limits: DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS,
  },
  duration_ms: 0,
  steps: [0, 1].map((step_index) => ({
    step_index,
    step_id: `step-${String(step_index)}`,
    action: step_index === 0 ? "initial" : "wait_for_timeout",
    status: "completed",
    error: null,
    before_url: requestEvent.url,
    after_url: requestEvent.url,
    elapsed_ms: 0,
    event_sequence_start: 1,
    event_sequence_end: items.length,
    artifacts: Object.fromEntries(
      ["screenshot", "dom", "accessibility", "url", "history", "storage"].map(
        (kind) => [kind, { state: "not_requested" }],
      ),
    ),
    completeness: complete,
  })),
  events: {
    items,
    retained: items.length,
    dropped: 0,
    omissions: {
      by_kind: [],
      network_transactions: [],
      network_transaction_range: null,
    },
  },
  completeness: complete,
  limitations: [],
});

it("requires one earlier retained root request for each presence observation", () => {
  expect(browserScenarioEventSchema.safeParse(presenceEvent).success).toBe(
    true,
  );
  expect(
    browserScenarioCaptureSchema.safeParse(
      capture([requestEvent, presenceEvent]),
    ).success,
  ).toBe(true);
  for (const bad of [
    { ...presenceEvent, source_event_sequence: 99 },
    { ...presenceEvent, transaction_id: "request-other" },
    { ...presenceEvent, sequence: 0 },
    { ...presenceEvent, phase: "response" },
    { ...presenceEvent, redirect_hop: 1 },
  ])
    expect(
      browserScenarioCaptureSchema.safeParse(capture([requestEvent, bad]))
        .success,
    ).toBe(false);
  expect(
    browserScenarioCaptureSchema.safeParse(
      capture([
        { ...requestEvent, redirected_from_transaction_state: "unknown" },
        presenceEvent,
      ]),
    ).success,
  ).toBe(false);
  expect(
    browserScenarioCaptureSchema.safeParse(
      capture([
        { ...requestEvent, sequence: 3 },
        { ...presenceEvent, source_event_sequence: 3 },
      ]),
    ).success,
  ).toBe(false);
  expect(
    browserScenarioCaptureSchema.safeParse(
      capture([requestEvent, { ...requestEvent, sequence: 3 }, presenceEvent]),
    ).success,
  ).toBe(false);
  expect(
    browserScenarioCaptureSchema.safeParse(
      capture([requestEvent, presenceEvent, { ...presenceEvent, sequence: 3 }]),
    ).success,
  ).toBe(false);
});

it("refuses to bind the same producer Request or dispatch to two transactions", () => {
  expect(
    browserScenarioCaptureSchema.safeParse(
      capture([
        requestEvent,
        presenceEvent,
        { ...requestEvent, sequence: 3, transaction_id: "request-2" },
        {
          ...presenceEvent,
          sequence: 4,
          transaction_id: "request-2",
          source_event_sequence: 3,
          presence: {
            ...presenceEvent.presence,
            producer: {
              ...producer,
              request_id: "producer-request-2",
              dispatch_sequence: 4,
            },
          },
        },
      ]),
    ).success,
  ).toBe(true);
  for (const otherProducer of [
    producer,
    { ...producer, request_id: "producer-request-2" },
    { ...producer, dispatch_sequence: 4 },
  ]) {
    const events = [
      requestEvent,
      presenceEvent,
      { ...requestEvent, sequence: 3, transaction_id: "request-2" },
      {
        ...presenceEvent,
        sequence: 4,
        transaction_id: "request-2",
        source_event_sequence: 3,
        presence: { ...presenceEvent.presence, producer: otherProducer },
      },
    ];
    expect(
      browserScenarioCaptureSchema.safeParse(capture(events)).success,
    ).toBe(false);
  }
});

it("keeps scoped producer evidence advisory to existing network equality", () => {
  const before = browserScenarioCaptureSchema.parse(capture([requestEvent]));
  const after = browserScenarioCaptureSchema.parse(
    capture([requestEvent, presenceEvent]),
  );
  expect(scenarioNetworkTransactions(after)).toEqual(
    scenarioNetworkTransactions(before),
  );
  const incomplete = browserScenarioCaptureSchema.parse({
    ...after,
    completeness: {
      status: "incomplete",
      equality_eligible: false,
      missing_sections: ["events"],
      truncated_sections: [],
    },
  });
  expect(incomplete.completeness.equality_eligible).toBe(false);
});
