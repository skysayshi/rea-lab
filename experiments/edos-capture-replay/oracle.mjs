// Independent file-state oracle: never imports EdOS or calls its HTTP/read API.
// Expected user content comes from the predeclared synthetic input contract.
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const [runArgument, sequenceArgument] = process.argv.slice(2);
const checks = [];
const facts = {};
function check(condition, name) {
  checks.push({ name, pass: Boolean(condition) });
  if (!condition) throw new Error(name);
}
try {
  check(
    Boolean(runArgument) &&
      ["0", "1"].includes(sequenceArgument) &&
      process.argv.length === 4,
    "valid explicit oracle invocation",
  );
  const sequence = Number(sequenceArgument);
  const root = await realpath(resolve(runArgument));
  const fixtureBytes = await readFile(
    new URL("./fixture.json", import.meta.url),
  );
  const fixture = JSON.parse(fixtureBytes);
  facts.fixture_sha256 = sha256(fixtureBytes);
  const configBytes = await readFile(join(root, "config.json"));
  const config = JSON.parse(configBytes);
  facts.config_sha256 = sha256(configBytes);
  check(
    config.id === fixture.scene_id &&
      config.root === join(root, "sources") &&
      config.file === "scene.txt",
    "config binds only the isolated scene source",
  );
  check(
    JSON.stringify(config.sections) ===
      JSON.stringify([
        {
          id: fixture.section_id,
          heading: fixture.heading,
          sources: [fixture.reference.id],
        },
      ]),
    "config binds the declared section and reference",
  );
  check(
    JSON.stringify(config.documents) ===
      JSON.stringify([
        {
          id: fixture.reference.id,
          title: fixture.reference.title,
          file: "reference.txt",
        },
      ]),
    "config contains exactly the synthetic allowlisted reference",
  );
  const source = join(root, "sources", "scene.txt");
  const sourceStat = await lstat(source);
  check(
    sourceStat.isFile() && !sourceStat.isSymbolicLink(),
    "source is an ordinary file",
  );
  const sourceBytes = await readFile(source);
  facts.source_sha256 = sha256(sourceBytes);
  const expectedSourceSha256 = sha256(Buffer.from(fixture.scene_text));
  check(
    facts.source_sha256 === expectedSourceSha256,
    "source bytes remain exactly unchanged",
  );
  const referencePath = join(root, "sources", "reference.txt");
  const referenceStat = await lstat(referencePath);
  check(
    referenceStat.isFile() && !referenceStat.isSymbolicLink(),
    "reference is an ordinary file",
  );
  facts.reference_sha256 = sha256(await readFile(referencePath));
  check(
    facts.reference_sha256 === sha256(Buffer.from(fixture.reference.text)),
    "reference bytes remain exactly unchanged",
  );
  const directory = join(root, "data", "scene-candidates", fixture.scene_id);
  const directoryStat = await lstat(directory);
  check(
    directoryStat.isDirectory() && !directoryStat.isSymbolicLink(),
    "candidate directory is an ordinary directory",
  );
  const files = (await readdir(directory)).sort();
  facts.candidate_files = files;
  const expectedFiles = sequence === 0 ? [] : ["00000001.json"];
  check(
    JSON.stringify(files) === JSON.stringify(expectedFiles),
    "exact revision set with no pending or extra files",
  );
  if (sequence === 1) {
    const revisionPath = join(directory, "00000001.json");
    const revisionStat = await lstat(revisionPath);
    check(
      revisionStat.isFile() && !revisionStat.isSymbolicLink(),
      "revision is an ordinary file",
    );
    const revisionBytes = await readFile(revisionPath);
    facts.revision_sha256 = sha256(revisionBytes);
    const state = JSON.parse(revisionBytes);
    check(
      state.sequence === 1 &&
        Array.isArray(state.items) &&
        state.items.length === 1,
      "one committed candidate at sequence one",
    );
    const item = state.items[0];
    check(
      item.sectionId === fixture.section_id,
      "candidate belongs to the requested section",
    );
    check(
      item.title === fixture.candidate.title,
      "candidate title matches the independent input",
    );
    check(
      item.text === fixture.candidate.text,
      "candidate Unicode and newline bytes match the independent input",
    );
    check(
      item.status === "candidate",
      "candidate has not been promoted to source or canon",
    );
    check(
      item.baseRevision === expectedSourceSha256,
      "candidate is bound to the original source digest",
    );
    check(
      typeof item.id === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          item.id,
        ),
      "candidate has a UUID v4 identity",
    );
    check(
      typeof item.updatedAt === "string" &&
        Number.isFinite(Date.parse(item.updatedAt)),
      "candidate has a parseable update timestamp",
    );
    facts.sequence = state.sequence;
    // Keep generated id/time in raw revision evidence; do not assert equality across fresh runs.
  } else facts.sequence = 0;
  process.stdout.write(
    `${JSON.stringify({ status: "PASS", checks, facts }, null, 2)}\n`,
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ status: "FAIL", failure: error.message, checks, facts }, null, 2)}\n`,
  );
  process.exitCode = 1;
}
