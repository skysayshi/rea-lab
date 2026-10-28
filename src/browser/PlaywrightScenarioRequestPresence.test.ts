import type { Page, Request, Route } from "playwright-core";
import { afterEach, expect, it, vi } from "vitest";

import { browserScenarioSchema } from "../domain/browserScenario.js";
import { BrowserScenarioSecrets } from "./BrowserScenarioSecrets.js";
import { performScenarioRequest } from "./PlaywrightScenarioRequest.js";
import { sendPresenceFromPage } from "./PlaywrightRequestBodyPresence.js";

vi.mock("./PlaywrightRequestBodyPresence.js", () => ({
  sendPresenceFromPage: vi.fn(),
}));
const origin = "http://127.0.0.1:34567";
const fields = {
  step_id: "empty",
  action: "request",
  method: "POST",
  path: "/presence",
  text: "",
  timeout_ms: 1000,
  body_presence: { mode: "synthetic-loopback", observe: true, measure: true },
};
const parse = (
  action: Record<string, unknown> = fields,
  url = origin,
  mode = "launch",
) =>
  browserScenarioSchema.safeParse({
    browser:
      mode === "launch"
        ? { mode, executable_path: "/opt/chromium" }
        : { mode, cdp_endpoint: "http://127.0.0.1:9222" },
    start_url: { url: `${url}/` },
    actions: [action],
    capture: { events: ["network"] },
  });

afterEach(() => vi.resetAllMocks());

it("preserves caller headers for ordinary requests without presence instrumentation", () => {
  const ordinary = {
    ...fields,
    text: undefined,
    body_presence: undefined,
    path: "/ordinary",
    headers: [
      {
        name: "X-Rea-Presence-Trace",
        value: { source: "literal", value: "caller-owned" },
      },
    ],
  };
  const parsed = parse(ordinary, "https://example.test");
  if (!parsed.success) throw parsed.error;
  expect(parsed.data.actions[0]).toMatchObject({ headers: ordinary.headers });
  expect(parse({ ...ordinary, ...fields }).success).toBe(false);
});

it("restricts text and producer options to a bounded launched synthetic fixture", () => {
  expect(parse().success).toBe(true);
  for (const action of [
    { ...fields, body_presence: undefined },
    { ...fields, json: "" },
    { ...fields, method: "GET" },
    { ...fields, timeout_ms: undefined },
    { ...fields, path: "/elsewhere" },
    { ...fields, path: "/presence?x=1" },
    {
      ...fields,
      body_presence: {
        mode: "synthetic-loopback",
        observe: false,
        measure: true,
      },
    },
    {
      ...fields,
      headers: [
        {
          name: "X-Rea-Presence-Token",
          value: { source: "literal", value: "caller" },
        },
      ],
    },
  ])
    expect(parse(action).success, JSON.stringify(action)).toBe(false);
  expect(parse(fields, "https://127.0.0.1").success).toBe(false);
  expect(parse(fields, "http://localhost").success).toBe(false);
  expect(parse(fields, origin, "connect").success).toBe(false);
  const valid = parse();
  if (!valid.success) throw valid.error;
  expect(
    browserScenarioSchema.safeParse({ ...valid.data, capture: { events: [] } })
      .success,
  ).toBe(false);
});

const setup = () => {
  const parsed = parse();
  if (!parsed.success) throw parsed.error;
  const secrets = BrowserScenarioSecrets.resolve(parsed.data, {});
  if (!secrets.ok) throw secrets.error;
  let gate: (route: Route) => Promise<void>;
  const page = {
    url: () => `${origin}/`,
    route: vi.fn(async (_match, handler) => {
      gate = handler;
    }),
    unroute: vi.fn(),
  } as unknown as Page;
  const callback = vi.fn();
  const fallback = vi.fn(async () => {});
  const abort = vi.fn(async () => {});
  const request = (headers: Record<string, string>, method = "POST") =>
    ({
      headers: () => headers,
      method: () => method,
      url: () => `${origin}/presence`,
      redirectedFrom: () => null,
      // Empty bodies are exposed as null by Playwright. Identity cannot use this value.
      postData: () => null,
      frame: () => ({ page: () => page }),
    }) as unknown as Request;
  const route = async (sent: Request) =>
    gate({ request: () => sent, fallback, abort } as unknown as Route);
  const invoke = (signal?: AbortSignal) =>
    performScenarioRequest({
      page,
      action: parsed.data.actions[0] as Extract<
        (typeof parsed.data.actions)[number],
        { action: "request" }
      >,
      secrets: secrets.value,
      startOrigin: origin,
      allowSyntheticPresence: true,
      onBodyPresence: callback,
      ...(signal === undefined ? {} : { signal }),
    });
  return { page, route, request, invoke, callback, fallback, abort };
};

it("binds only the owned correlated Playwright Request despite the same URL and null postData", async () => {
  const s = setup();
  let owned: Request;
  vi.mocked(sendPresenceFromPage).mockImplementation(async (_page, input) => {
    await s.route(s.request({}));
    owned = s.request(
      Object.fromEntries(input.headers.map(([k, v]) => [k.toLowerCase(), v])),
    );
    await s.route(owned);
    return {
      status: 200,
      presence: {
        observation: {
          status: "observed",
          body_is_null: false,
          measurement: {
            status: "complete",
            bytes: 0,
            sha256:
              "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          },
        },
        producer: {
          source: "runtime-owned-fetch-request",
          run_id: input.presence.run_id,
          request_id: input.presence.request_id,
          dispatch_sequence: 3,
          same_request_verified: true,
        },
      },
    };
  });
  await s.invoke();
  expect(s.callback).toHaveBeenCalledOnce();
  expect(s.callback.mock.calls[0]?.[0].request).toBe(owned!);
  expect(s.abort).not.toHaveBeenCalled();
  expect(s.page.unroute).toHaveBeenCalledOnce();
});

it("refuses duplicated correlation rather than assigning proof to either same-URL request", async () => {
  const s = setup();
  vi.mocked(sendPresenceFromPage).mockImplementation(async (_page, input) => {
    const headers = Object.fromEntries(
      input.headers.map(([k, v]) => [k.toLowerCase(), v]),
    );
    await s.route(s.request(headers));
    await s.route(s.request(headers));
    return { status: 200 };
  });
  await expect(s.invoke()).rejects.toThrow("could not bind");
  expect(s.abort).toHaveBeenCalledOnce();
  expect(s.callback).not.toHaveBeenCalled();
  expect(s.page.unroute).toHaveBeenCalledOnce();
});

it("keeps the live cancellation gate for a queued empty body and removes it after settlement", async () => {
  const s = setup();
  const controller = new AbortController();
  vi.mocked(sendPresenceFromPage).mockImplementation(async (_page, input) => {
    controller.abort("queued");
    expect(s.page.unroute).not.toHaveBeenCalled();
    await s.route(
      s.request(
        Object.fromEntries(input.headers.map(([k, v]) => [k.toLowerCase(), v])),
      ),
    );
    return { error: "aborted at dispatch" };
  });
  await expect(s.invoke(controller.signal)).rejects.toThrow(
    "aborted at dispatch",
  );
  expect(s.abort).toHaveBeenCalledOnce();
  expect(s.fallback).not.toHaveBeenCalled();
  expect(s.callback).not.toHaveBeenCalled();
  expect(s.page.unroute).toHaveBeenCalledOnce();
});

it("retains pre-dispatch facts on a failed fetch attempt without claiming receiver delivery", async () => {
  const s = setup();
  const controller = new AbortController();
  vi.mocked(sendPresenceFromPage).mockImplementation(async (_page, input) => {
    controller.abort("queued");
    await s.route(
      s.request(
        Object.fromEntries(input.headers.map(([k, v]) => [k.toLowerCase(), v])),
      ),
    );
    return {
      error: "aborted at dispatch",
      presence: {
        observation: {
          status: "observed",
          body_is_null: false,
          measurement: { status: "not-requested" },
        },
        producer: {
          source: "runtime-owned-fetch-request",
          run_id: input.presence.run_id,
          request_id: input.presence.request_id,
          dispatch_sequence: 3,
          same_request_verified: true,
        },
      },
    };
  });
  await expect(s.invoke(controller.signal)).rejects.toThrow(
    "aborted at dispatch",
  );
  expect(s.abort).toHaveBeenCalledOnce();
  expect(s.fallback).not.toHaveBeenCalled();
  expect(s.callback).toHaveBeenCalledOnce();
  expect(s.page.unroute).toHaveBeenCalledOnce();
});
