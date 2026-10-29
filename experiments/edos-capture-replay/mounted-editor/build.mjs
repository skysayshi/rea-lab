import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";

const componentPin =
  "3fb2400bc64d676516d08798a715cf3c5d76296d3c3431ed5ddb52d64db04c17";
const sources = [
  "local/scene-workspace.tsx",
  "local/scene-workspace.css",
  "local/scene-resume.ts",
  "local/scene-reading-place.ts",
  "lib/text-reading-place.ts",
  "lib/manuscript-loop.ts",
  "lib/workspace-persistence.ts",
  "lib/access-gate.ts",
  "lib/workspace-navigation.ts",
  "package.json",
  "package-lock.json",
];
const packages = [
  ["vite", "vite"],
  ["@vitejs/plugin-react", "@vitejs/plugin-react"],
  ["react", "react"],
  ["react-dom", "react-dom/client"],
  ["lucide-react", "lucide-react"],
  ["rolldown", "rolldown"],
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (path, root) => path === root || path.startsWith(root + sep);
const portablePath = (path) => path.split(sep).join("/");
const entry = `import { createRoot } from "react-dom/client";
import { SceneWorkspace } from "./local/scene-workspace";

let beforeLeave = null;
const registerBeforeLeave = (callback) => {
  beforeLeave = callback;
  return () => { if (beforeLeave === callback) beforeLeave = null; };
};
const root = document.getElementById("root");
if (!root) throw new Error("Mounted synthetic root is missing");
createRoot(root).render(<SceneWorkspace registerBeforeLeave={registerBeforeLeave} />);
`;
const html =
  '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mounted synthetic EdOS editor</title></head><body><div id="root"></div><script type="module" src="/mounted-entry.tsx"></script></body></html>\n';

async function readSources(productRoot) {
  const values = {};
  for (const path of sources) {
    const source = join(productRoot, path);
    assert(
      (await lstat(source)).isFile(),
      `Expected an ordinary source file: ${path}`,
    );
    values[path] = await readFile(source);
  }
  return values;
}

async function packageBindings(productRoot, dependencies, recheckFiles) {
  const require = createRequire(join(productRoot, "package.json"));
  const result = {};
  for (const [name, entryName] of packages) {
    const metadataPath = join(
      productRoot,
      "node_modules",
      name,
      "package.json",
    );
    const metadata = await readFile(metadataPath);
    const file = await realpath(require.resolve(entryName));
    assert(
      inside(file, dependencies),
      `Dependency entry is outside the selected installation: ${name}`,
    );
    const entrySha256 = hash(await readFile(file));
    recheckFiles[metadataPath] = hash(metadata);
    recheckFiles[file] = entrySha256;
    result[name] = {
      version: JSON.parse(metadata).version,
      package_json_sha256: hash(metadata),
      entry: portablePath(relative(dependencies, file)),
      entry_sha256: entrySha256,
    };
  }
  return result;
}

function buildLogger() {
  const messages = [],
    seen = new Set(),
    errors = new Set();
  const logger = {
    hasWarned: false,
    info(message) {
      messages.push({ level: "info", message });
    },
    warn(message) {
      logger.hasWarned = true;
      messages.push({ level: "warn", message });
    },
    warnOnce(message) {
      if (!seen.has(message)) {
        seen.add(message);
        logger.warn(message);
      }
    },
    error(message, options) {
      if (options?.error) errors.add(options.error);
      messages.push({ level: "error", message });
    },
    clearScreen() {},
    hasErrorLogged(error) {
      return errors.has(error);
    },
  };
  return { logger, messages };
}

function moduleClosure(snapshot, dependencies) {
  let ids = [];
  const firstLoad = new Map();
  const physicalPath = (id) =>
    id.includes("?") ? id.slice(0, id.indexOf("?")) : id;
  const classify = (id) => {
    if (id.startsWith("\0") || !isAbsolute(id))
      return { kind: "virtual", id_sha256: hash(id) };
    const queryAt = id.indexOf("?"),
      file = queryAt < 0 ? id : id.slice(0, queryAt);
    const kind = inside(file, snapshot)
      ? "snapshot"
      : inside(file, dependencies)
        ? "dependency"
        : undefined;
    assert(kind, `Unexpected module outside snapshot/dependencies: ${file}`);
    return {
      kind,
      path: portablePath(
        relative(kind === "snapshot" ? snapshot : dependencies, file),
      ),
      ...(queryAt < 0 ? {} : { query: id.slice(queryAt) }),
    };
  };
  return {
    plugin: {
      name: "owned-mounted-source-closure",
      enforce: "pre",
      async load(id) {
        if (classify(id).kind !== "virtual") {
          const file = physicalPath(id),
            digest = hash(await readFile(file));
          const previous = firstLoad.get(file);
          assert(
            previous === undefined || previous === digest,
            `Module source changed between loads: ${file}`,
          );
          firstLoad.set(file, digest);
        }
        return null;
      },
      generateBundle() {
        ids = [...this.getModuleIds()];
        for (const id of ids)
          assert(
            !this.getModuleInfo(id)?.isExternal,
            "Mounted app must not depend on external modules",
          );
      },
    },
    async result() {
      const modules = [],
        recheckFiles = {};
      for (const id of ids) {
        const item = classify(id);
        if (item.kind === "virtual") {
          modules.push(item);
          continue;
        }
        const file = physicalPath(id),
          digest = hash(await readFile(file));
        assert(
          firstLoad.has(file),
          `Physical module was not observed by the pre-load binding hook: ${file}`,
        );
        assert.equal(
          digest,
          firstLoad.get(file),
          `Module source changed during build: ${file}`,
        );
        recheckFiles[file] = digest;
        modules.push({ ...item, sha256: digest });
      }
      modules.sort((left, right) =>
        JSON.stringify(left) < JSON.stringify(right)
          ? -1
          : JSON.stringify(left) > JSON.stringify(right)
            ? 1
            : 0,
      );
      assert(
        modules.some(
          (item) =>
            item.kind === "snapshot" &&
            item.path === "local/scene-workspace.tsx",
        ),
        "Actual SceneWorkspace must be in the loaded module closure",
      );
      return {
        modules,
        sha256: hash(JSON.stringify(modules)),
        recheckFiles,
        scope:
          "Physical bundled-module bytes at pre-load and after build; virtual IDs by SHA-256; not a hermetic host or tooling attestation",
      };
    },
  };
}

async function populateSnapshot(before, snapshot, dependencies) {
  for (const [path, bytes] of Object.entries(before)) {
    const target = join(snapshot, path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    assert.equal(
      hash(await readFile(target)),
      hash(bytes),
      `Snapshot bytes changed: ${path}`,
    );
  }
  await symlink(dependencies, join(snapshot, "node_modules"), "dir");
  await writeFile(join(snapshot, "mounted-entry.tsx"), entry, {
    flag: "wx",
    mode: 0o600,
  });
  await writeFile(join(snapshot, "index.html"), html, {
    flag: "wx",
    mode: 0o600,
  });
}

async function bundleMountedApp(product, paths, dependencies, logger) {
  const require = createRequire(join(product, "package.json"));
  const { build } = await import(pathToFileURL(require.resolve("vite")));
  const { default: react } = await import(
    pathToFileURL(require.resolve("@vitejs/plugin-react"))
  );
  const closure = moduleClosure(paths.snapshot, dependencies);
  await build({
    configFile: false,
    envDir: false,
    envPrefix: [],
    mode: "production",
    root: paths.snapshot,
    publicDir: false,
    cacheDir: paths.cache,
    customLogger: logger,
    plugins: [closure.plugin, react()],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    css: { postcss: { plugins: [] } },
    build: {
      outDir: paths.dist,
      emptyOutDir: false,
      sourcemap: false,
      target: "es2022",
      reportCompressedSize: false,
      rolldownOptions: { input: join(paths.snapshot, "index.html") },
    },
  });
  return closure.result();
}

async function sourceBindingsAfterBuild(product, snapshot, before) {
  const after = await readSources(product),
    bindings = {},
    recheckFiles = {};
  for (const path of sources) {
    const original = hash(before[path]),
      copied = hash(await readFile(join(snapshot, path))),
      current = hash(after[path]);
    assert.equal(
      copied,
      original,
      `Snapshot source changed during build: ${path}`,
    );
    assert.equal(
      current,
      original,
      `Original source changed during build: ${path}`,
    );
    bindings[path] = { before: original, snapshot: copied, after: current };
    recheckFiles[join(product, path)] = current;
    recheckFiles[join(snapshot, path)] = copied;
  }
  return { bindings, recheckFiles };
}

function mountedBindings(sourceCheck, installedBefore, loadedModules) {
  return {
    node: process.version,
    component_sha256: componentPin,
    source_files: sourceCheck.bindings,
    installed_packages: installedBefore,
    entry_sha256: hash(entry),
    html_sha256: hash(html),
    loaded_module_closure: loadedModules,
    mount:
      "Real ReactDOM.createRoot of unchanged SceneWorkspace; registration holder only; no StrictMode",
    dependency_use:
      "Existing installation through a symlink; no install/update; not OS-enforced read-only",
    original_checkout_clean:
      "NOT_ASSERTED; raw selected-file hashes identify the dirty checkout",
    limitations: [
      "Component mount only; the complete Flightdeck, AccessGate UI and navigation owner are not mounted.",
      "Selected source, package and module identity bindings are not a hermetic host or complete dependency attestation.",
    ],
  };
}

/** Snapshot whole source files and build one real ReactDOM mount in a new owned directory. */
export async function prepareMountedApp(productRoot, ownedOutputDirectory) {
  assert.equal(process.version, "v24.22.1", "Use Node 24.22.1");
  assert(
    [productRoot, ownedOutputDirectory].every(isAbsolute),
    "Explicit absolute input and output paths are required",
  );
  const product = await realpath(productRoot);
  const output = join(
    await realpath(dirname(ownedOutputDirectory)),
    basename(ownedOutputDirectory),
  );
  assert(
    !inside(output, product),
    "Output must be outside the original product tree",
  );
  const before = await readSources(product);
  assert.equal(
    hash(before["local/scene-workspace.tsx"]),
    componentPin,
    "Actual component pin mismatch",
  );
  const dependencies = await realpath(join(product, "node_modules"));
  const packageFiles = {};
  const installedBefore = await packageBindings(
    product,
    dependencies,
    packageFiles,
  );
  await mkdir(output, { mode: 0o700 }); // Exclusive: an existing directory or symlink is refused.
  const paths = {
    snapshot: join(output, "snapshot"),
    cache: join(output, "cache"),
    dist: join(output, "dist"),
  };
  const { snapshot, dist } = paths;
  await mkdir(snapshot, { mode: 0o700 });
  const { logger, messages } = buildLogger();
  const logPath = join(output, "build.log");
  try {
    await populateSnapshot(before, snapshot, dependencies);
    const { recheckFiles: moduleFiles, ...loadedModules } =
      await bundleMountedApp(product, paths, dependencies, logger);
    const sourceCheck = await sourceBindingsAfterBuild(
      product,
      snapshot,
      before,
    );
    const packageFilesAfter = {};
    const installedAfter = await packageBindings(
      product,
      dependencies,
      packageFilesAfter,
    );
    assert.deepEqual(
      installedAfter,
      installedBefore,
      "Selected package bindings changed during build",
    );
    assert.deepEqual(
      packageFilesAfter,
      packageFiles,
      "Selected package files changed during build",
    );
    assert(
      (await lstat(join(dist, "index.html"))).isFile(),
      "Build did not produce the mounted page",
    );
    return {
      ownedDirectory: output,
      snapshotPath: snapshot,
      distPath: dist,
      logPath,
      recheckFiles: {
        ...packageFiles,
        ...moduleFiles,
        ...sourceCheck.recheckFiles,
      },
      bindings: mountedBindings(sourceCheck, installedBefore, loadedModules),
    };
  } catch (error) {
    logger.error(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    throw error;
  } finally {
    await writeFile(
      logPath,
      messages.map((item) => JSON.stringify(item)).join("\n") + "\n",
      { flag: "wx", mode: 0o600 },
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  assert.equal(
    process.argv.length,
    4,
    "Usage: node build.mjs ABSOLUTE_PRODUCT_ROOT NEW_ABSOLUTE_OWNED_OUTPUT_DIRECTORY",
  );
  const prepared = await prepareMountedApp(process.argv[2], process.argv[3]);
  const bindingsPath = join(prepared.ownedDirectory, "bindings.local.json");
  await writeFile(bindingsPath, JSON.stringify(prepared, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  // Bundler progress may also reach stdout; structured metadata owns this file.
  console.log(
    JSON.stringify({
      status: "BUILT_MOUNTED_APP",
      bindings_file: bindingsPath,
    }),
  );
}
