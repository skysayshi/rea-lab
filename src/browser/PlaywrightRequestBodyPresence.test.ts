import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  browserRequestBodyPresenceObservationSchema,
  classifyBrowserRequestBodyPresence,
} from "../domain/browserRequestBodyPresence.js";
import {
  performPresenceRequestInPage,
  type PresencePageRequest,
} from "./PlaywrightRequestBodyPresence.js";

const ORIGIN = "http://127.0.0.1:43127";
const RUN = "synthetic-run";
const TOKEN = "synthetic-request";
const input = (
  fields: Partial<PresencePageRequest> = {},
): PresencePageRequest => ({
  url: `${ORIGIN}/presence`,
  origin: ORIGIN,
  method: "POST",
  headers: [
    ["X-Rea-Presence-Run", RUN],
    ["X-Rea-Presence-Token", TOKEN],
  ],
  body: "",
  deadline: Date.now() + 5000,
  presence: {
    run_id: RUN,
    request_id: TOKEN,
    observe: true,
    measure: true,
    max_body_bytes: 4096,
    read_timeout_ms: 250,
  },
  ...fields,
});

const modelTransport = () => {
  const requests: Request[] = [];
  const payloads: Buffer[] = [];
  vi.stubGlobal("location", { origin: ORIGIN });
  vi.stubGlobal("navigator", { serviceWorker: { controller: null } });
  vi.stubGlobal("fetch", async (request: Request) => {
    requests.push(request);
    payloads.push(Buffer.from(await request.arrayBuffer()));
    return new Response("complete synthetic response", { status: 200 });
  });
  return { requests, payloads };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("direct presence and Request identity (native Request, model transport)", () => {
  it.each([
    { name: "absent", method: "GET", body: undefined, state: "absent" },
    { name: "present-empty", method: "POST", body: "", state: "present-empty" },
    {
      name: "Unicode present",
      method: "POST",
      body: "Синтетическое тело ё 🚀",
      state: "present",
    },
  ])(
    "observes $name and preserves the original payload",
    async ({ method, body, state }) => {
      const transport = modelTransport();
      const result = await performPresenceRequestInPage(
        input({ method, body }),
      );
      expect(result).toMatchObject({ status: 200 });
      expect(transport.requests).toHaveLength(1);
      expect(transport.requests[0]?.redirect).toBe("error");
      expect(transport.payloads).toEqual([Buffer.from(body ?? "")]);
      const observation = browserRequestBodyPresenceObservationSchema.parse(
        result.presence?.observation,
      );
      expect(classifyBrowserRequestBodyPresence(observation).state).toBe(state);
      if (observation.status === "observed" && body !== undefined)
        expect(observation.measurement).toEqual({
          status: "complete",
          bytes: Buffer.byteLength(body),
          sha256: createHash("sha256").update(body).digest("hex"),
        });
      expect(result.presence?.producer).toMatchObject({
        source: "runtime-owned-fetch-request",
        run_id: RUN,
        request_id: TOKEN,
        same_request_verified: true,
      });
      expect(result.presence?.producer.dispatch_sequence).toBeGreaterThan(1);
    },
  );

  it("dispatches the exact constructed object and ignores own body/clone shadows", async () => {
    const transport = modelTransport();
    const NativeRequest = globalThis.Request;
    const constructed: Request[] = [];
    vi.stubGlobal(
      "Request",
      new Proxy(NativeRequest, {
        construct(_target, args) {
          const request = Reflect.construct(NativeRequest, args) as Request;
          Object.defineProperty(request, "body", { value: null });
          Object.defineProperty(request, "clone", {
            value: () => {
              throw new Error("own clone must not run");
            },
          });
          constructed.push(request);
          return request;
        },
      }),
    );
    const result = await performPresenceRequestInPage(input({ body: "owned" }));
    expect(result).toMatchObject({
      status: 200,
      presence: { observation: { body_is_null: false } },
    });
    expect(constructed).toHaveLength(1);
    expect(transport.requests[0]).toBe(constructed[0]);
    expect(transport.payloads).toEqual([Buffer.from("owned")]);
  });

  it("keeps disabled observation unknown despite sending known bytes", async () => {
    const transport = modelTransport();
    const request = input({ body: "known" });
    const result = await performPresenceRequestInPage({
      ...request,
      presence: { ...request.presence, observe: false },
    });
    expect(result.presence?.observation).toEqual({
      status: "disabled",
      reason: "producer-observation-disabled",
    });
    expect(
      classifyBrowserRequestBodyPresence(
        browserRequestBodyPresenceObservationSchema.parse(
          result.presence?.observation,
        ),
      ).state,
    ).toBe("unknown");
    expect(transport.payloads).toEqual([Buffer.from("known")]);
  });
});

describe("bounded presence measurement (native Request, model transport)", () => {
  it.each(["correlation-header", "original-body"] as const)(
    "refuses dispatch when %s changes during asynchronous measurement",
    async (mutation) => {
      const transport = modelTransport();
      const NativeRequest = globalThis.Request;
      const nativeDigest = globalThis.crypto.subtle.digest.bind(
        globalThis.crypto.subtle,
      );
      let constructed: Request | undefined;
      vi.stubGlobal(
        "Request",
        new Proxy(NativeRequest, {
          construct(_target, args) {
            constructed = Reflect.construct(NativeRequest, args) as Request;
            return constructed;
          },
        }),
      );
      vi.stubGlobal("crypto", {
        subtle: {
          digest: async (...args: Parameters<typeof nativeDigest>) => {
            if (constructed === undefined)
              throw new Error("Expected an owned Request");
            if (mutation === "correlation-header")
              constructed.headers.set("X-Rea-Presence-Token", "changed-token");
            else await constructed.text();
            return nativeDigest(...args);
          },
        },
      });
      const result = await performPresenceRequestInPage(
        input({ body: "owned" }),
      );
      expect(result).toHaveProperty("error");
      expect(result.presence).toBeUndefined();
      expect(transport.requests).toHaveLength(0);
    },
  );

  it.each(["not-requested", "size-limit", "read-timeout"] as const)(
    "retains known presence with unproven extent after %s",
    async (mode) => {
      const transport = modelTransport();
      const request = input({ body: "body exceeds four bytes" });
      if (mode === "read-timeout")
        vi.stubGlobal("crypto", {
          subtle: { digest: () => new Promise<ArrayBuffer>(() => {}) },
        });
      const result = await performPresenceRequestInPage({
        ...request,
        presence: {
          ...request.presence,
          measure: mode !== "not-requested",
          max_body_bytes: mode === "size-limit" ? 4 : 4096,
          read_timeout_ms: mode === "read-timeout" ? 10 : 250,
        },
      });
      expect(result).toMatchObject({ status: 200 });
      const observation = browserRequestBodyPresenceObservationSchema.parse(
        result.presence?.observation,
      );
      expect(classifyBrowserRequestBodyPresence(observation)).toMatchObject({
        state: "present",
        byte_length: null,
      });
      expect(observation).toMatchObject({
        measurement: {
          status: mode === "not-requested" ? "not-requested" : "incomplete",
        },
      });
      expect(transport.payloads).toEqual([Buffer.from(request.body ?? "")]);
    },
  );
});

describe("dispatch refusal and failure (native Request, model transport)", () => {
  it.each(["expired", "wrong-token", "outside-origin", "GET-body"] as const)(
    "sends nothing and creates no dispatch witness for %s",
    async (mode) => {
      const transport = modelTransport();
      const request = input();
      const overrides: Partial<PresencePageRequest> =
        mode === "expired"
          ? { deadline: Date.now() - 1 }
          : mode === "wrong-token"
            ? { presence: { ...request.presence, request_id: "other-request" } }
            : mode === "outside-origin"
              ? { url: "https://example.test/presence" }
              : { method: "GET", body: "forbidden" };
      const result = await performPresenceRequestInPage({
        ...request,
        ...overrides,
      });
      expect(result).toHaveProperty("error");
      expect(result.presence).toBeUndefined();
      expect(transport.requests).toHaveLength(0);
    },
  );

  it("rechecks the action deadline after clone measurement before dispatch", async () => {
    const transport = modelTransport();
    vi.stubGlobal("crypto", {
      subtle: { digest: () => new Promise<ArrayBuffer>(() => {}) },
    });
    const request = input({ body: "present", deadline: Date.now() + 5 });
    const result = await performPresenceRequestInPage({
      ...request,
      presence: { ...request.presence, read_timeout_ms: 20 },
    });
    expect(result).toHaveProperty("error");
    expect(result.presence).toBeUndefined();
    expect(transport.requests).toHaveLength(0);
  });

  it("retains direct presence when the verified fetch attempt fails", async () => {
    modelTransport();
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("synthetic fetch rejection");
    });
    const result = await performPresenceRequestInPage(input());
    expect(result).toMatchObject({
      error: "synthetic fetch rejection",
      presence: { producer: { same_request_verified: true } },
    });
    expect(
      classifyBrowserRequestBodyPresence(
        browserRequestBodyPresenceObservationSchema.parse(
          result.presence?.observation,
        ),
      ).state,
    ).toBe("present-empty");
  });
});
