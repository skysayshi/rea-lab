import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { assertMountedOutcome } from "./oracle.mjs";
import { startMountedServer } from "./server.mjs";

const [product, executable, output] = process.argv.slice(2);
assert.equal(
  process.argv.length,
  5,
  "Usage: node pilot.mjs ABS_PRODUCT ABS_CHROME NEW_OUTPUT",
);
assert.ok([product, executable, output].every(isAbsolute));
assert.equal(process.version, "v24.22.1");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const save = (name, value) =>
  writeFile(join(output, name), JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
const fixtureBytes = await readFile(new URL("./fixture.json", import.meta.url));
const fixture = JSON.parse(fixtureBytes);
const handlerPath = join(product, "scripts/scene-workspace.mjs");
const handlerBytes = await readFile(handlerPath);
assert.equal(
  sha(handlerBytes),
  "705e2b4873772e9649bc3b52b445658e10592c1f62b8f79a4f6e191cc841676c",
);
await mkdir(output, { mode: 0o700 });
const began = Date.now();
const scratch = await mkdtemp(join(tmpdir(), "edos-mounted-pilot-"));
const result = {
  schema: "edos-mounted-editor-pilot-v1",
  status: "FAIL",
  started_at: new Date().toISOString(),
  node: process.version,
  fixture_sha256: sha(fixtureBytes),
  historical_full_capture_acceptance: "FAIL",
  new_REA_capture_runs: 0,
  cleanup: {
    contexts_closed: false,
    browser_closed: false,
    server_closed: false,
    scratch_removed: false,
  },
};
const observed = {
  schema: "edos-mounted-editor-observation-v1",
  posts: [],
  browser_posts: [],
  snapshots: {},
  revisions: {},
  sources: {},
  browser_page_errors: [],
  unexpected_page_requests: [],
  server_errors: [],
};
const contexts = [];
let browser, server, build, origin, workspace, failure;

async function bounded(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function buildApp() {
  let stdout = "",
    stderr = "";
  try {
    ({ stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(new URL("./build.mjs", import.meta.url)),
        product,
        join(scratch, "build"),
      ],
      { timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
    ));
    return JSON.parse(
      await readFile(join(scratch, "build/bindings.local.json"), "utf8"),
    );
  } catch (error) {
    stdout = error.stdout ?? stdout;
    stderr = error.stderr ?? stderr;
    throw error;
  } finally {
    await writeFile(join(output, "build-child.stdout"), stdout, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(join(output, "build-child.stderr"), stderr, {
      flag: "wx",
      mode: 0o600,
    });
  }
}

async function revisions() {
  const directory = join(scratch, "data", "scene-candidates", fixture.scene_id);
  const files = {};
  for (const name of (await readdir(directory)).sort()) {
    assert.match(
      name,
      /^\d{8}\.json$/u,
      "No unexpected or pending revision files",
    );
    const bytes = await readFile(join(directory, name));
    files[name] = {
      body_text: bytes.toString("utf8"),
      sha256: sha(bytes),
      bytes: bytes.length,
    };
  }
  return files;
}
async function sourceHashes() {
  return {
    scene_sha256: sha(await readFile(join(scratch, "sources/scene.txt"))),
    reference_sha256: sha(
      await readFile(join(scratch, "sources/reference.txt")),
    ),
  };
}
async function snapshot(page) {
  const title = page.getByRole("textbox", {
    name: "Название варианта",
    exact: true,
  });
  const text = page.getByRole("textbox", {
    name: "Текст варианта",
    exact: true,
  });
  const alert = page.locator('.scene-alert[role="alert"] p');
  return {
    title: await title.inputValue(),
    text: await text.inputValue(),
    reading_key: await text.getAttribute("data-reading-key"),
    status_state: await page
      .locator(".scene-variant-status")
      .getAttribute("data-state"),
    save_disabled: await page
      .getByRole("button", { name: "Сохранить вариант", exact: true })
      .isDisabled(),
    alert_text: (await alert.count()) ? await alert.innerText() : "",
  };
}
async function waitState(page, state) {
  await page.waitForFunction(
    (expected) =>
      document
        .querySelector(".scene-variant-status")
        ?.getAttribute("data-state") === expected,
    state,
    { timeout: 10000 },
  );
}
async function pageFor(label) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "ru-RU",
    timezoneId: "UTC",
    serviceWorkers: "block",
  });
  contexts.push(context);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(10000);
  page.on("pageerror", (error) =>
    observed.browser_page_errors.push({
      context: label,
      message: error.message,
    }),
  );
  page.on("request", (request) => {
    if (!request.url().startsWith(origin + "/"))
      observed.unexpected_page_requests.push({
        context: label,
        url: request.url(),
      });
  });
  page.on("response", (response) => {
    const request = response.request();
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/scene-workspace/candidates"
    ) {
      observed.browser_posts.push({
        context: label,
        method: request.method(),
        path: new URL(request.url()).pathname + new URL(request.url()).search,
        body_text: request.postData(),
        status: response.status(),
      });
    }
  });
  await page.goto(origin, { waitUntil: "networkidle" });
  await page
    .getByRole("textbox", { name: "Текст текущей сцены", exact: true })
    .waitFor({ state: "visible" });
  return page;
}
async function fill(page, values) {
  await page
    .getByRole("textbox", { name: "Название варианта", exact: true })
    .fill(values.title);
  await page
    .getByRole("textbox", { name: "Текст варианта", exact: true })
    .fill(values.text);
  await waitState(page, "dirty");
}
async function clickSave(page, expectedStatus) {
  const response = page.waitForResponse(
    (value) =>
      value.request().method() === "POST" &&
      new URL(value.url()).pathname === "/api/scene-workspace/candidates",
  );
  await page
    .getByRole("button", { name: "Сохранить вариант", exact: true })
    .click();
  assert.equal((await response).status(), expectedStatus);
}

try {
  build = await buildApp();
  await save("BUILD.local.json", build);
  const assets = [];
  async function inventory(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) await inventory(path);
      else {
        const bytes = await readFile(path);
        assets.push({
          path: relative(build.distPath, path),
          sha256: sha(bytes),
          bytes: bytes.length,
        });
      }
    }
  }
  await inventory(build.distPath);
  await save(
    "DIST_MANIFEST.local.json",
    assets.sort((a, b) => a.path.localeCompare(b.path)),
  );
  for (const name of ["sources", "data"]) await mkdir(join(scratch, name));
  await writeFile(join(scratch, "sources/scene.txt"), fixture.scene_text, {
    flag: "wx",
  });
  await writeFile(
    join(scratch, "sources/reference.txt"),
    fixture.reference.text,
    { flag: "wx" },
  );
  const configPath = join(scratch, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      id: fixture.scene_id,
      title: "Mounted synthetic EdOS pilot",
      status: "synthetic-test-only",
      root: join(scratch, "sources"),
      file: "scene.txt",
      sections: [
        {
          id: fixture.section_id,
          title: fixture.section_title,
          heading: fixture.heading,
          note: "Synthetic fixture only",
          sources: [fixture.reference.id],
        },
      ],
      documents: [
        {
          id: fixture.reference.id,
          title: fixture.reference.title,
          description: "Synthetic reference",
          file: "reference.txt",
        },
      ],
      nextStep: "Bounded mounted editor pilot only",
    }),
    { flag: "wx" },
  );
  const copiedHandler = join(scratch, "handler.mjs");
  await writeFile(copiedHandler, handlerBytes, { flag: "wx" });
  const { createSceneWorkspace, handleSceneRequest } = await import(
    pathToFileURL(copiedHandler).href
  );
  workspace = await createSceneWorkspace(configPath, join(scratch, "data"));
  observed.sources.before = await sourceHashes();
  assert.deepEqual(await revisions(), {});
  server = await bounded(
    startMountedServer({
      dist: build.distPath,
      workspace,
      handleSceneRequest,
      observed,
    }),
    3000,
    "Server listen deadline",
  );
  origin = server.origin;
  browser = await chromium.launch({
    executablePath: executable,
    headless: true,
    timeout: 15000,
  });
  result.browser_version = browser.version();
  await bounded(
    (async () => {
      const a = await pageFor("A");
      await a
        .getByRole("button", { name: "Новый вариант", exact: true })
        .click();
      await fill(a, fixture.create);
      await clickSave(a, 200);
      await waitState(a, "saved");
      observed.snapshots.created = await snapshot(a);
      observed.revisions.after_create = await revisions();
      await a.screenshot({ path: join(output, "created.png"), fullPage: true });

      const b = await pageFor("B");
      const candidate = b
        .getByRole("button")
        .filter({ hasText: fixture.create.title });
      assert.equal(await candidate.count(), 1);
      await candidate.click();
      await waitState(b, "saved");
      await fill(b, fixture.stale);
      observed.snapshots.stale_before = await snapshot(b);

      await fill(a, fixture.update);
      await clickSave(a, 200);
      await waitState(a, "saved");
      observed.snapshots.updated = await snapshot(a);
      observed.revisions.before_stale = await revisions();
      await a.screenshot({ path: join(output, "updated.png"), fullPage: true });

      await clickSave(b, 409);
      await b
        .locator('.scene-alert[role="alert"] p')
        .waitFor({ state: "visible" });
      await waitState(b, "dirty");
      await b.waitForFunction(
        () =>
          !document.querySelector('button[aria-label="Сохранить вариант"]')
            ?.disabled,
      );
      observed.snapshots.stale_after = await snapshot(b);
      observed.revisions.after_stale = await revisions();
      observed.sources.after = await sourceHashes();
      await b.screenshot({
        path: join(output, "stale-409.png"),
        fullPage: true,
      });
      await server.settle();
      assert.deepEqual(observed.browser_page_errors, []);
      assert.deepEqual(observed.unexpected_page_requests, []);
      assert.deepEqual(observed.server_errors, []);
      result.oracle = assertMountedOutcome(observed, fixture);
    })(),
    120000,
    "Mounted trial exceeded 120 seconds",
  );
  result.status = "PASS_SCOPED_MOUNTED_EDITOR_TRANSPORT";
} catch (error) {
  failure = error;
  result.failure = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
} finally {
  await cleanup();
}

async function cleanup() {
  for (const [name, close] of [
    [
      "contexts_closed",
      async () => {
        for (const context of contexts) await context.close();
      },
    ],
    [
      "browser_closed",
      async () => {
        if (browser) {
          await browser.close();
          assert.equal(browser.isConnected(), false);
        }
      },
    ],
    [
      "server_closed",
      async () => {
        await server?.close();
      },
    ],
  ]) {
    try {
      await bounded(close(), 10000, name + " cleanup deadline");
      result.cleanup[name] = true;
    } catch (error) {
      result.status = "FAIL";
      result.cleanup[name] = { error: error.message };
      failure ??= error;
    }
  }
  try {
    assert.equal(sha(await readFile(handlerPath)), sha(handlerBytes));
    result.handler_original_unchanged = true;
    if (build?.bindings?.source_files) {
      for (const [path, hashes] of Object.entries(build.bindings.source_files))
        assert.equal(sha(await readFile(join(product, path))), hashes.before);
      for (const [path, hash] of Object.entries(build.recheckFiles ?? {}))
        assert.equal(sha(await readFile(path)), hash);
      result.component_closure_originals_unchanged = true;
    }
  } catch (error) {
    result.status = "FAIL";
    result.input_drift = error.message;
    failure ??= error;
  }
  try {
    try {
      await writeFile(
        join(output, "BUILD.log"),
        await readFile(join(scratch, "build/build.log")),
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await save("OBSERVATION.json", observed);
  } catch (error) {
    result.status = "FAIL";
    result.evidence_write_error = error.message;
    failure ??= error;
  }
  if (
    ["contexts_closed", "browser_closed", "server_closed"].every(
      (key) => result.cleanup[key] === true,
    )
  ) {
    try {
      await rm(scratch, { recursive: true, force: false });
      result.cleanup.scratch_removed = true;
    } catch (error) {
      result.status = "FAIL";
      result.cleanup.scratch_removed = { error: error.message };
      failure ??= error;
    }
  }
  if (result.cleanup.scratch_removed !== true)
    result.retained_scratch_local_path = scratch;
  result.elapsed_ms = Date.now() - began;
  result.ended_at = new Date().toISOString();
  await save("RESULT.json", result);
}

process.stdout.write(
  JSON.stringify({
    status: result.status,
    posts: observed.posts.map(({ status }) => status),
    cleanup: result.cleanup,
    historical_full_capture_acceptance: "FAIL",
  }) + "\n",
);
if (failure) process.exitCode = 1;
