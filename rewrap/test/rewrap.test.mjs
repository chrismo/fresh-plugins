//     node --test rewrap/test/rewrap.test.mjs
//
// Node 24 strips the TypeScript types on import.

import test from "node:test";
import assert from "node:assert/strict";

import { lineStarts, lineAt, selectedLines, rewrapLines, reflow } from "../lib/rewrap.ts";

const bytes = (s) => Buffer.byteLength(s, "utf8");
const long = (word, n) => Array(n).fill(word).join(" ");

test("lineStarts counts UTF-8 bytes, not UTF-16 units", () => {
  assert.deepEqual(lineStarts(["a—b", "c"], bytes), [0, 6]);
});

test("lineAt maps a byte offset to its line", () => {
  const starts = [0, 4, 8];
  assert.equal(lineAt(starts, 0), 0);
  assert.equal(lineAt(starts, 3), 0);
  assert.equal(lineAt(starts, 4), 1);
  assert.equal(lineAt(starts, 100), 2);
});

test("a selection ending exactly on a line start does not include that line", () => {
  const starts = [0, 4, 8, 12];
  assert.deepEqual(selectedLines(starts, 2, 8), [0, 1]);
});

test("a selection catching the first char of a line includes it", () => {
  const starts = [0, 4, 8, 12];
  assert.deepEqual(selectedLines(starts, 2, 9), [0, 2]);
});

test("a backwards selection is normalized", () => {
  const starts = [0, 4, 8, 12];
  assert.deepEqual(selectedLines(starts, 9, 2), [0, 2]);
});

test("every paragraph the range touches is rewrapped, separators kept verbatim", () => {
  const lines = [
    "one two",
    "three",
    "",
    "four",
    "five",
    "  ",
    "",
    "six",
    "seven",
  ];
  // Range starts mid-p1 and catches only the first line of p3.
  const r = rewrapLines(lines, 1, 7, 80, { skipFencesAndTables: true });
  assert.equal(r.a, 0);
  assert.equal(r.b, 8);
  assert.equal(r.paragraphs, 3);
  assert.equal(r.wrapped, "one two three\n\nfour five\n  \n\nsix seven");
  assert.equal(r.original, lines.join("\n"));
});

test("a range with blank-line endpoints trims inward instead of grabbing neighbors", () => {
  const lines = ["above", "", "mid", "dle", "", "below"];
  const r = rewrapLines(lines, 1, 4, 80, { skipFencesAndTables: true });
  assert.equal(r.a, 2);
  assert.equal(r.b, 3);
  assert.equal(r.wrapped, "mid dle");
});

test("a range of only blank lines has nothing to do", () => {
  assert.equal(rewrapLines(["a", "", "  ", "b"], 1, 2, 80, { skipFencesAndTables: true }), null);
});

test("long paragraphs are wrapped at the width", () => {
  const lines = [long("word", 20)];
  const r = rewrapLines(lines, 0, 0, 20, { skipFencesAndTables: true });
  for (const l of r.wrapped.split("\n")) assert.ok(l.length <= 20, l);
});

test("fenced code blocks pass through untouched, blank lines inside them included", () => {
  const lines = [
    "intro",
    "text",
    "",
    "```",
    "keep   this",
    "",
    "and this",
    "```",
    "",
    "outro",
    "text",
  ];
  const r = rewrapLines(lines, 0, 10, 80, { skipFencesAndTables: true });
  assert.equal(r.paragraphs, 2);
  assert.equal(
    r.wrapped,
    "intro text\n\n```\nkeep   this\n\nand this\n```\n\noutro text",
  );
});

test("tilde fences count as fences", () => {
  const lines = ["~~~", "a", "b", "~~~"];
  assert.equal(rewrapLines(lines, 0, 3, 80, { skipFencesAndTables: true }), null);
});

test("a range starting inside a fence does not expand into the fence's text", () => {
  const lines = ["```", "code", "more", "```", "", "after", "this"];
  const r = rewrapLines(lines, 2, 6, 80, { skipFencesAndTables: true });
  assert.equal(r.paragraphs, 1);
  assert.equal(r.wrapped.split("\n").slice(-1)[0], "after this");
  assert.ok(r.wrapped.startsWith("more\n```\n"), r.wrapped);
});

test("a paragraph run directly after a fence does not merge with it", () => {
  const lines = ["```", "code", "```", "para", "graph"];
  const r = rewrapLines(lines, 0, 4, 80, { skipFencesAndTables: true });
  assert.equal(r.wrapped, "```\ncode\n```\npara graph");
});

test("tables pass through untouched", () => {
  const lines = [
    "before",
    "it",
    "",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
    "",
    "after",
    "it",
  ];
  const r = rewrapLines(lines, 0, 8, 80, { skipFencesAndTables: true });
  assert.equal(r.paragraphs, 2);
  assert.equal(r.wrapped, "before it\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nafter it");
});

test("a range covering only a table has nothing to do", () => {
  const lines = ["| a | b |", "|---|---|"];
  assert.equal(rewrapLines(lines, 0, 1, 80, { skipFencesAndTables: true }), null);
});

test("without skipFencesAndTables a cursor in a fence still rewraps it, as before", () => {
  const lines = ["```", "a", "b", "```"];
  const r = rewrapLines(lines, 1, 1, 80, { skipFencesAndTables: false });
  assert.equal(r.a, 0);
  assert.equal(r.b, 3);
  assert.equal(r.wrapped, "``` a b ```");
});

test("an already-wrapped range comes back identical", () => {
  const lines = ["short", "", "also short"];
  const r = rewrapLines(lines, 0, 2, 80, { skipFencesAndTables: true });
  assert.equal(r.wrapped, r.original);
});

test("reflow hang-indents list items under their text", () => {
  assert.equal(reflow("- " + long("ab", 10), 12), "- ab ab ab\n  ab ab ab\n  ab ab ab\n  ab");
});
