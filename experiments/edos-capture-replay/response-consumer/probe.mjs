import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { selectRecordedResponse } from "../response-fixtures/consumer.mjs";

const pins = {
  component: "3fb2400bc64d676516d08798a715cf3c5d76296d3c3431ed5ddb52d64db04c17",
  typescript:
    "3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675",
  typescriptPackage:
    "822ef7ca6452205657b6288b066481ecf508bfbf43455d715cf7d3ec457561e6",
  pack: "c9cfc0f66b4c50b7dc6da21b20bf66a82928e12caa3573c869dd2a67849bac17",
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const requireValue = (condition, message) => {
  if (!condition) throw new Error(message);
};
const syntheticToken = "synthetic-token";

function extractCallbacks(ts, text) {
  const file = ts.createSourceFile(
    "scene-workspace.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found = { api: [], openSource: [], save: [] };
  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text in found &&
      node.name.text !== "save"
    )
      found[node.name.text].push(node);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "save" &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(file) === "useCallback"
    )
      found.save.push(node.initializer.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(file);
  for (const [name, nodes] of Object.entries(found))
    requireValue(nodes.length === 1, `Expected one actual ${name} callback`);
  const api = found.api[0].getText(file),
    openSource = found.openSource[0].getText(file),
    save = found.save[0].getText(file);
  const guards = [];
  function findGuard(node) {
    if (
      ts.isIfStatement(node) &&
      node.expression.getText(file) === "request === sourceRequest.current" &&
      /\bsetSource\(/u.test(node.thenStatement.getText(file))
    )
      guards.push(node.expression);
    ts.forEachChild(node, findGuard);
  }
  findGuard(found.openSource[0]);
  requireValue(
    guards.length === 1,
    "Expected one source-install generation guard",
  );
  const start = guards[0].getStart(file) - found.openSource[0].getStart(file);
  const end = guards[0].getEnd() - found.openSource[0].getStart(file);
  return {
    api,
    openSource,
    save,
    generationMutant:
      openSource.slice(0, start) + "true" + openSource.slice(end),
  };
}

function compileCallback(ts, text, dependencies) {
  const compiled = ts.transpileModule(`const callback = ${text};`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  return new Function(
    ...Object.keys(dependencies),
    `${compiled}\nreturn callback;`,
  )(...Object.values(dependencies));
}

function transport(packBytes, calls, requestBodies, deferred) {
  const queue = [];
  const fetch = async (input, init) => {
    requireValue(
      typeof input === "string" &&
        input.startsWith("/api/scene-workspace") &&
        !input.includes("#"),
      "Only literal offline scene paths are supported",
    );
    const queryAt = input.indexOf("?"),
      path = queryAt < 0 ? input : input.slice(0, queryAt),
      query = queryAt < 0 ? null : input.slice(queryAt);
    requireValue(
      init?.cache === "no-store" &&
        init.signal instanceof AbortSignal &&
        !init.signal.aborted,
      "Expected actual api cache and live timeout signal",
    );
    const headers = new Headers(init.headers);
    requireValue(
      headers.get("X-Edos-Scene-Client") === "1",
      "Expected synthetic scene client header",
    );
    let body = null;
    if (init.method === "GET")
      requireValue(
        init.body === undefined && [...headers].length === 1,
        "GET transport must not carry a body or auth headers",
      );
    else {
      requireValue(
        init.method === "POST" &&
          typeof init.body === "string" &&
          headers.get("Content-Type") === "application/json" &&
          headers.get("X-Edos-Scene-Token") === syntheticToken &&
          [...headers].length === 3,
        "POST transport requires declared synthetic headers and token",
      );
      body = JSON.parse(init.body);
    }
    calls.push({
      method: init.method,
      path,
      query,
      bodyKeys: body === null ? [] : Object.keys(body).sort(),
    });
    requestBodies.push(structuredClone(body));
    const result = selectRecordedResponse(
      packBytes,
      {
        purpose: "offline-regression-fixtures",
        method: init.method,
        path,
        query,
        request_body: body,
      },
      { expectedPackSha256: pins.pack },
    );
    const bytes = JSON.stringify(result.body);
    const answer = () =>
      new Response(bytes, {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    if (!deferred) return answer();
    return new Promise((resolve, reject) => {
      const entry = {
        settled: false,
        finish: () => {
          if (entry.settled) return;
          entry.settled = true;
          init.signal.removeEventListener("abort", aborted);
          if (init.signal.aborted) reject(init.signal.reason);
          else resolve(answer());
        },
      };
      const aborted = () => {
        entry.settled = true;
        reject(init.signal.reason);
      };
      init.signal.addEventListener("abort", aborted, { once: true });
      queue.push(entry);
    });
  };
  return {
    fetch,
    pendingCount: () => queue.filter((entry) => !entry.settled).length,
    async flush(index = 0) {
      await Promise.resolve();
      const pending = queue.filter((entry) => !entry.settled);
      requireValue(
        Number.isSafeInteger(index) && index >= 0 && index < pending.length,
        "No pending response at that index",
      );
      pending[index].finish();
    },
  };
}

function scenarioState(post, draft) {
  return {
    source: null,
    pane: "links",
    error: "",
    loading: false,
    notice: "",
    saving: false,
    sourceUpdates: [],
    paneUpdates: [],
    savedUpdates: [],
    editorUpdates: [],
    captureCount: 0,
    companionCaptureCount: 0,
    rememberCount: 0,
    writeCount: 0,
    draftRef: { current: draft },
    sceneRef: {
      current: {
        id: "synthetic-scene",
        revision: post.request_body.baseRevision,
        token: syntheticToken,
      },
    },
    pendingSave: { current: null },
    sourceRequest: { current: 0 },
    forkRequest: { current: 0 },
    companionPlaces: { current: {} },
    candidatesRef: { current: { sequence: 0, items: [] } },
  };
}

function makeScenario(environment, options) {
  const { ts, callbacks, packBytes, post } = environment;
  const { deferred = false, draft = null, generationMutant = false } = options;
  requireValue(
    typeof deferred === "boolean" && typeof generationMutant === "boolean",
    "Scenario flags must be booleans",
  );
  const state = scenarioState(post, draft);
  const calls = [],
    requestBodies = [],
    wire = transport(packBytes, calls, requestBodies, deferred);
  const api = compileCallback(ts, callbacks.api, { fetch: wire.fetch });
  const setError = (value) => {
    state.error = value;
  };
  const save = compileCallback(ts, callbacks.save, {
    api,
    pendingSave: state.pendingSave,
    draftRef: state.draftRef,
    sceneRef: state.sceneRef,
    companionPlaces: state.companionPlaces,
    candidatesRef: state.candidatesRef,
    captureCompanion: () => {
      state.companionCaptureCount++;
    },
    setSaving: (value) => {
      state.saving = value;
    },
    setError,
    trackWorkspaceWrite: (_label, operation) => {
      state.writeCount++;
      return operation();
    },
    candidatePlaceAfterSave: () => {
      throw new Error(
        "Save success is unsupported by this rejection-only probe",
      );
    },
    setEditorState: (value) => {
      state.editorUpdates.push(structuredClone(value));
    },
    setCandidates: (value) => {
      state.savedUpdates.push(structuredClone(value));
    },
    remember: () => {
      state.rememberCount++;
    },
    setNotice: (value) => {
      state.notice = value;
    },
  });
  const evaluatedOpenSource = generationMutant
    ? callbacks.generationMutant
    : callbacks.openSource;
  const openSource = compileCallback(ts, evaluatedOpenSource, {
    api,
    save,
    sourceRequest: state.sourceRequest,
    forkRequest: state.forkRequest,
    capture: () => {
      state.captureCount++;
    },
    setLoadingSource: (value) => {
      state.loading = value;
    },
    setError,
    setSource: (value) => {
      state.source = value;
      state.sourceUpdates.push(structuredClone(value));
    },
    setPane: (value) => {
      state.pane = value;
      state.paneUpdates.push(value);
    },
  });
  return {
    state,
    calls,
    requestBodies,
    api,
    save,
    openSource,
    flush: wire.flush,
    pendingCount: wire.pendingCount,
    invalidate: () => {
      state.sourceRequest.current++;
    },
    bindings: {
      generation_mutant: generationMutant,
      evaluated_open_source_sha256: hash(evaluatedOpenSource),
    },
  };
}

/** Read trusted private source; no private source text is emitted or persisted. */
export async function loadProbe({ componentPath, typescriptPath, packPath }) {
  requireValue(
    [componentPath, typescriptPath, packPath].every(
      (path) => typeof path === "string" && isAbsolute(path),
    ),
    "Probe inputs must be explicit absolute paths",
  );
  const [component, compiler, compilerPackage, pack] = await Promise.all([
    readFile(componentPath),
    readFile(typescriptPath),
    readFile(join(dirname(typescriptPath), "../package.json")),
    readFile(packPath),
  ]);
  for (const [name, bytes] of Object.entries({
    component,
    typescript: compiler,
    typescriptPackage: compilerPackage,
    pack,
  }))
    requireValue(
      hash(bytes) === pins[name],
      `Probe input pin mismatch: ${name}`,
    );
  const ts = createRequire(import.meta.url)(typescriptPath);
  requireValue(ts.version === "5.9.3", "Expected TypeScript 5.9.3");
  const callbacks = extractCallbacks(ts, component.toString("utf8"));
  const parsedPack = JSON.parse(pack);
  const posts = parsedPack.records.filter(
    (record) =>
      record.method === "POST" &&
      record.path === "/api/scene-workspace/candidates",
  );
  requireValue(
    posts.length === 1,
    "Expected one qualified synthetic POST intent",
  );
  const bindings = {
    component_sha256: hash(component),
    typescript_sha256: hash(compiler),
    typescript_package_sha256: hash(compilerPackage),
    typescript_version: ts.version,
    pack_sha256: hash(pack),
    api_sha256: hash(callbacks.api),
    open_source_sha256: hash(callbacks.openSource),
    save_sha256: hash(callbacks.save),
  };
  return {
    bindings,
    newScenario: (options = {}) =>
      makeScenario({ ts, callbacks, packBytes: pack, post: posts[0] }, options),
  };
}
