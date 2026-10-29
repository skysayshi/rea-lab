import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { observeOwnedClose } from "./observe-close.mjs";

const [executable, directory, runId, configurationText] = process.argv.slice(2);
assert.equal(process.argv.length, 6);
assert.equal(process.version, "v24.22.1");
assert.equal(
  JSON.parse(await readFile(join(directory, "owner.json"))).run_id,
  runId,
);
assert.equal(process.env.TMPDIR, join(directory, "tmp"));
const configuration = JSON.parse(configurationText);
let sequence = 0,
  browser,
  closeStarted = false,
  failure;
const publish = (event) =>
  process.stdout.write(
    JSON.stringify({
      run_id: runId,
      seq: ++sequence,
      at_ms: performance.now(),
      ...event,
    }) + "\n",
  );
const result = {
  schema: "browser-close-child-v1",
  run_id: runId,
  configuration,
  context_calls: [],
  context_setup_complete: false,
  api_close: null,
};
async function bounded(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Context API deadline")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function closeBrowser() {
  assert.equal(closeStarted, false, "Only one actual browser.close invocation");
  closeStarted = true;
  result.api_close = await observeOwnedClose({
    runId,
    close: () => browser.close(),
    emit: (event) =>
      publish({
        ...event,
        connected: browser.isConnected(),
        contexts: browser.contexts().length,
      }),
  });
  result.connected_after_observation = browser.isConnected();
}
try {
  publish({ event: "launch_started" });
  browser = await chromium.launch({
    executablePath: executable,
    headless: true,
    timeout: 15000,
  });
  browser.on("disconnected", () => publish({ event: "browser_disconnected" }));
  result.browser_version = browser.version();
  publish({ event: "launch_fulfilled", browser_version: browser.version() });
  const contexts = [];
  for (let index = 0; index < configuration.contexts; index++) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: "ru-RU",
      timezoneId: "UTC",
      serviceWorkers: "block",
    });
    context.on("close", () =>
      publish({ event: "context_closed_event", index }),
    );
    context.on("page", (page) =>
      page.on("request", (request) =>
        publish({ event: "unexpected_page_request", url: request.url() }),
      ),
    );
    contexts.push(context);
    publish({ event: "context_created", index });
    if (configuration.pages_per_context) {
      const page = await context.newPage();
      assert.equal(page.url(), "about:blank");
      publish({ event: "blank_page_created", index, url: page.url() });
    }
  }
  for (const [index, context] of contexts.entries()) {
    const call = { index, started_at_ms: performance.now(), status: "pending" };
    result.context_calls.push(call);
    publish({ event: "context_close_invoked", index });
    const original = context.close();
    const retained = original.then(
      () => {
        call.status = "fulfilled";
        call.settled_at_ms = performance.now();
        publish({ event: "context_close_fulfilled", index });
      },
      (error) => {
        call.status = "rejected";
        call.error = error.message;
        publish({
          event: "context_close_rejected",
          index,
          message: error.message,
        });
        throw error;
      },
    );
    await bounded(retained, 10000);
  }
  result.context_setup_complete = true;
  await closeBrowser();
} catch (error) {
  failure = error;
  result.failure = { name: error.name, message: error.message };
  publish({ event: "cell_error", ...result.failure });
  if (browser && !closeStarted) await closeBrowser();
} finally {
  await writeFile(
    join(directory, "child-result.json"),
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  publish({ event: "cell_result", result });
}
if (failure || result.api_close?.operation_status !== "fulfilled")
  process.exitCode = 1;
