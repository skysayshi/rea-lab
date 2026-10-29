// Expected product outcomes come from the independent, predeclared synthetic input.
// This module does not import the pack, target, extraction harness or React code.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function readOracle() {
  const bytes = await readFile(new URL("../fixture.json", import.meta.url));
  assert.equal(
    sha256(bytes),
    "eeeaad089f62f66b4b0964bd7e272d563e606921b07ef8cf8a46e85f94ad6236",
  );
  const fixture = JSON.parse(bytes);
  return {
    fixture_sha256: sha256(bytes),
    source: {
      id: fixture.reference.id,
      title: fixture.reference.title,
      file: "reference.txt",
      revision: sha256(fixture.reference.text),
      text: fixture.reference.text,
    },
    dirtyDraft: {
      expectedSequence: 0,
      baseRevision: sha256(fixture.scene_text),
      sectionId: fixture.section_id,
      title: fixture.candidate.title,
      text: fixture.candidate.text,
      dirty: true,
    },
  };
}

export function assertSourceInstalled(state, expected) {
  assert.deepEqual(
    state.source,
    expected,
    "source fields, Unicode and newline content are exact",
  );
  assert.equal(state.pane, "source");
  assert.equal(state.loading, false);
  assert.equal(state.error, "");
  assert.equal(state.sourceUpdates.length, 1, "only one source installation");
  assert.deepEqual(state.paneUpdates, ["source"]);
}

export function assertNoSourceInstalled(state) {
  assert.equal(
    state.source,
    null,
    "a refused or obsolete response must not install content",
  );
  assert.equal(
    state.pane,
    "links",
    "a refused or obsolete response must not change pane",
  );
  assert.deepEqual(state.sourceUpdates, []);
  assert.deepEqual(state.paneUpdates, []);
}

export function assertDirtyPreserved(state, draft) {
  assert.deepEqual(
    state.draftRef.current,
    draft,
    "every dirty editor field remains available",
  );
  assert.equal(state.draftRef.current.dirty, true);
  assert.equal(state.notice, "", "no saved-success announcement");
  assert.deepEqual(state.savedUpdates, [], "no saved-state installation");
  assert.deepEqual(
    state.editorUpdates,
    [],
    "no replacement editor installation",
  );
  assert.equal(state.rememberCount, 0, "no successful-save persistence effect");
  assert.match(
    state.error,
    /No unique response matches the exact recorded request/u,
  );
  assertNoSourceInstalled(state);
}
