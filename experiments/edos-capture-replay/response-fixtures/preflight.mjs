import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const check = (condition, code) => {
  if (!condition) throw new Error(code);
};
const parse = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
export async function loadProducer(reaRoot) {
  const { importVerifierSource } = await import(
    pathToFileURL(join(reaRoot, "scripts/lib/verifier-source-loader.mjs"))
  );
  const { parseEvidence } = await importVerifierSource(
    pathToFileURL(join(reaRoot, "src/domain/evidence.ts")),
  );
  const { loadEnvironmentSource, replayedBody } = await importVerifierSource(
    pathToFileURL(
      join(reaRoot, "src/application/environment/environmentSource.ts"),
    ),
  );
  return { parseEvidence, loadEnvironmentSource, replayedBody };
}

export async function readPinnedInputs(spec) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(spec.files).map(async ([key, pin]) => {
        const bytes = await readFile(pin.path);
        check(sha256(bytes) === pin.sha256, `RAW_PIN:${key}`);
        return [key, bytes];
      }),
    ),
  );
}

function validateOracleState(raw) {
  const fixture = parse(raw.fixture),
    oracle = parse(raw.oracle),
    state = parse(raw.revision);
  check(
    oracle.status === "PASS" &&
      oracle.checks.length > 0 &&
      oracle.checks.every((c) => c.pass === true),
    "ORACLE_STATUS",
  );
  for (const [key, fact] of Object.entries({
    fixture: "fixture_sha256",
    revision: "revision_sha256",
    source: "source_sha256",
    referenceSource: "reference_sha256",
    config: "config_sha256",
  })) {
    check(oracle.facts[fact] === sha256(raw[key]), `ORACLE_BINDING:${key}`);
  }
  check(
    sha256(raw.source) === sha256(fixture.scene_text) &&
      sha256(raw.referenceSource) === sha256(fixture.reference.text),
    "FIXTURE_SOURCE",
  );
  check(
    state.sequence === 1 &&
      state.items?.length === 1 &&
      state.items[0].sectionId === fixture.section_id &&
      state.items[0].title === fixture.candidate.title &&
      state.items[0].text === fixture.candidate.text &&
      state.items[0].baseRevision === sha256(raw.source) &&
      state.items[0].status === "candidate",
    "ORACLE_STATE",
  );
  return { fixture, state };
}

function validateCapturedPost(capture, request, candidatesPath) {
  const events = capture.normalized_result.events.items;
  const posts = events.filter(
    (e) =>
      e.kind === "request" &&
      e.method === "POST" &&
      new URL(e.url.url).pathname === candidatesPath,
  );
  check(posts.length === 1, "POST_REQUEST_UNIQUE");
  const bodies = events.filter(
    (e) =>
      e.kind === "network-content" &&
      e.phase === "request" &&
      e.transaction_id === posts[0].transaction_id &&
      e.source_event_sequence === posts[0].sequence,
  );
  check(
    bodies.length === 1 &&
      bodies[0].body.state === "captured" &&
      bodies[0].body.encoding === "base64" &&
      bodies[0].body.redacted === false,
    "POST_REQUEST_WHOLE",
  );
  const requestBytes = Buffer.from(bodies[0].body.content, "base64");
  check(
    sha256(requestBytes) === bodies[0].body.sha256 &&
      requestBytes.length === bodies[0].body.bytes &&
      isDeepStrictEqual(parse(requestBytes), request),
    "POST_REQUEST_ORACLE",
  );
}

function qualifyResponse(r, raw, source, producer) {
  const tools = source.manifest.tools.filter(
    (t) => t.method === r.method && t.path_template === r.path,
  );
  check(tools.length === 1, `TOOL_UNIQUE:${r.key}`);
  const exchanges = tools[0].record_ordinals
    .map((o) => source.exchanges.get(o))
    .filter((e) => e && e.path === r.path && e.query === r.query);
  check(exchanges.length === 1, `EXCHANGE_UNIQUE:${r.key}`);
  const exchange = exchanges[0],
    body = producer.replayedBody(exchange);
  check(
    body.kind === "json" &&
      exchange.status === 200 &&
      exchange.bodyCut !== true,
    `RESPONSE_WHOLE:${r.key}`,
  );
  const reply = parse(raw[r.key]),
    content = reply.structuredContent,
    replay = content?.replay;
  check(
    reply.isError !== true &&
      reply._meta?.provenance?.untrusted_content === true &&
      content.status === 200 &&
      replay?.evidence_id === source.evidenceId &&
      replay.record_ordinal === exchange.ordinal &&
      replay.exact_match === true &&
      replay.body_recorded === true &&
      replay.truncated === false &&
      replay.recorded_line_truncated === false &&
      replay.content_type_truncated === false &&
      replay.recorded_path === r.path &&
      replay.recorded_query === r.query,
    `REPLAY_BINDING:${r.key}`,
  );
  check(
    isDeepStrictEqual(content.body, body.value) &&
      isDeepStrictEqual(content.body, r.expected),
    `RESPONSE_ORACLE:${r.key}`,
  );
  return {
    method: r.method,
    path: r.path,
    query: r.query,
    request_body: r.request_body,
    response_body: content.body,
    record_ordinal: exchange.ordinal,
    response_sha256: sha256(JSON.stringify(content.body)),
  };
}

// A retrospective, fixed EdOS fixture contract; never a general capture acceptance gate.
export function qualify(spec, raw, producer) {
  try {
    // Historical receipts are pinned provenance, not live-auth prerequisites.
    for (const [key, pin] of Object.entries(spec.files)) {
      check(raw[key] && sha256(raw[key]) === pin.sha256, `RAW_PIN:${key}`);
    }
    const { fixture, state } = validateOracleState(raw);
    const capture = producer.parseEvidence(parse(raw.capture));
    const manifest = producer.parseEvidence(parse(raw.manifest));
    check(capture.evidence_id === spec.capture_evidence_id, "CAPTURE_ID");
    check(manifest.evidence_id === spec.manifest_evidence_id, "MANIFEST_ID");
    const loaded = producer.loadEnvironmentSource(manifest, capture);
    check(loaded.ok, "SOURCE_PAIR");
    const source = loaded.value;
    const request = {
      expectedSequence: 0,
      baseRevision: sha256(raw.source),
      sectionId: fixture.section_id,
      title: fixture.candidate.title,
      text: fixture.candidate.text,
    };
    const candidatesPath = "/api/scene-workspace/candidates",
      referencePath = "/api/scene-workspace/source";
    validateCapturedPost(capture, request, candidatesPath);
    const required = [
      {
        key: "post",
        method: "POST",
        path: candidatesPath,
        query: null,
        request_body: request,
        expected: { ...state, savedId: state.items[0].id },
      },
      {
        key: "candidates",
        method: "GET",
        path: candidatesPath,
        query: null,
        request_body: null,
        expected: state,
      },
      {
        key: "reference",
        method: "GET",
        path: referencePath,
        query: `?id=${fixture.reference.id}`,
        request_body: null,
        expected: {
          id: fixture.reference.id,
          title: fixture.reference.title,
          file: "reference.txt",
          revision: sha256(raw.referenceSource),
          text: fixture.reference.text,
        },
      },
    ];
    const records = required.map((r) =>
      qualifyResponse(r, raw, source, producer),
    );
    const pack = {
      schema: "edos-recorded-responses-v1",
      scope: "offline-regression-fixtures",
      source_evidence_id: source.evidenceId,
      full_capture_acceptance: "FAIL",
      records,
      limitations: [
        "Historical synthetic observations; no live authentication, save execution or state transition is emulated.",
        "Full capture acceptance remains FAIL; GET request bodies were not_exposed, not proven absent.",
        "GET null request_body is this consumer's no-body intent, not a claim about captured request bytes.",
        "Response bytes came from Playwright Response.body(); original wire-transaction identity is not guaranteed.",
        "Known-case retrospective calibration is not a hidden holdout, new capture or product-readiness result.",
        "An external pack SHA-256 binds reviewed bytes; it is not an authorization token or signature.",
      ],
    };
    return {
      status: "QUALIFIED_RESPONSE_SUBSET",
      full_capture_acceptance: "FAIL",
      source_evidence_id: source.evidenceId,
      pack,
    };
  } catch (error) {
    return {
      status: "REJECTED",
      full_capture_acceptance: "FAIL",
      reason: error.message,
    };
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  // Input pins are local reviewed metadata, not commands. Supply their expected raw SHA independently.
  const [reaRoot, pinsPath, expectedPinsSha256, caseId, output] =
    process.argv.slice(2);
  check(
    process.argv.length === 7 && /^[a-f0-9]{64}$/u.test(expectedPinsSha256),
    "Usage: node preflight.mjs REA_ROOT PINS_JSON PINS_SHA CASE_ID NEW_PACK_PATH",
  );
  const pinsBytes = await readFile(pinsPath);
  check(sha256(pinsBytes) === expectedPinsSha256, "INPUT_PINS_SHA");
  const cases = parse(pinsBytes).cases.filter((c) => c.id === caseId);
  check(cases.length === 1, "CASE_UNIQUE");
  const result = qualify(
    cases[0],
    await readPinnedInputs(cases[0]),
    await loadProducer(reaRoot),
  );
  if (result.pack) {
    const bytes = JSON.stringify(result.pack, null, 2) + "\n";
    await writeFile(output, bytes, { flag: "wx", mode: 0o600 });
    result.pack_sha256 = sha256(bytes);
    delete result.pack;
  } else process.exitCode = 1;
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
