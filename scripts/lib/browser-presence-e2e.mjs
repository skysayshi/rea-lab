import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { browserScenarioSchema } from "../../dist/domain/browserScenario.js";
import { browserScenarioCaptureSchema } from "../../dist/domain/browserScenarioCapture.js";
import { parseEvidence } from "../../dist/domain/evidence.js";
import { PrivateRuntimeRoot } from "../../dist/process/PrivateRuntimeRoot.js";
import { summarizeBrowserScenarioNetwork } from "../../dist/domain/analysisView/browserScenarioNetworkView.js";
import { createPackageVerifierCommands } from "./verify-package-commands.mjs";
import { withVerifierCleanup } from "./verifier-cleanup.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const cases = [
  {
    id: "absent",
    method: "GET",
    text: undefined,
    observe: true,
    measure: false,
    expected: "absent",
  },
  {
    id: "present-empty",
    method: "POST",
    text: "",
    observe: true,
    measure: true,
    expected: "present-empty",
  },
  {
    id: "present",
    method: "POST",
    text: "Синтетическое тело ё 🚀",
    observe: true,
    measure: true,
    expected: "present",
  },
  {
    id: "unknown",
    method: "POST",
    text: "Наблюдение presence отключено.\n",
    observe: false,
    measure: false,
    expected: "unknown",
  },
];

async function bounded(operation, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** A bounded receiver is an independent payload oracle, not a Request identity proof. */
async function startPresenceSite() {
  const receipts = [];
  const pending = [];
  let origin;
  const server = http.createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; connect-src 'self'",
      });
      response.end("<!doctype html><title>REA presence fixture</title>");
      return;
    }
    if (request.url !== "/presence") {
      response.writeHead(404);
      response.end();
      return;
    }
    const receipt = {
      case_id: request.headers["x-fixture-case"],
      run_id: request.headers["x-rea-presence-run"],
      request_id: request.headers["x-rea-presence-token"],
      method: request.method,
      url: `${origin}/presence`,
      complete: false,
    };
    receipts.push(receipt);
    pending.push(
      (async () => {
        try {
          const chunks = [];
          let bytes = 0;
          for await (const chunk of request) {
            bytes += chunk.length;
            assert.ok(
              bytes <= 4096,
              "Synthetic receiver exceeded its byte budget",
            );
            chunks.push(chunk);
          }
          const body = Buffer.concat(chunks);
          Object.assign(receipt, {
            complete: request.complete,
            bytes: body.length,
            sha256: hash(body),
            body_base64: body.toString("base64"),
          });
          response.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          response.end(
            JSON.stringify({ case_id: receipt.case_id, bytes: body.length }),
          );
        } catch (cause) {
          receipt.error =
            cause instanceof Error ? cause.message : String(cause);
          if (!response.headersSent) response.writeHead(500);
          response.end();
        }
      })(),
    );
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  try {
    await bounded(
      new Promise((done, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          origin = `http://127.0.0.1:${server.address().port}`;
          done();
        });
      }),
      2000,
      "Presence receiver listen deadline",
    );
  } catch (cause) {
    server.closeAllConnections();
    if (server.listening) await new Promise((done) => server.close(done));
    throw cause;
  }
  return {
    origin,
    receipts,
    settle: () =>
      bounded(
        Promise.all(pending),
        2000,
        "Presence receiver settlement deadline",
      ),
    close: async () => {
      server.closeAllConnections();
      await bounded(
        new Promise((done, reject) => {
          server.close((error) => (error ? reject(error) : done()));
        }),
        2000,
        "Presence receiver close deadline",
      );
    },
  };
}

/** Verify actual public CLI output; expected payloads originate in this fixture. */
export function assertPresenceCapture(capture, receipts, origin) {
  assert.equal(capture.browser.mode, "launch");
  assert.equal(capture.browser.process_ownership, "provider-owned");
  assert.equal(capture.browser.cleanup, "terminated-owned-process");
  assert.equal(capture.steps.length, 5);
  assert.ok(capture.steps.every(({ status }) => status === "completed"));
  assert.equal(
    receipts.length,
    4,
    "Only the four declared requests reached the receiver",
  );
  assert.equal(new Set(receipts.map(({ request_id }) => request_id)).size, 4);
  const events = capture.events.items;
  const presenceEvents = events.filter(
    ({ kind }) => kind === "request-body-presence",
  );
  assert.equal(presenceEvents.length, 4);
  const requests = events.filter(
    (event) =>
      event.kind === "request" && event.url.url === `${origin}/presence`,
  );
  assert.equal(requests.length, 4);
  assert.equal(
    new Set(requests.map(({ transaction_id }) => transaction_id)).size,
    4,
  );
  const sourceSequences = new Set();
  const result = [];
  for (const expected of cases) {
    const step = capture.steps.find(({ step_id }) => step_id === expected.id);
    assert.ok(step);
    const matches = requests.filter(
      ({ step_index }) => step_index === step.step_index,
    );
    assert.equal(
      matches.length,
      1,
      `${expected.id}: one same-URL request in its own step`,
    );
    const request = matches[0];
    assert.equal(request.method, expected.method);
    const proofs = presenceEvents.filter(
      ({ transaction_id }) => transaction_id === request.transaction_id,
    );
    assert.equal(proofs.length, 1, `${expected.id}: one bound presence event`);
    const proof = proofs[0];
    assert.equal(proof.phase, "request");
    assert.equal(proof.redirect_hop, 0);
    assert.equal(proof.source_event_sequence, request.sequence);
    assert.ok(proof.sequence > request.sequence);
    assert.equal(proof.step_index, request.step_index);
    assert.ok(!sourceSequences.has(proof.source_event_sequence));
    sourceSequences.add(proof.source_event_sequence);
    assert.equal(proof.presence.scope, "fetch-request-pre-dispatch");
    assert.equal(proof.presence.state, expected.expected);
    assert.equal(proof.presence.producer.source, "runtime-owned-fetch-request");
    assert.equal(proof.presence.producer.same_request_verified, true);
    const received = receipts.filter(({ case_id }) => case_id === expected.id);
    assert.equal(
      received.length,
      1,
      `${expected.id}: one independent server receipt`,
    );
    const receipt = received[0];
    assert.equal(receipt.method, expected.method);
    assert.equal(receipt.complete, true);
    assert.ok(!Object.hasOwn(receipt, "error"));
    assert.equal(receipt.bytes, Buffer.byteLength(expected.text ?? ""));
    assert.equal(receipt.sha256, hash(expected.text ?? ""));
    assert.equal(
      receipt.body_base64,
      Buffer.from(expected.text ?? "").toString("base64"),
    );
    assert.equal(proof.presence.producer.run_id, receipt.run_id);
    assert.equal(proof.presence.producer.request_id, receipt.request_id);
    if (
      expected.expected === "present-empty" ||
      expected.expected === "present"
    ) {
      assert.equal(proof.presence.byte_length, receipt.bytes);
      assert.equal(proof.presence.observation.status, "observed");
      assert.equal(proof.presence.observation.body_is_null, false);
      assert.deepEqual(proof.presence.observation.measurement, {
        status: "complete",
        bytes: receipt.bytes,
        sha256: hash(expected.text),
      });
    } else {
      assert.ok(!Object.hasOwn(proof.presence, "byte_length"));
      if (expected.expected === "absent") {
        assert.equal(proof.presence.observation.status, "observed");
        assert.equal(proof.presence.observation.body_is_null, true);
      } else {
        assert.equal(proof.presence.observation.status, "disabled");
        assert.ok(!Object.hasOwn(proof.presence.observation, "body_is_null"));
        assert.ok(!Object.hasOwn(proof.presence.observation, "measurement"));
      }
    }
    const content = events.filter(
      (event) =>
        event.kind === "network-content" &&
        event.phase === "request" &&
        event.transaction_id === request.transaction_id,
    );
    assert.equal(
      content.length,
      1,
      `${expected.id}: original request content retained separately`,
    );
    assert.equal(content[0].source_event_sequence, request.sequence);
    assert.ok(["captured", "not_exposed"].includes(content[0].body.state));
    if (content[0].body.state === "captured") {
      assert.equal(
        content[0].body.representation,
        "browser-exposed-request-bytes",
      );
      assert.equal(content[0].body.bytes, receipt.bytes);
      assert.equal(content[0].body.sha256, receipt.sha256);
    }
    result.push({
      case_id: expected.id,
      state: proof.presence.state,
      transaction_id: request.transaction_id,
      source_event_sequence: request.sequence,
      producer_run_id: receipt.run_id,
      producer_request_id: receipt.request_id,
      receiver_bytes: receipt.bytes,
      original_body: structuredClone(content[0].body),
    });
  }
  assert.equal(
    result[0].original_body.state,
    "not_exposed",
    "Direct absence must not replace the original Playwright exposure state",
  );
  assert.equal(capture.completeness.status, "incomplete");
  assert.ok(
    capture.limitations.some((text) =>
      text.includes("Some selected network content was unavailable"),
    ),
  );
  const before = JSON.stringify(capture);
  const networkSummary = summarizeBrowserScenarioNetwork(capture);
  assert.equal(networkSummary.ambiguous_transactions, 0);
  assert.equal(
    JSON.stringify(capture),
    before,
    "Presence-aware summary must not mutate retained capture",
  );
  return { cases: result, network_summary: networkSummary };
}

/** One four-action public CLI probe, with its CLI/browser family and scratch root owned until cleanup. */
export async function verifyBrowserBodyPresence(
  executable,
  outputDirectory,
  entrypoint = fileURLToPath(new URL("../rea.mjs", import.meta.url)),
) {
  assert.ok(
    isAbsolute(executable) &&
      isAbsolute(outputDirectory) &&
      isAbsolute(entrypoint),
  );
  await mkdir(outputDirectory, { mode: 0o700 });
  const started = Date.now();
  const summary = {
    schema: "rea-runtime-presence-smoke-v1",
    status: "FAIL",
    node: process.version,
    cli: true,
    mcp: false,
    full_capture_acceptance: "FAIL",
    scope:
      "One controlled synthetic loopback scenario through the public capture-browser-scenario CLI. Presence is scoped to Fetch pre-dispatch; transport correlation does not independently authenticate Request identity.",
    cleanup: {
      command_owner_closed: false,
      runtime_removed: false,
      receiver_closed: false,
    },
  };
  let site, root, commands, failure;
  try {
    await withVerifierCleanup(async () => {
      site = await startPresenceSite();
      root = await PrivateRuntimeRoot.create({ prefix: "rea-presence-e2e-" });
      commands = await createPackageVerifierCommands({ workspace: root });
      const tmp = join(root.path, "tmp");
      await mkdir(tmp);
      const scenario = browserScenarioSchema.parse({
        browser: { mode: "launch", executable_path: executable },
        start_url: { url: site.origin },
        actions: cases.map((entry) => ({
          step_id: entry.id,
          action: "request",
          method: entry.method,
          path: "/presence",
          headers: [
            {
              name: "X-Fixture-Case",
              value: { source: "literal", value: entry.id },
            },
          ],
          ...(entry.text === undefined ? {} : { text: entry.text }),
          body_presence: {
            mode: "synthetic-loopback",
            observe: entry.observe,
            measure: entry.measure,
          },
          timeout_ms: 5000,
          expected_status: [200],
        })),
        capture: {
          at_end: ["url"],
          events: ["network"],
          network: {
            request_body: true,
            response_body: false,
            header_values: false,
          },
        },
      });
      await writeFile(
        join(outputDirectory, "SCENARIO.json"),
        JSON.stringify(scenario, null, 2) + "\n",
        { flag: "wx" },
      );
      const args = [
        entrypoint,
        "capture-browser-scenario",
        JSON.stringify(scenario),
        "--json",
      ];
      summary.command = {
        executable: process.execPath,
        entrypoint,
        operation: "capture-browser-scenario",
        scenario_file: "SCENARIO.json",
        json: true,
      };
      summary.harness_sha256 = hash(
        await readFile(fileURLToPath(import.meta.url)),
      );
      const { stdout } = await commands.exec(process.execPath, args, {
        env: {
          ...process.env,
          TMPDIR: tmp,
          REA_LOG_LEVEL: "silent",
          HOPPER_LAUNCHER_PATH: "/rea-unconfigured-provider/hopper",
        },
        timeout: 60000,
        maxBuffer: 16 * 1024 * 1024,
      });
      await writeFile(join(outputDirectory, "EVIDENCE.json"), stdout, {
        flag: "wx",
      });
      summary.evidence_sha256 = hash(stdout);
      const evidence = parseEvidence(JSON.parse(stdout));
      const capture = browserScenarioCaptureSchema.parse(
        evidence.normalized_result,
      );
      const captureText = JSON.stringify(capture, null, 2) + "\n";
      await writeFile(join(outputDirectory, "CAPTURE.json"), captureText, {
        flag: "wx",
      });
      summary.capture_sha256 = hash(captureText);
      summary.browser = capture.browser;
      await site.settle();
      Object.assign(
        summary,
        assertPresenceCapture(capture, site.receipts, site.origin),
      );
      summary.evidence_id = evidence.evidence_id;
      summary.completeness = capture.completeness;
    }, [
      async () => {
        if (commands !== undefined) await commands.close();
        else await root?.close();
        summary.cleanup.command_owner_closed = true;
        if (root !== undefined) {
          try {
            await access(root.path);
            throw new Error("Presence runtime root survived cleanup");
          } catch (cause) {
            if (cause.code !== "ENOENT") throw cause;
          }
        }
        summary.cleanup.runtime_removed = true;
      },
      async () => {
        await site?.close();
        summary.cleanup.receiver_closed = true;
      },
    ]);
    summary.status = "OBSERVED";
  } catch (cause) {
    failure = cause;
    summary.failure = {
      name: cause instanceof Error ? cause.name : typeof cause,
      message: cause instanceof Error ? cause.message : String(cause),
    };
  }
  const serverText = JSON.stringify(site?.receipts ?? [], null, 2) + "\n";
  await writeFile(join(outputDirectory, "SERVER.json"), serverText, {
    flag: "wx",
  });
  summary.server_sha256 = hash(serverText);
  summary.elapsed_ms = Date.now() - started;
  await writeFile(
    join(outputDirectory, "SUMMARY.json"),
    JSON.stringify(summary, null, 2) + "\n",
    { flag: "wx" },
  );
  if (failure !== undefined) throw failure;
  return summary;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  assert.ok(
    process.argv.length === 4 || process.argv.length === 5,
    "Usage: node browser-presence-e2e.mjs ABS_CHROME NEW_OUTPUT_DIR [ABS_CLI_ENTRYPOINT]",
  );
  const summary = await verifyBrowserBodyPresence(
    process.argv[2],
    process.argv[3],
    process.argv[4],
  );
  process.stdout.write(
    JSON.stringify({
      status: summary.status,
      cases: summary.cases.map(({ case_id, state, receiver_bytes }) => ({
        case_id,
        state,
        receiver_bytes,
      })),
      cleanup: summary.cleanup,
      full_capture_acceptance: summary.full_capture_acceptance,
      output_directory: process.argv[3],
    }) + "\n",
  );
}
