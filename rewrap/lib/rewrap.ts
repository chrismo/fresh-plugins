// No `editor.*` calls here, so this half runs under node.

// Deliberately not headings (`#`), which are single-line by nature.
const MARKER = /^(\s*)([-*+]\s+|\d+[.)]\s+|>\s+)?/;

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

export type Rewrap = {
  a: number;
  b: number; // inclusive
  original: string;
  wrapped: string;
  paragraphs: number;
};

export function reflow(text: string, width: number): string {
  const first = MARKER.exec(text.split("\n")[0]) || ["", "", ""];
  const indent: string = first[1] || "";
  const marker: string = first[2] || "";
  const hang = indent + " ".repeat(marker.length);

  const words = text
    .split("\n")
    .map((l, i) => (i === 0 ? l.slice(indent.length + marker.length) : l.replace(MARKER, "")))
    .join(" ")
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (words.length === 0) return text;

  const out: string[] = [];
  let line = indent + marker + words[0];
  let bare = hang.length + words[0].length;

  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (bare + 1 + w.length <= width) {
      line += " " + w;
      bare += 1 + w.length;
    } else {
      out.push(line);
      line = hang + w;
      bare = hang.length + w.length;
    }
  }
  out.push(line);
  return out.join("\n");
}

// Editor offsets are UTF-8 bytes; using `.length` (UTF-16) corrupts the buffer
// after any multi-byte character.
export function lineStarts(lines: string[], byteLength: (s: string) => number): number[] {
  const starts: number[] = new Array(lines.length);
  let at = 0;
  for (let i = 0; i < lines.length; i++) {
    starts[i] = at;
    at += byteLength(lines[i]) + 1;
  }
  return starts;
}

export function lineAt(starts: number[], offset: number): number {
  let i = 0;
  while (i + 1 < starts.length && starts[i + 1] <= offset) i++;
  return i;
}

// `end` is exclusive: ending on a line's first byte doesn't include that line.
export function selectedLines(starts: number[], start: number, end: number): [number, number] {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return [lineAt(starts, lo), lineAt(starts, hi > lo ? hi - 1 : hi)];
}

function fenced(lines: string[]): boolean[] {
  const mask = new Array(lines.length).fill(false);
  let open: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE.exec(lines[i]);
    if (open === null) {
      if (m) {
        open = m[1];
        mask[i] = true;
      }
    } else {
      mask[i] = true;
      if (m && m[1][0] === open[0] && m[1].length >= open.length) open = null;
    }
  }
  return mask;
}

const isTableRow = (l: string) => l.trimStart().startsWith("|");

export function rewrapLines(
  lines: string[],
  first: number,
  last: number,
  width: number,
  opts: { skipFencesAndTables: boolean },
): Rewrap | null {
  const blank = (i: number) => lines[i].trim() === "";
  const fence = opts.skipFencesAndTables ? fenced(lines) : lines.map(() => false);
  const text = (i: number) => !blank(i) && !fence[i];

  while (first <= last && blank(first)) first++;
  while (last >= first && blank(last)) last--;
  if (first > last) return null;

  let a = first;
  if (text(a)) while (a > 0 && text(a - 1)) a--;
  let b = last;
  if (text(b)) while (b + 1 < lines.length && text(b + 1)) b++;

  const out: string[] = [];
  let paragraphs = 0;
  for (let i = a; i <= b; ) {
    if (!text(i)) {
      out.push(lines[i++]);
      continue;
    }
    let j = i;
    while (j + 1 <= b && text(j + 1)) j++;
    const run = lines.slice(i, j + 1);
    if (opts.skipFencesAndTables && run.some(isTableRow)) {
      out.push(...run);
    } else {
      out.push(reflow(run.join("\n"), width));
      paragraphs++;
    }
    i = j + 1;
  }

  if (paragraphs === 0) return null;
  return {
    a,
    b,
    original: lines.slice(a, b + 1).join("\n"),
    wrapped: out.join("\n"),
    paragraphs,
  };
}
