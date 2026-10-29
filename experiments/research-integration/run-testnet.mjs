import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { importVerifierSource } from "../../scripts/lib/verifier-source-loader.mjs";

const DEFAULT_SOURCE_COMMIT = "669e617eec5422ebce1ab271af0fc7b51e90dc11";
const root = fileURLToPath(new URL("../../", import.meta.url));
const sourcePaths = [
  "package.json",
  "package-lock.json",
  "scripts/lib/verifier-source-loader.mjs",
  "src/domain/evidence.ts",
  "src/domain/evidenceBundle.ts",
  "src/domain/canonicalDigest.ts",
  "src/domain/reconstructionCoverage.ts",
  "src/domain/reconstructionCoverageEvaluation.ts",
  "src/domain/reconstructionCoverageEvidence.ts",
  "src/domain/reconstructionCoverageScope.ts",
  "src/domain/reconstructionCoverageVerifierResults.ts",
  "src/domain/reconstructionCoverage.fixture.ts",
  "src/domain/residualUnknown.ts",
];
const authoredPaths = [
  "experiments/research-integration/CONTRACT.md",
  "experiments/research-integration/README.md",
  "experiments/research-integration/run-testnet.mjs",
];
const expectedScenarioIds = [
  "complete_synthetic_closure",
  "evidence_integrity_tampering",
  "stale_contract_owner_artifact",
  "stale_or_future_time",
  "active_unknown_not_ready",
  "omitted_relationship_coverage",
  "incomplete_inventory_not_ready",
  "command_success_vs_semantic_status",
  "canonical_vs_raw_hash_domains",
  "self_consistent_labels_not_replay_attestation",
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = (value) => JSON.stringify(value, null, 2) + "\n";
const git = (...arguments_) =>
  execFileSync("git", ["-C", root, ...arguments_], { encoding: "utf8" }).trim();
const options = { sourceCommit: DEFAULT_SOURCE_COMMIT };
let output;
let outputCreated = false;
const startedAt = new Date().toISOString();
const started = performance.now();
const scenarios = [];
const packets = [];
let sourceInputs = [];
let executionHead;
let fatal;

const nonPromotion = {
  inputs_are_synthetic: true,
  real_replay_authenticated: false,
  actual_cli_executed_by_this_driver: false,
  actual_mcp_executed_by_this_driver: false,
  native_provider_qualified: false,
  clean_install_proved: false,
  product_reconstruction_proved: false,
  independent_external_attestation: false,
  product_release_or_adoption_proved: false,
  causal_productivity_proved: false,
};

const scenario = async (id, body) => {
  assert(expectedScenarioIds.includes(id), "Uncontracted scenario");
  const before = performance.now();
  try {
    const observations = await body();
    scenarios.push({
      id,
      outcome: "pass",
      elapsed_ms: performance.now() - before,
      observations,
    });
  } catch (cause) {
    scenarios.push({
      id,
      outcome: "fail",
      elapsed_ms: performance.now() - before,
      error: sanitizeError(cause),
    });
  }
};

const savePacket = async (id, coverage, result) => {
  const entries = [];
  for (const [suffix, value] of [
    ["input", coverage],
    ["result", result],
  ]) {
    const path = `packets/${id}.${suffix}.synthetic.json`;
    const bytes = jsonBytes(value);
    await writeFile(join(output, path), bytes, { flag: "wx", mode: 0o600 });
    entries.push({ path, sha256_raw_bytes: sha256(bytes) });
  }
  packets.push({ id, synthetic: true, files: entries });
};

function sanitizeError(cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message
    .replaceAll(root, "<checkout>/")
    .replaceAll(output ?? "<unselected-output>", "<output>");
}

try {
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === "--output-dir") output = resolve(process.argv[++index]);
    else if (argument === "--source-commit")
      options.sourceCommit = process.argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  assert(output, "An explicit new --output-dir is required");
  assert.match(options.sourceCommit, /^[0-9a-f]{40}$/u);
  const selected = relative(root, output);
  assert(
    selected === ".." ||
      selected.startsWith(`..${sep}`) ||
      isAbsolute(selected),
    "Outputs must be outside the tracked checkout",
  );
  await mkdir(output, { mode: 0o700 });
  outputCreated = true;
  await mkdir(join(output, "packets"), { mode: 0o700 });
  executionHead = git("rev-parse", "HEAD");
  for (const path of [...sourcePaths, ...authoredPaths]) {
    const bytes = await readFile(join(root, path));
    const item = { path, hash_domain: "raw-file-bytes", sha256: sha256(bytes) };
    if (sourcePaths.includes(path)) {
      const original = execFileSync("git", [
        "-C",
        root,
        "show",
        `${options.sourceCommit}:${path}`,
      ]);
      assert.equal(
        item.sha256,
        sha256(original),
        `Source baseline mismatch: ${path}`,
      );
    }
    sourceInputs.push(item);
  }

  const [
    fixtureApi,
    coverageApi,
    evidenceApi,
    bundleApi,
    unknownApi,
    digestApi,
  ] = await Promise.all(
    [
      "reconstructionCoverage.fixture.ts",
      "reconstructionCoverage.ts",
      "evidence.ts",
      "evidenceBundle.ts",
      "residualUnknown.ts",
      "canonicalDigest.ts",
    ].map((name) =>
      importVerifierSource(`../../src/domain/${name}`, import.meta.url),
    ),
  );
  const {
    completeReconstructionCoverageData,
    RECONSTRUCTION_COVERAGE_NOW,
    reconstructionVerifierContractFixture,
  } = fixtureApi;
  const {
    readReconstructionCoverageData,
    evaluateParsedReconstructionClosure,
  } = coverageApi;
  const { createEvidence, parseEvidence } = evidenceApi;
  const { createEvidenceBundle } = bundleApi;
  const { recordUnknownInputSchema, createResidualUnknown } = unknownApi;
  const { digestCanonicalValue } = digestApi;
  const fresh = () => completeReconstructionCoverageData();
  const evaluateResult = (coverage) => {
    const parsed = readReconstructionCoverageData(coverage, ["coverage"]);
    if (!parsed.ok) throw parsed.error;
    return evaluateParsedReconstructionClosure(
      parsed.value,
      "replacement.cli",
      RECONSTRUCTION_COVERAGE_NOW,
    );
  };
  const evaluate = (coverage) => {
    const result = evaluateResult(coverage);
    assert.equal(result.ok, true, "Domain evaluation must complete");
    return result.value;
  };
  const reasonCodes = (result) => result.reasons.map(({ code }) => code);
  const expectNotReady = (coverage, reason) => {
    const result = evaluate(coverage);
    assert.notEqual(result.status, "ready");
    assert(reasonCodes(result).includes(reason), `Expected reason ${reason}`);
    return result;
  };

  await scenario("complete_synthetic_closure", async () => {
    const input = fresh();
    const result = evaluate(input);
    assert.equal(result.status, "ready");
    assert.deepEqual(result.reasons, []);
    await savePacket("01-complete", input, result);
    return { semantic_status: result.status, real_replay: false };
  });

  await scenario("evidence_integrity_tampering", () => {
    const original = fresh().evidence_bundle.records[0];
    assert(original);
    assert.deepEqual(
      parseEvidence(JSON.parse(JSON.stringify(original))),
      original,
    );
    assert.throws(
      () =>
        parseEvidence({ ...original, normalized_result: { changed: true } }),
      /semantic identifier/u,
    );
    return {
      intact_record_accepted: true,
      unrecomputed_tampering_rejected: true,
    };
  });

  await scenario("stale_contract_owner_artifact", () => {
    const cases = [];
    const contractInput = fresh();
    const { contract_sha256: _old, ...contract } =
      contractInput.verifier_contracts[0];
    contractInput.verifier_contracts[0] = reconstructionVerifierContractFixture(
      {
        ...contract,
        minimum_repeats: contract.minimum_repeats + 1,
      },
    );
    cases.push(["contract", contractInput]);
    const ownerInput = fresh();
    ownerInput.owners[0].ownership.owner_sha256 = "9".repeat(64);
    cases.push(["owner", ownerInput]);
    const artifactInput = fresh();
    artifactInput.artifacts[0].artifact_sha256 = "8".repeat(64);
    cases.push(["artifact", artifactInput]);
    return cases.map(([binding, input]) => {
      const result = expectNotReady(input, "verifier-result-incompatible");
      return {
        binding,
        semantic_status: result.status,
        reason_codes: reasonCodes(result),
      };
    });
  });

  await scenario("stale_or_future_time", () => {
    return ["2026-07-01T00:00:00.000Z", "2026-07-17T12:00:00.000Z"].map(
      (at) => {
        const input = fresh();
        input.verifier_results[0].observed_at = at;
        const result = expectNotReady(input, "verifier-result-stale");
        return { observed_at: at, semantic_status: result.status };
      },
    );
  });

  await scenario("active_unknown_not_ready", async () => {
    const input = fresh();
    const question = recordUnknownInputSchema.parse({
      question: "Synthetic unresolved recovery path",
      severity: "medium",
      domain: "research-integration",
      required_authority: null,
      required_confidence: "derived",
      required_environment: null,
      recommended_probes: [],
      relationships: [],
    });
    const mutation = createEvidence(
      undefined,
      { id: "synthetic-lab", name: "Synthetic lab fixture", version: "1" },
      {
        predicateType: "rea.residual-unknown-mutation",
        operation: "record_unknown",
        parameters: { domain: question.domain, severity: question.severity },
        result: {
          action: "record",
          question: question.question,
          required_authority: question.required_authority,
          required_confidence: question.required_confidence,
        },
      },
    );
    const unknown = createResidualUnknown(
      question,
      mutation.evidence_id,
      "1".repeat(64),
    );
    input.evidence_bundle = createEvidenceBundle(
      [...input.evidence_bundle.records, mutation],
      [unknown],
    );
    input.residual_unknown_ids = [unknown.unknown_id];
    const result = expectNotReady(input, "active-unknown");
    await savePacket("05-active-unknown", input, result);
    return {
      semantic_status: result.status,
      reason_codes: reasonCodes(result),
    };
  });

  await scenario("omitted_relationship_coverage", () => {
    const record = createEvidence(
      undefined,
      { id: "synthetic-lab", name: "Synthetic lab fixture", version: "1" },
      {
        operation: "procedure_callees",
        parameters: {},
        result: [],
      },
    );
    assert.equal(record.relationship_coverage, null);
    assert.deepEqual(parseEvidence(JSON.parse(JSON.stringify(record))), record);
    const malformed = JSON.parse(JSON.stringify(record));
    delete malformed.relationship_coverage;
    assert.throws(() => parseEvidence(malformed));
    return {
      producer_omission: "unknown/null",
      serialized_omission_rejected: true,
      empty_result_is_not_complete_call_coverage: true,
    };
  });

  await scenario("incomplete_inventory_not_ready", async () => {
    const input = fresh();
    assert(input.verifier_results.every(({ status }) => status === "pass"));
    input.boundaries[0].required_surface_ids.push("cli.missing");
    const result = expectNotReady(input, "surface-missing");
    assert.equal(result.status, "partial");
    await savePacket("07-missing-inventory", input, result);
    return {
      registered_verifiers_all_pass: true,
      semantic_status: result.status,
    };
  });

  await scenario("command_success_vs_semantic_status", async () => {
    const input = fresh();
    input.verifier_results[0].status = "unknown";
    const result = evaluateResult(input);
    assert.equal(result.ok, true);
    assert.equal(result.value.status, "unknown");
    assert.notEqual(result.value.status, "ready");
    await savePacket("08-domain-success-not-ready", input, result.value);
    return {
      domain_result_ok: result.ok,
      semantic_status: result.value.status,
      actual_cli_invoked: false,
      cli_parity_requires_external_receipt: true,
    };
  });

  await scenario("canonical_vs_raw_hash_domains", () => {
    const first = '{"b":2,"a":1}\n';
    const second = '{ "a": 1, "b": 2 }\r\n';
    const firstCanonical = digestCanonicalValue(JSON.parse(first));
    const secondCanonical = digestCanonicalValue(JSON.parse(second));
    assert.notEqual(sha256(first), sha256(second));
    assert.equal(firstCanonical, secondCanonical);
    assert.equal(firstCanonical, sha256('{"a":1,"b":2}'));
    assert.notEqual(firstCanonical, digestCanonicalValue({ a: 1, b: 3 }));
    assert.notEqual(digestCanonicalValue([1, 2]), digestCanonicalValue([2, 1]));
    return {
      raw_hashes_differ: true,
      canonical_hashes_equal: true,
      value_and_array_order_changes_detected: true,
      canonical_hash_is_not_raw_artifact_identity: true,
    };
  });

  await scenario("self_consistent_labels_not_replay_attestation", async () => {
    const outputs = [];
    for (const [authority, confidence, expected] of [
      ["analyst-inference", "inferred", "unknown"],
      ["controlled-replay", "observed", "ready"],
    ]) {
      const input = fresh();
      const record = createEvidence(
        undefined,
        { id: "synthetic-lab", name: "Synthetic lab fixture", version: "1" },
        {
          operation: "synthetic_assertion_only",
          parameters: {},
          result: { status: "pass", note: "No external replay was executed" },
          authority,
          confidence,
        },
      );
      assert.deepEqual(
        parseEvidence(JSON.parse(JSON.stringify(record))),
        record,
      );
      input.evidence_bundle = createEvidenceBundle([
        ...input.evidence_bundle.records,
        record,
      ]);
      input.verifier_results[0].evidence_ids = [record.evidence_id];
      const result = evaluate(input);
      assert.equal(result.status, expected);
      outputs.push({ authority, confidence, semantic_status: result.status });
      if (expected === "ready")
        await savePacket("10-self-consistent-synthetic-label", input, result);
    }
    return {
      controls: outputs,
      interpretation:
        "Policy compatibility, not authentication of factual execution",
      real_replay_executed_or_authenticated: false,
    };
  });

  assert.deepEqual(
    scenarios.map(({ id }) => id),
    expectedScenarioIds,
    "Every contracted scenario must execute exactly once",
  );
  assert(scenarios.length > 0, "Zero-scenario success is forbidden");
  for (const input of sourceInputs)
    assert.equal(
      sha256(await readFile(join(root, input.path))),
      input.sha256,
      `Declared input changed during run: ${input.path}`,
    );
} catch (cause) {
  fatal = sanitizeError(cause);
}

const failed = scenarios.filter(({ outcome }) => outcome !== "pass");
const succeeded =
  !fatal &&
  scenarios.length === expectedScenarioIds.length &&
  failed.length === 0;
const receipt = {
  kind: "bounded-synthetic-research-testnet",
  started_at: startedAt,
  completed_at: new Date().toISOString(),
  elapsed_ms: performance.now() - started,
  source_commit: options.sourceCommit,
  execution_head: executionHead ?? null,
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  command: [
    "node",
    "experiments/research-integration/run-testnet.mjs",
    "--source-commit",
    options.sourceCommit,
    "--output-dir",
    "<new-owned-output>",
  ],
  command_sanitization:
    "Only the output directory is replaced with a placeholder; the effective source revision is retained.",
  source_input_scope:
    "Declared production/fixture/loader/package inputs, not a complete transitive dependency attestation",
  inputs: sourceInputs,
  scenario_counts: {
    expected: expectedScenarioIds.length,
    executed: scenarios.length,
    passed: scenarios.length - failed.length,
    failed: failed.length,
  },
  success: succeeded,
  fatal_error: fatal ?? null,
  scenarios,
  packet_count: packets.length,
  non_promotion: nonPromotion,
};
if (outputCreated) {
  await writeFile(
    join(output, "packet-index.json"),
    jsonBytes({
      source_commit: options.sourceCommit,
      non_promotion: nonPromotion,
      packets,
    }),
    { flag: "wx", mode: 0o600 },
  );
  await writeFile(join(output, "receipt.json"), jsonBytes(receipt), {
    flag: "wx",
    mode: 0o600,
  });
}
console.log(
  JSON.stringify({
    success: succeeded,
    scenario_counts: receipt.scenario_counts,
    fatal_error: receipt.fatal_error,
    non_promotion: nonPromotion,
  }),
);
process.exitCode = succeeded ? 0 : 1;
