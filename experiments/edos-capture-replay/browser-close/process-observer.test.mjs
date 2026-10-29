import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyKnownProcess,
  collectAlive,
  discoverOwned,
  parseProcessRows,
  signalTargets,
} from "./process-observer.mjs";

// Synthetic records model the observed owned-child S -> Z command transition.
const live = parseProcessRows(
  "86028 86022 86022 Thu Oct 29 03:52:43 2026 S /synthetic/python3 -\n",
)[0];
const zombie = parseProcessRows(
  "86028 86022 86022 Thu Oct 29 03:52:43 2026 Z <defunct>\n",
)[0];
const byPid = (rows) => new Map(rows.map((row) => [row.pid, row]));
const discover = (known, rows) =>
  discoverOwned({
    rows,
    byPid: byPid(rows),
    known,
    browserPid: live.pid,
    ownedRoot: "/synthetic/owned",
    childPid: 86022,
  });

await test("explicit stat parsing retains the command-changing terminal observation", () => {
  assert.equal(live.stat, "S");
  assert.equal(zombie.stat, "Z");
  assert.equal(zombie.command, "<defunct>");
  assert.equal(zombie.pid, live.pid);
  assert.equal(zombie.start, live.start);
  assert.notEqual(zombie.command_sha256, live.command_sha256);
});

await test("a previously known zombie stays counted, cannot be signalled and releases only on absence", () => {
  const known = byPid([live]),
    errors = [];
  assert.equal(classifyKnownProcess(live, zombie), "zombie");
  const counted = collectAlive(known, byPid([zombie]), errors);
  assert.equal(counted.length, 1);
  assert.equal(counted[0].stat, "Z");
  assert.equal(counted[0].pid, live.pid);
  assert.deepEqual(signalTargets(known, byPid([zombie]), errors), []);
  assert.deepEqual(errors, []);
  assert.equal(
    known.get(live.pid),
    live,
    "Original admitted identity stays unchanged",
  );
  assert.deepEqual(collectAlive(known, new Map(), errors), []);
  assert.equal(
    known.get(live.pid),
    live,
    "Absence does not erase ownership history",
  );
});

await test("zombie leaders and parents cannot authorize group, path or child discovery", () => {
  const known = byPid([live]);
  const child = { ...live, pid: 86100, ppid: live.pid, pgid: live.pid };
  const groupPeer = { ...live, pid: 86101, ppid: 1, pgid: live.pid };
  const pathPeer = {
    ...live,
    pid: 86102,
    ppid: 1,
    pgid: 1,
    command: "/synthetic/owned/run",
  };
  discover(known, [zombie, child, groupPeer, pathPeer]);
  assert.deepEqual([...known.keys()], [live.pid]);
  discover(known, [{ ...live, stat: "Z" }, child, groupPeer, pathPeer]);
  assert.deepEqual(
    [...known.keys()],
    [live.pid],
    "Even unchanged command hash gives a zombie no authority",
  );
});

await test("an unknown zombie cannot become newly owned through a live parent or group", () => {
  const known = byPid([live]);
  const stranger = { ...zombie, pid: 86100, ppid: live.pid, pgid: live.pid };
  discover(known, [live, stranger]);
  assert.equal(known.has(stranger.pid), false);
  assert.equal(classifyKnownProcess(undefined, stranger), "unowned");
});

await test("non-zombie command changes and different-start zombies remain identity errors", () => {
  for (const changed of [
    { ...zombie, stat: "S" },
    { ...zombie, start: "Thu Oct 29 03:52:44 2026" },
  ]) {
    const known = byPid([live]),
      errors = [],
      mismatches = [];
    assert.equal(classifyKnownProcess(live, changed), "mismatch");
    assert.deepEqual(
      collectAlive(known, byPid([changed]), errors, mismatches),
      [],
    );
    assert.match(errors[0], /Owned PID identity changed/u);
    assert.equal(mismatches.length, 1);
    assert.ok(Number.isFinite(mismatches[0].observed_at_ms));
    const expectedIdentity = (row) => ({
      pid: row.pid,
      ppid: row.ppid,
      pgid: row.pgid,
      start: row.start,
      stat: row.stat,
      command_sha256: row.command_sha256,
    });
    assert.deepEqual(mismatches[0].prior, expectedIdentity(live));
    assert.deepEqual(mismatches[0].current, expectedIdentity(changed));
    assert.equal(JSON.stringify(mismatches).includes(live.command), false);
    assert.equal(JSON.stringify(mismatches).includes(changed.command), false);
    const signalMismatches = [];
    assert.throws(
      () => signalTargets(known, byPid([changed]), [], signalMismatches),
      /Sampler uncertainty/u,
    );
    assert.equal(signalMismatches.length, 1);
    assert.equal(known.get(live.pid), live);
  }
});

await test("a known live process remains tracked after reparenting without weakening its identity", () => {
  const known = byPid([live]),
    errors = [];
  const reparented = { ...live, ppid: 1 };
  assert.equal(classifyKnownProcess(live, reparented), "live");
  assert.equal(collectAlive(known, byPid([reparented]), errors).length, 1);
  assert.deepEqual(signalTargets(known, byPid([reparented]), errors), [
    live.pid,
  ]);
  assert.deepEqual(errors, []);
});
