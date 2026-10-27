import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const [reaArg, chrome, outArg] = process.argv.slice(2);
const rea = resolve(reaArg),
  out = resolve(outArg);
const hash = (b) => createHash("sha256").update(b).digest("hex");
const fileHash = async (path) => {
  const h = createHash("sha256");
  for await (const b of createReadStream(path)) h.update(b);
  return h.digest("hex");
};
const source = join(rea, "src/browser/PlaywrightScenarioRequest.ts");
const script = fileURLToPath(import.meta.url);
const sourceHash = await fileHash(source),
  scriptHash = await fileHash(script);
assert.equal(
  sourceHash,
  "e2a9354907bb9aa76249bfbd37fff7bf26fe0c2c841d6a3d8303b7418a14b2cf",
);
await mkdir(out, { mode: 0o700 });
for (const name of ["home", "tmp", "profile"])
  await mkdir(join(out, name), { mode: 0o700 });
const { importVerifierSource } = await import(
  pathToFileURL(join(rea, "scripts/lib/verifier-source-loader.mjs"))
);
const { performScenarioRequest } = await importVerifierSource(
  pathToFileURL(source),
);
const { BrowserScenarioSecrets } = await importVerifierSource(
  pathToFileURL(join(rea, "src/browser/BrowserScenarioSecrets.ts")),
);
const { browserScenarioSchema } = await importVerifierSource(
  pathToFileURL(join(rea, "src/domain/browserScenario.ts")),
);
const require = createRequire(join(rea, "package.json"));
const { chromium } = require("playwright-core");
const events = [],
  results = [],
  hits = [],
  checks = [];
const record = (kind, data = {}) =>
  events.push({ at: new Date().toISOString(), kind, ...data });
const check = (condition, label) => {
  checks.push({ label, pass: Boolean(condition) });
  assert.ok(condition, label);
};
const payload = (id) =>
  JSON.stringify({
    id,
    text: "Independent lifetime payload ё 🚀",
    data: "x".repeat(256),
  });
const report = {
  schema: "rea-lifetime-native-v1",
  started_at: new Date().toISOString(),
  status: "RUNNING",
  node: process.version,
  playwright: require("playwright-core/package.json").version,
  source_sha256: sourceHash,
  executed_driver_sha256: scriptHash,
  results,
  hits,
  events,
  checks,
};
const pending = new Map(),
  bodyTasks = new Map();
let context,
  server,
  origin,
  deadlineExpired = false;
const deadline = setTimeout(() => {
  deadlineExpired = true;
  record("watchdog");
  void context?.close().catch(() => {});
  server?.closeAllConnections();
}, 180000);
const bounded = async (promise, ms, label) => {
  let t;
  try {
    return await Promise.race([
      promise,
      new Promise((_, no) => {
        t = setTimeout(() => no(Error(label)), ms);
      }),
    ]);
  } finally {
    clearTimeout(t);
  }
};
function watch(page, label) {
  page.on("console", (m) => {
    if (m.text().startsWith("lifetime:"))
      record("page", { page: label, ...JSON.parse(m.text().slice(9)) });
  });
  page.on("requestfailed", (request) => {
    const id = new URL(request.url()).searchParams.get("id");
    if (!id) return;
    record("pw.failed", {
      page: label,
      id,
      error: request.failure()?.errorText,
    });
    pending.get(id)?.({ kind: "failed", error: request.failure()?.errorText });
  });
  page.on("requestfinished", (request) => {
    const id = new URL(request.url()).searchParams.get("id");
    if (!id) return;
    record("pw.finished", { page: label, id });
    const task = (async () => {
      try {
        const bytes = await (await request.response()).body();
        const data = { id, sha256: hash(bytes), bytes: bytes.length };
        record("pw.body", data);
        return data;
      } catch (error) {
        record("pw.body-error", { id, error: error.message });
        return { id, error: error.message };
      }
    })();
    bodyTasks.set(id, task);
    pending.get(id)?.({ kind: "finished" });
  });
}
async function instrumentation(page) {
  await page.evaluate(() => {
    const streamIDs = new WeakMap(),
      readerIDs = new WeakMap();
    const retained = new Map();
    globalThis.__lifetime = { retain: false, retained };
    const trace = (kind, id, data = {}) =>
      console.debug(
        "lifetime:" +
          JSON.stringify({
            kind,
            id,
            page_ms: performance.timeOrigin + performance.now(),
            ...data,
          }),
      );
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = function (input, init) {
      const id = new URL(
        typeof input === "string" ? input : input.url,
        location.href,
      ).searchParams.get("id");
      const signal = init?.signal;
      if (id && signal)
        signal.addEventListener("abort", () => trace("signal.abort", id), {
          once: true,
        });
      if (id && globalThis.__lifetime.retain) retained.set(id, { signal });
      trace("fetch.begin", id);
      return nativeFetch.call(this, input, init).then(
        (response) => {
          if (id && response.body) streamIDs.set(response.body, id);
          if (retained.has(id)) retained.get(id).response = response;
          trace("fetch.resolved", id, { status: response.status });
          return response;
        },
        (error) => {
          trace("fetch.rejected", id, {
            name: error.name,
            message: error.message,
          });
          throw error;
        },
      );
    };
    const getReader = ReadableStream.prototype.getReader;
    ReadableStream.prototype.getReader = function (...args) {
      const reader = getReader.apply(this, args),
        id = streamIDs.get(this);
      if (id) {
        readerIDs.set(reader, id);
        if (retained.has(id)) retained.get(id).reader = reader;
        reader.closed.then(
          () => trace("reader.closed", id),
          (error) => trace("reader.closed-rejected", id, { name: error.name }),
        );
      }
      return reader;
    };
    const read = ReadableStreamDefaultReader.prototype.read;
    ReadableStreamDefaultReader.prototype.read = function (...args) {
      const id = readerIDs.get(this),
        promise = read.apply(this, args);
      if (id)
        promise.then(
          (result) =>
            trace("reader.read", id, {
              done: result.done,
              bytes: result.value?.byteLength ?? 0,
            }),
          (error) => trace("reader.read-rejected", id, { name: error.name }),
        );
      return promise;
    };
    for (const name of ["releaseLock", "cancel"]) {
      const original = ReadableStreamDefaultReader.prototype[name];
      ReadableStreamDefaultReader.prototype[name] = function (...args) {
        const id = readerIDs.get(this);
        if (id) trace("reader." + name, id);
        return original.apply(this, args);
      };
    }
    const abort = AbortController.prototype.abort;
    AbortController.prototype.abort = function (...args) {
      trace("controller.abort", null);
      return abort.apply(this, args);
    };
  });
}
async function makePage(label, instrumented) {
  const page = await context.newPage();
  watch(page, label);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  for (const name of [
    "requestWillBeSent",
    "responseReceived",
    "loadingFinished",
    "loadingFailed",
  ])
    cdp.on("Network." + name, (e) =>
      record("cdp." + name, {
        page: label,
        requestId: e.requestId,
        url: e.request?.url ?? e.response?.url,
        native_timestamp: e.timestamp,
        error: e.errorText,
        canceled: e.canceled,
        encodedDataLength: e.encodedDataLength,
      }),
    );
  await page.goto(origin);
  if (instrumented) await instrumentation(page);
  return page;
}
async function run(
  page,
  id,
  { gate = true, retain = false, instrumented = true, negative = false } = {},
) {
  check(!deadlineExpired, "whole experiment remains within deadline");
  if (instrumented)
    await page.evaluate((value) => {
      globalThis.__lifetime.retain = value;
    }, retain);
  const terminal = new Promise((ok) => pending.set(id, ok));
  const facade = {
    url: () => page.url(),
    context: () => page.context(),
    evaluate: (...a) => page.evaluate(...a),
    route: async (...a) => {
      record("route.begin", { id, gate });
      if (gate) await page.route(...a);
      record("route.end", { id, gate });
    },
    unroute: async (...a) => {
      record("unroute.begin", { id, gate });
      if (gate) await page.unroute(...a);
      record("unroute.end", { id, gate });
    },
  };
  const scenario = browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: chrome },
    start_url: { url: origin },
    actions: [
      {
        step_id: id,
        action: "request",
        method: "GET",
        path: "/data?id=" + id,
        timeout_ms: 10000,
        expected_status: [200],
      },
    ],
  });
  const secrets = BrowserScenarioSecrets.resolve(scenario, {});
  assert.ok(secrets.ok);
  record("action.begin", { id });
  let actionError;
  try {
    await performScenarioRequest({
      page: instrumented ? facade : page,
      action: scenario.actions[0],
      secrets: secrets.value,
      startOrigin: origin,
    });
  } catch (error) {
    actionError = error.message;
  }
  record("action.end", { id, error: actionError });
  const terminalResult = await bounded(
    terminal,
    5000,
    "native terminal deadline " + id,
  );
  const body = bodyTasks.has(id)
    ? await bounded(bodyTasks.get(id), 5000, "body deadline " + id)
    : null;
  let retention = null;
  if (instrumented) {
    retention = await page.evaluate((key) => {
      const item = globalThis.__lifetime.retained.get(key);
      return {
        count: globalThis.__lifetime.retained.size,
        response: item?.response instanceof Response,
        reader: item?.reader instanceof ReadableStreamDefaultReader,
        signal: item?.signal instanceof AbortSignal,
      };
    }, id);
    check(
      retain
        ? retention.response && retention.reader && retention.signal
        : retention.count === 0,
      id + ": retention treatment held until terminal and body settlement",
    );
    await page.evaluate((key) => {
      globalThis.__lifetime.retained.delete(key);
    }, id);
    record("retention.released", { id });
  }
  const expected = hash(payload(id));
  const result = {
    id,
    gate,
    retain,
    instrumented,
    negative,
    action_error: actionError ?? null,
    terminal: terminalResult,
    body,
    expected_sha256: expected,
    body_matches: body?.sha256 === expected,
    retention,
  };
  results.push(result);
  if (!negative) {
    check(!actionError, id + ": action completed");
    if (instrumented) {
      const reads = events.filter(
        (e) => e.id === id && e.kind === "reader.read",
      );
      check(
        reads.some((e) => e.done) &&
          reads.reduce((n, e) => n + e.bytes, 0) ===
            Buffer.byteLength(payload(id)),
        id + ": reader reached done with exact independent byte count",
      );
    }
    if (body)
      check(
        result.body_matches,
        id + ": retained body equals independent payload",
      );
    check(
      hits.filter((x) => x.id === id).length === 1,
      id + ": exactly one server request",
    );
  }
  return result;
}
try {
  report.browser_launcher_sha256 = await fileHash(chrome);
  const framework = resolve(
    chrome,
    "../../Frameworks/Google Chrome Framework.framework/Versions/Current/Google Chrome Framework",
  );
  try {
    report.browser_framework = {
      bytes: (await stat(framework)).size,
      sha256: await fileHash(framework),
    };
  } catch {
    report.browser_framework = { available: false };
  }
  server = http.createServer((req, res) => {
    const url = new URL(req.url, origin);
    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<!doctype html><title>lifetime diagnostic</title>");
      return;
    }
    if (url.pathname !== "/data") {
      res.writeHead(404);
      res.end();
      return;
    }
    const id = url.searchParams.get("id"),
      expected = payload(id),
      bytes = id === "negative-body" ? expected + "x" : expected;
    hits.push({ id, at: new Date().toISOString() });
    record("server.request", { id });
    res.on("finish", () =>
      record("server.finish", {
        id,
        bytes: Buffer.byteLength(bytes),
        sha256: hash(bytes),
      }),
    );
    res.on("close", () => record("server.close", { id }));
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.write(bytes);
    if (id !== "negative-signal") res.end();
  });
  await new Promise((ok, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", () => {
      origin = "http://127.0.0.1:" + server.address().port;
      ok();
    });
  });
  context = await chromium.launchPersistentContext(join(out, "profile"), {
    executablePath: chrome,
    headless: true,
    serviceWorkers: "block",
    timeout: 60000,
    env: {
      PATH: process.env.PATH,
      HOME: join(out, "home"),
      TMPDIR: join(out, "tmp"),
      LANG: "en_US.UTF-8",
    },
  });
  report.browser_version = context.browser().version();
  const anchor = await makePage("anchor", false),
    on = await makePage("gate-on", true),
    off = await makePage("gate-off", true);
  const versionSession = await context.newCDPSession(anchor);
  report.browser_protocol_version =
    await versionSession.send("Browser.getVersion");
  await versionSession.detach();
  for (let i = 0; i < 4; i++)
    await run(anchor, "anchor-before-" + i, { instrumented: false });
  for (const [gate, page] of [
    [true, on],
    [false, off],
  ])
    for (const block of ["A", "B", "A2"])
      for (let i = 0; i < 6; i++)
        await run(page, (gate ? "on" : "off") + "-" + block + "-" + i, {
          gate,
          retain: block === "B",
        });
  for (let i = 0; i < 4; i++)
    await run(anchor, "anchor-after-" + i, { instrumented: false });
  const abort = (route) => route.abort("aborted");
  await on.route("**/data?id=negative-route", abort);
  const routeNegative = await run(on, "negative-route", { negative: true });
  await on.unroute("**/data?id=negative-route", abort);
  check(
    routeNegative.action_error &&
      routeNegative.terminal.kind === "failed" &&
      !hits.some((h) => h.id === "negative-route"),
    "real route-abort negative rejected before server",
  );
  const signalTerminal = new Promise((ok) =>
    pending.set("negative-signal", ok),
  );
  const signalNegative = await off.evaluate(async (origin) => {
    globalThis.__lifetime.retain = false;
    const controller = new AbortController();
    const response = await fetch(origin + "/data?id=negative-signal", {
      credentials: "same-origin",
      redirect: "manual",
      signal: controller.signal,
    });
    const reader = response.body.getReader();
    const first = await reader.read();
    controller.abort();
    try {
      await reader.read();
      return { first_bytes: first.value?.byteLength, error: null };
    } catch (error) {
      return { first_bytes: first.value?.byteLength, error: error.name };
    } finally {
      reader.releaseLock();
    }
  }, origin);
  const signalEnd = await bounded(
    signalTerminal,
    5000,
    "signal negative terminal",
  );
  check(
    signalNegative.error === "AbortError" &&
      signalNegative.first_bytes > 0 &&
      signalEnd.kind === "failed",
    "explicit in-flight abort produces reader rejection and native failure",
  );
  check(
    events.some((e) => e.id === "negative-signal" && e.kind === "signal.abort"),
    "signal abort instrumentation calibrated",
  );
  check(
    events.some(
      (e) =>
        e.id === "negative-signal" &&
        e.kind === "reader.read-rejected" &&
        e.name === "AbortError",
    ),
    "reader rejection instrumentation calibrated",
  );
  const changed = await run(off, "negative-body", {
    gate: false,
    negative: true,
  });
  check(
    changed.terminal.kind === "finished" &&
      changed.body &&
      !changed.body_matches,
    "independent payload oracle rejects deliberately changed response",
  );
  report.negative_signal = { ...signalNegative, terminal: signalEnd };

  report.source_unchanged = (await fileHash(source)) === sourceHash;
  report.driver_unchanged = (await fileHash(script)) === scriptHash;
  check(
    report.source_unchanged && report.driver_unchanged,
    "source and executed driver remain byte-identical",
  );
  report.status = "OBSERVED";
} catch (error) {
  report.status = "FAIL";
  report.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  if (context)
    try {
      await bounded(context.close(), 10000, "browser cleanup deadline");
      report.browser_closed = true;
    } catch (error) {
      report.browser_closed = false;
      report.cleanup_error = error.message;
      report.status = "FAIL";
      process.exitCode = 1;
    }
  if (server) {
    try {
      server.closeAllConnections();
      await bounded(
        new Promise((ok) => server.close(ok)),
        5000,
        "server cleanup deadline",
      );
      report.server_closed = true;
    } catch (error) {
      report.server_closed = false;
      report.server_cleanup_error = error.message;
      report.status = "FAIL";
      process.exitCode = 1;
    }
  }
  report.matrix = [
    ...new Set(
      results.filter((r) => !r.negative).map((r) => r.id.replace(/-\d+$/, "")),
    ),
  ].map((group) => {
    const rows = results.filter((r) => r.id.replace(/-\d+$/, "") === group);
    return {
      group,
      actions: rows.length,
      failed: rows.filter((r) => r.terminal.kind === "failed").length,
      bodies: rows.filter((r) => r.body).length,
      action_errors: rows.filter((r) => r.action_error).length,
      reader_done: rows.filter((r) =>
        events.some((e) => e.id === r.id && e.kind === "reader.read" && e.done),
      ).length,
    };
  });
  report.completed_at = new Date().toISOString();
  await writeFile(
    join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      status: report.status,
      matrix: report.matrix,
      failure: report.failure?.message,
      checks: checks.length,
      output: out,
    }),
  );
}
