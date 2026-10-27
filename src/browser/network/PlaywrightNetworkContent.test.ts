import { expect, it } from "vitest";
import { browserScenarioSchema } from "../../domain/browserScenario.js";
import { resolveScenarioSecrets } from "../../../tests/fixtures/browserScenarioSecrets.js";
import {
  captureNetworkBody,
  captureNetworkHeaders,
} from "./PlaywrightNetworkContent.js";

const scenario = browserScenarioSchema.parse({
  browser: { mode: "launch", executable_path: "/fixture/chrome" },
  start_url: { url: "https://example.test" },
  actions: [{ step_id: "done", action: "wait_for_timeout", duration_ms: 1 }],
  secrets: [{ secret_id: "declared", environment_variable: "SECRET" }],
});
const secrets = resolveScenarioSecrets(scenario, { SECRET: "x" });
const noSecrets = resolveScenarioSecrets({ ...scenario, secrets: [] }, {});
const options = {
  timeoutMs: 100,
  maxBodyBytes: 4,
  maxBodyAllocationBytes: 1024 * 1024,
  maxHeaderAllocationBytes: 16384,
  maxMetadataAllocationBytes: 4096,
};
const source = {
  headers: () => ({ "content-type": "text/plain" }),
  headersArray: async () => [],
};

it("distinguishes unexposed request bytes from an explicitly exposed empty buffer", async () => {
  expect(
    await captureNetworkBody(
      async () => null,
      "request",
      source,
      noSecrets,
      options,
    ),
  ).toEqual({ state: "not_exposed" });
  expect(
    await captureNetworkBody(
      async () => Buffer.alloc(0),
      "request",
      source,
      noSecrets,
      options,
    ),
  ).toEqual({
    state: "captured",
    representation: "browser-exposed-request-bytes",
    encoding: "base64",
    content: "",
    bytes: 0,
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    media_type: "text/plain",
    redacted: false,
  });
});

it("preserves a request-body read error separately from unexposed bytes", async () => {
  expect(
    await captureNetworkBody(
      async () => {
        throw new Error("Request body read failed");
      },
      "request",
      source,
      noSecrets,
      options,
    ),
  ).toEqual({
    state: "unavailable",
    reason: "body-read-failed",
    message: "Request body read failed",
  });
});

it("enforces the retained body byte limit after secret expansion", async () => {
  expect(
    await captureNetworkBody(
      async () => Buffer.from("xxxx"),
      "response",
      source,
      secrets,
      options,
    ),
  ).toMatchObject({
    state: "unavailable",
    reason: "body-size-limit",
    limit_bytes: 4,
  });
  expect(
    await captureNetworkBody(
      async () => Buffer.from("safe"),
      "response",
      source,
      secrets,
      options,
    ),
  ).toMatchObject({
    state: "captured",
    bytes: 4,
    content: Buffer.from("safe").toString("base64"),
  });
});

it("charges discarded credential header values only for their retained projection", async () => {
  const read = async (name: string) =>
    captureNetworkHeaders(
      {
        headers: () => ({}),
        headersArray: async () => [
          { name, value: "v".repeat(50_000) },
          { name: "X-Observed", value: "ordinary" },
        ],
      },
      secrets,
      options,
    );
  expect(await read("Cookie")).toMatchObject({
    state: "captured",
    items: [
      { name: "Cookie", value: null, redacted: true },
      { name: "X-Observed", value: "ordinary", redacted: false },
    ],
  });
  expect(await read("X-Retained")).toMatchObject({ state: "unavailable" });
});
