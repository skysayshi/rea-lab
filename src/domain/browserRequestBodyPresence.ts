import { z } from "zod";

import { digestSchema } from "./digests.js";

/** Presence at a Fetch Request boundary is independent of retained network bytes. */
export const BROWSER_REQUEST_BODY_PRESENCE_SCOPE = "fetch-request-pre-dispatch";
export const EMPTY_REQUEST_BODY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const reasonSchema = z.string().min(1).max(1024);
const measurementSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("complete"),
    bytes: z.int().min(0).safe(),
    sha256: digestSchema,
  }),
  z.strictObject({
    status: z.enum(["incomplete", "not-requested", "not-applicable"]),
    reason: reasonSchema.optional(),
  }),
]);

/** A producer must read the intrinsic body getter on the Request it dispatches. */
export const browserRequestBodyPresenceObservationSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("observed"),
      body_is_null: z.boolean(),
      measurement: measurementSchema,
    }),
    z.strictObject({
      status: z.literal("disabled"),
      reason: reasonSchema,
    }),
  ],
);
export type BrowserRequestBodyPresenceObservation = z.infer<
  typeof browserRequestBodyPresenceObservationSchema
>;

/** Local ownership assertions are provenance, not authentication of a target. */
export const browserRequestBodyPresenceProducerSchema = z.strictObject({
  source: z.literal("runtime-owned-fetch-request"),
  run_id: z.string().min(1).max(256),
  request_id: z.string().min(1).max(256),
  dispatch_sequence: z.int().positive().safe(),
  same_request_verified: z.literal(true),
});
export type BrowserRequestBodyPresenceProducer = z.infer<
  typeof browserRequestBodyPresenceProducerSchema
>;

export const browserRequestBodyPresenceClassificationSchema =
  z.discriminatedUnion("state", [
    z.strictObject({
      state: z.literal("absent"),
      reason: z.literal("direct-null-at-declared-boundary"),
    }),
    z.strictObject({
      state: z.literal("present-empty"),
      byte_length: z.literal(0),
      reason: z.literal("direct-stream-and-complete-zero-at-same-boundary"),
    }),
    z.strictObject({
      state: z.literal("present"),
      byte_length: z.int().positive().safe().nullable(),
      reason: z.enum([
        "complete-nonempty-at-declared-boundary",
        "presence-known-extent-unproven",
      ]),
    }),
    z.strictObject({
      state: z.literal("unknown"),
      reason: z.enum(["observer-disabled", "conflicting-direct-observations"]),
    }),
  ]);
export type BrowserRequestBodyPresenceClassification = z.infer<
  typeof browserRequestBodyPresenceClassificationSchema
>;

/** A zero-byte receiver payload or an unexposed adapter value is never a proof. */
export const classifyBrowserRequestBodyPresence = (
  observation: BrowserRequestBodyPresenceObservation,
): BrowserRequestBodyPresenceClassification => {
  if (observation.status === "disabled")
    return { state: "unknown", reason: "observer-disabled" };
  const measurement = observation.measurement;
  if (
    measurement.status === "complete" &&
    ((measurement.bytes === 0) !==
      (measurement.sha256 === EMPTY_REQUEST_BODY_SHA256) ||
      (observation.body_is_null && measurement.bytes > 0))
  )
    return {
      state: "unknown",
      reason: "conflicting-direct-observations",
    };
  if (observation.body_is_null)
    return { state: "absent", reason: "direct-null-at-declared-boundary" };
  if (measurement.status === "complete" && measurement.bytes === 0)
    return {
      state: "present-empty",
      byte_length: 0,
      reason: "direct-stream-and-complete-zero-at-same-boundary",
    };
  return {
    state: "present",
    byte_length: measurement.status === "complete" ? measurement.bytes : null,
    reason:
      measurement.status === "complete"
        ? "complete-nonempty-at-declared-boundary"
        : "presence-known-extent-unproven",
  };
};

/** All semantic claims are rederived from the retained, same-boundary facts. */
const presenceShape = {
  scope: z.literal(BROWSER_REQUEST_BODY_PRESENCE_SCOPE),
  observation: browserRequestBodyPresenceObservationSchema,
  producer: browserRequestBodyPresenceProducerSchema,
};
export const browserRequestBodyPresenceSchema = z
  .discriminatedUnion("state", [
    browserRequestBodyPresenceClassificationSchema.options[0].extend(
      presenceShape,
    ),
    browserRequestBodyPresenceClassificationSchema.options[1].extend(
      presenceShape,
    ),
    browserRequestBodyPresenceClassificationSchema.options[2].extend(
      presenceShape,
    ),
    browserRequestBodyPresenceClassificationSchema.options[3].extend(
      presenceShape,
    ),
  ])
  .superRefine((presence, context) => {
    const expected = classifyBrowserRequestBodyPresence(presence.observation);
    if (
      presence.state !== expected.state ||
      presence.reason !== expected.reason ||
      ("byte_length" in presence ? presence.byte_length : undefined) !==
        ("byte_length" in expected ? expected.byte_length : undefined)
    )
      context.addIssue({
        code: "custom",
        path: ["state"],
        message:
          "Body presence must agree with its direct producer observation",
      });
  });
export type BrowserRequestBodyPresence = z.infer<
  typeof browserRequestBodyPresenceSchema
>;

export interface BrowserRequestBodyPresenceBindingError {
  readonly code: "body-presence-binding";
  readonly reason:
    | "sealed"
    | "network-not-enabled"
    | "foreign-request"
    | "request-not-retained"
    | "non-root-request"
    | "repeated-observation"
    | "reused-producer-identity"
    | "invalid-observation";
  readonly message: string;
}
