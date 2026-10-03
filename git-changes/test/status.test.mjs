// Pure-logic tests for the porcelain parser and grouping.
//
// There is no harness for driving fresh headlessly, so the rule this repo
// follows is to keep everything that isn't an `editor.*` call in plain
// functions and exercise those with node. `lib/status.ts` is that half of the
// plugin; `git-changes.ts` is the half that can only be tested by hand.
//
//     node --test git-changes/test/
//
// Node strips the TypeScript types on import (24.x, no flag needed).

import test from "node:test";
import assert from "node:assert/strict";

import { parsePorcelain, groupChanges, SECTION } from "../lib/status.ts";

// `git status --porcelain -z` separates entries with NUL, not newline, and
// does NOT quote paths — that's the whole reason for -z. Build fixtures the
// way git actually emits them.
const z = (...entries) => entries.map((e) => e + "\0").join("");

test("parses a worktree-modified entry", () => {
  const changes = parsePorcelain(z(" M src/main.rs"));
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], {
    path: "src/main.rs",
    index: " ",
    worktree: "M",
    origPath: null,
  });
});

test("parses a staged addition", () => {
  const changes = parsePorcelain(z("A  new.txt"));
  assert.deepEqual(changes[0], {
    path: "new.txt",
    index: "A",
    worktree: " ",
    origPath: null,
  });
});

test("a rename consumes the following NUL field as the original path", () => {
  // With -z, `R  new\0old\0` — two fields, no " -> ". Reading it as one field
  // is the classic -z bug: you get a path with a NUL in it and lose the entry
  // that follows.
  const changes = parsePorcelain(z("R  after.txt", "before.txt", " M other.txt"));
  assert.equal(changes.length, 2, "the old-path field must not parse as its own entry");
  assert.deepEqual(changes[0], {
    path: "after.txt",
    index: "R",
    worktree: " ",
    origPath: "before.txt",
  });
  assert.equal(changes[1].path, "other.txt");
});

test("a copy consumes its source field the same way", () => {
  const changes = parsePorcelain(z("C  copy.txt", "source.txt"));
  assert.equal(changes.length, 1);
  assert.equal(changes[0].origPath, "source.txt");
});

test("parses untracked and skips ignored", () => {
  const changes = parsePorcelain(z("?? scratch.md", "!! target/"));
  assert.equal(changes.length, 1);
  assert.equal(changes[0].path, "scratch.md");
  assert.equal(changes[0].index, "?");
});

test("paths containing spaces survive intact", () => {
  const changes = parsePorcelain(z(" M dir/a file with spaces.txt"));
  assert.equal(changes[0].path, "dir/a file with spaces.txt");
});

test("empty output yields no changes", () => {
  assert.deepEqual(parsePorcelain(""), []);
  assert.deepEqual(parsePorcelain("\0"), []);
});

test("accepts newline-separated output as a fallback", () => {
  // Belt on the parser, not the caller: if -z is ever dropped or a future git
  // changes the separator, entries should still land rather than parse as one
  // giant path.
  const changes = parsePorcelain(" M a.txt\n?? b.txt\n");
  assert.equal(changes.length, 2);
  assert.equal(changes[1].path, "b.txt");
});

test("groups staged, unstaged and untracked into separate sections", () => {
  const sections = groupChanges(parsePorcelain(z("A  staged.txt", " M dirty.txt", "?? new.txt")));
  const byId = Object.fromEntries(sections.map((s) => [s.id, s]));

  assert.deepEqual(byId[SECTION.STAGED].changes.map((c) => c.path), ["staged.txt"]);
  assert.deepEqual(byId[SECTION.UNSTAGED].changes.map((c) => c.path), ["dirty.txt"]);
  assert.deepEqual(byId[SECTION.UNTRACKED].changes.map((c) => c.path), ["new.txt"]);
});

test("an MM file appears in both staged and unstaged", () => {
  // Staged edits plus further unstaged edits to the same file. Showing it once
  // would hide half of what's about to be committed.
  const sections = groupChanges(parsePorcelain(z("MM both.txt")));
  const byId = Object.fromEntries(sections.map((s) => [s.id, s]));

  assert.deepEqual(byId[SECTION.STAGED].changes.map((c) => c.path), ["both.txt"]);
  assert.deepEqual(byId[SECTION.UNSTAGED].changes.map((c) => c.path), ["both.txt"]);
});

test("unmerged entries go to conflicts only, never staged or unstaged", () => {
  // UU/AA/DD etc. read as "both sides touched it". Filing UU under staged
  // (X = U is not a space) would claim a conflicted file is ready to commit.
  const sections = groupChanges(parsePorcelain(z("UU clash.txt", "AA added-both.txt", "DU gone.txt")));
  const byId = Object.fromEntries(sections.map((s) => [s.id, s]));

  assert.deepEqual(
    byId[SECTION.CONFLICTED].changes.map((c) => c.path),
    ["added-both.txt", "clash.txt", "gone.txt"], // sorted, like every section
  );
  assert.equal(byId[SECTION.STAGED], undefined);
  assert.equal(byId[SECTION.UNSTAGED], undefined);
});

test("empty sections are dropped, and order is conflicts, staged, unstaged, untracked", () => {
  const sections = groupChanges(
    parsePorcelain(z("?? new.txt", " M dirty.txt", "UU clash.txt", "A  staged.txt")),
  );
  assert.deepEqual(sections.map((s) => s.id), [
    SECTION.CONFLICTED,
    SECTION.STAGED,
    SECTION.UNSTAGED,
    SECTION.UNTRACKED,
  ]);
});

test("no changes means no sections", () => {
  assert.deepEqual(groupChanges([]), []);
});

test("files are sorted by path within a section", () => {
  const sections = groupChanges(parsePorcelain(z(" M z.txt", " M a.txt", " M m.txt")));
  assert.deepEqual(sections[0].changes.map((c) => c.path), ["a.txt", "m.txt", "z.txt"]);
});
