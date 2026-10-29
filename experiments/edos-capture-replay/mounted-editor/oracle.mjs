// Expected values come from the declared synthetic input, not the product,
// transport driver, response fixture or mounted component's internal state.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const conflict =
  "Варианты изменились в другом окне. Сохраните свой текст в файл и перечитайте список.";
const candidatePath = "/api/scene-workspace/candidates";

function canonicalTime(value, label) {
  assert.equal(typeof value, "string", label);
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u, label);
  const milliseconds = Date.parse(value);
  assert.ok(Number.isFinite(milliseconds), label);
  assert.equal(new Date(milliseconds).toISOString(), value, label);
  return milliseconds;
}

function observedTime(value, label) {
  if (typeof value === "string") return canonicalTime(value, label);
  assert.ok(Number.isSafeInteger(value) && value >= 0, label);
  return value;
}

function revisionStates(revisions, names, label) {
  assert.deepEqual(Object.keys(revisions).sort(), names, label);
  return names.map((name) => {
    const revision = revisions[name];
    assert.deepEqual(
      Object.keys(revision).sort(),
      ["body_text", "bytes", "sha256"],
      `${label}: ${name} evidence fields`,
    );
    assert.equal(typeof revision.body_text, "string", label);
    assert.equal(sha256(revision.body_text), revision.sha256, label);
    assert.equal(
      Buffer.byteLength(revision.body_text, "utf8"),
      revision.bytes,
      label,
    );
    return JSON.parse(revision.body_text);
  });
}

function editorSnapshot(value, readingKey, dirty, alertText = "") {
  return {
    title: value.title,
    text: value.text,
    reading_key: readingKey,
    status_state: dirty ? "dirty" : "saved",
    save_disabled: !dirty,
    alert_text: alertText,
  };
}

function assertHttp(posts, browserPosts) {
  assert.equal(posts.length, 3, "Exactly create, update and stale POSTs");
  assert.equal(browserPosts.length, 3, "Exactly three browser POSTs");
  const intervals = posts.map((post, ordinal) => {
    assert.equal(post.ordinal, ordinal);
    assert.equal(post.method, "POST");
    assert.equal(post.path, candidatePath);
    assert.equal(post.status, ordinal === 2 ? 409 : 200);
    assert.equal(post.origin_matches, true, "Real browser Origin matched");
    assert.equal(post.token_matches, true, "Real bootstrap token matched");
    assert.equal(post.content_type, "application/json");
    assert.equal(typeof post.body_text, "string");
    assert.deepEqual(JSON.parse(post.body_text), post.body);
    const received = observedTime(post.received_at, "POST received time");
    const finished = observedTime(post.finished_at, "POST finished time");
    assert.ok(received <= finished, "POST interval is ordered");
    assert.deepEqual(browserPosts[ordinal], {
      context: ordinal === 2 ? "B" : "A",
      method: "POST",
      path: candidatePath,
      body_text: post.body_text,
      status: post.status,
    });
    return { received, finished };
  });
  assert.ok(intervals[0].finished <= intervals[1].received);
  assert.ok(intervals[1].finished <= intervals[2].received);
  return intervals;
}

function assertRevisions(revisions, fixture, intervals) {
  const [createdState] = revisionStates(
    revisions.after_create,
    ["00000001.json"],
    "After create",
  );
  const [retainedFirstState, updatedState] = revisionStates(
    revisions.before_stale,
    ["00000001.json", "00000002.json"],
    "Before stale save",
  );
  revisionStates(
    revisions.after_stale,
    ["00000001.json", "00000002.json"],
    "After stale save",
  );
  assert.equal(createdState.items.length, 1, "One created candidate");
  assert.equal(updatedState.items.length, 1, "One updated candidate");
  const first = createdState.items[0];
  const second = updatedState.items[0];
  assert.match(first.id, uuid, "Server candidate ID is canonical UUIDv4");
  const firstTime = canonicalTime(first.updatedAt, "Create timestamp");
  const secondTime = canonicalTime(second.updatedAt, "Update timestamp");
  assert.ok(
    firstTime >= intervals[0].received && firstTime <= intervals[0].finished,
    "Create timestamp lies within the real request interval",
  );
  assert.ok(
    secondTime >= intervals[1].received && secondTime <= intervals[1].finished,
    "Update timestamp lies within the real request interval",
  );
  assert.ok(secondTime >= firstTime, "Update does not precede creation");
  const baseRevision = sha256(fixture.scene_text);
  const expectedItem = (value, updatedAt) => ({
    id: first.id,
    sectionId: fixture.section_id,
    baseRevision,
    title: value.title,
    text: value.text,
    updatedAt,
    status: "candidate",
  });
  const expectedCreated = {
    sequence: 1,
    items: [expectedItem(fixture.create, first.updatedAt)],
  };
  const expectedUpdated = {
    sequence: 2,
    items: [expectedItem(fixture.update, second.updatedAt)],
  };
  assert.deepEqual(createdState, expectedCreated);
  assert.deepEqual(retainedFirstState, expectedCreated);
  assert.deepEqual(updatedState, expectedUpdated);
  assert.deepEqual(
    revisions.before_stale["00000001.json"],
    revisions.after_create["00000001.json"],
    "First revision remains byte-identical after update",
  );
  assert.deepEqual(
    revisions.after_stale,
    revisions.before_stale,
    "Real 409 leaves every revision byte and filename unchanged",
  );
  return {
    first,
    baseRevision,
    expectedItem,
    expectedCreated,
    expectedUpdated,
  };
}

function assertPayloads(posts, fixture, expected) {
  const {
    first,
    baseRevision,
    expectedItem,
    expectedCreated,
    expectedUpdated,
  } = expected;
  const draftKey = posts[0].body.readingKey;
  assert.equal(typeof draftKey, "string");
  assert.ok(draftKey.startsWith("draft:"));
  assert.match(draftKey.slice("draft:".length), uuid, "Browser draft UUIDv4");
  const candidateKey = `candidate:${first.id}`;
  const expectedCreateRequest = {
    sectionId: fixture.section_id,
    title: fixture.create.title,
    text: fixture.create.text,
    baseRevision,
    dirty: true,
    expectedSequence: 0,
    readingKey: draftKey,
  };
  const expectedExistingRequest = (value) => ({
    ...expectedItem(value, first.updatedAt),
    dirty: true,
    expectedSequence: 1,
    readingKey: candidateKey,
  });
  assert.deepEqual(posts[0].body, expectedCreateRequest);
  assert.deepEqual(posts[1].body, expectedExistingRequest(fixture.update));
  assert.deepEqual(posts[2].body, expectedExistingRequest(fixture.stale));
  assert.deepEqual(posts[0].response_body, {
    ...expectedCreated,
    savedId: first.id,
  });
  assert.deepEqual(posts[1].response_body, {
    ...expectedUpdated,
    savedId: first.id,
  });
  assert.deepEqual(posts[2].response_body, { error: conflict });
  return candidateKey;
}

function assertDom(snapshots, fixture, candidateKey) {
  assert.deepEqual(Object.keys(snapshots).sort(), [
    "created",
    "stale_after",
    "stale_before",
    "updated",
  ]);
  assert.deepEqual(
    snapshots.created,
    editorSnapshot(fixture.create, candidateKey, false),
  );
  assert.deepEqual(
    snapshots.updated,
    editorSnapshot(fixture.update, candidateKey, false),
  );
  assert.deepEqual(
    snapshots.stale_before,
    editorSnapshot(fixture.stale, candidateKey, true),
  );
  assert.deepEqual(
    snapshots.stale_after,
    editorSnapshot(fixture.stale, candidateKey, true, conflict),
  );
}

function assertSources(sources, fixture) {
  const expectedSources = {
    scene_sha256: sha256(fixture.scene_text),
    reference_sha256: sha256(fixture.reference.text),
  };
  assert.deepEqual(sources.before, expectedSources);
  assert.deepEqual(sources.after, expectedSources);
}

export function assertMountedOutcome(record, fixture) {
  assert.equal(fixture.schema, "edos-mounted-editor-input-v1");
  const checks = [];
  const { posts, browser_posts: browserPosts, revisions, snapshots } = record;
  const intervals = assertHttp(posts, browserPosts);
  checks.push("real HTTP/browser POST agreement and authenticated boundaries");

  const expected = assertRevisions(revisions, fixture, intervals);
  checks.push(
    "independent persisted values, immutable history and no 409 write",
  );

  const candidateKey = assertPayloads(posts, fixture, expected);
  checks.push(
    "exact independent 7/10/10-field requests and 200/200/409 replies",
  );

  assertDom(snapshots, fixture, candidateKey);
  checks.push("mounted saved/dirty DOM states and stale draft preservation");

  assertSources(record.sources, fixture);
  checks.push("declared synthetic source bytes remain unchanged");

  return {
    status: "PASS_MOUNTED_EDITOR_HTTP_OUTCOME",
    checks,
    server_posts: 3,
    browser_posts: 3,
    request_body_field_counts: [7, 10, 10],
    response_statuses: [200, 200, 409],
    dom_snapshots: 4,
    immutable_revisions: 2,
    live_stale_negative_controls: 1,
  };
}
