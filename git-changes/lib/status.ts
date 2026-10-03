// Parsing and grouping for `git status --porcelain`.
//
// Deliberately free of any `editor.*` call, so `test/status.test.mjs` can run
// it under node. Everything that talks to fresh lives in `git-changes.ts`.

/** One path as git reports it, with its two status columns kept apart. */
export type Change = {
  /** Repo-relative, exactly as git emitted it. */
  path: string;
  /** The X column — what the index holds. `?` for untracked. */
  index: string;
  /** The Y column — what the worktree holds. `?` for untracked. */
  worktree: string;
  /** Where a rename or copy came from, else null. */
  origPath: string | null;
};

export const SECTION = {
  CONFLICTED: "conflicted",
  STAGED: "staged",
  UNSTAGED: "unstaged",
  UNTRACKED: "untracked",
} as const;

export type SectionId = (typeof SECTION)[keyof typeof SECTION];

export type Section = {
  id: SectionId;
  title: string;
  changes: Change[];
};

/** XY pairs that mean "unmerged", per `git status` docs. Both columns are
 * meaningful here and neither means staged, so these are pulled out before the
 * staged/unstaged split rather than after. */
const UNMERGED = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

function isUnmerged(c: Change): boolean {
  return UNMERGED.has(c.index + c.worktree);
}

/**
 * Parse the output of `git status --porcelain -z`.
 *
 * The `-z` form is what we ask for: NUL-separated, and paths emitted raw
 * instead of C-quoted, so nothing here has to unescape. Two subtleties it
 * brings:
 *
 * - A rename or copy is **two** fields — `R  new\0old\0`. The second is not an
 *   entry of its own and has to be consumed by the first, which is why this is
 *   an index loop and not a `.map()`.
 * - There is no ` -> ` separator like the newline form has. Splitting on it
 *   finds nothing.
 *
 * Newline-separated input is accepted as a fallback so a caller that forgets
 * `-z` degrades to slightly-wrong paths rather than one enormous bogus entry.
 */
export function parsePorcelain(output: string): Change[] {
  const separator = output.includes("\0") ? "\0" : "\n";
  const fields = output
    .split(separator)
    .map((f) => f.replace(/\r$/, ""))
    .filter((f) => f.length > 0);

  const changes: Change[] = [];

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    // "XY path" — two status columns, a space, then at least one path char.
    if (field.length < 4) continue;

    const index = field[0];
    const worktree = field[1];

    // `!!` is an ignored file, only ever present with --ignored. Nothing to
    // show — an ignored file is not a change.
    if (index === "!" && worktree === "!") continue;

    let path = field.slice(3);
    let origPath: string | null = null;

    if (index === "R" || index === "C" || worktree === "R" || worktree === "C") {
      // The source path is the next field. Consume it so the loop doesn't
      // read it as an entry in its own right.
      if (i + 1 < fields.length) {
        origPath = fields[++i];
      }
    } else if (separator === "\n") {
      // Only the newline form uses this spelling; with -z the fields are
      // already split, so this would corrupt a path legitimately containing
      // " -> ".
      const arrow = path.indexOf(" -> ");
      if (arrow !== -1) {
        origPath = path.slice(0, arrow);
        path = path.slice(arrow + 4);
      }
    }

    changes.push({ path, index, worktree, origPath });
  }

  return changes;
}

/**
 * Split changes into the sections the dock renders, in display order.
 *
 * A file can land in two sections: `MM` is staged edits *plus* further
 * unstaged edits to the same path, and collapsing that to one row would hide
 * half of what a commit is about to capture. Unmerged paths are the exception
 * — they go to conflicts alone, because `UU` has a non-space index column and
 * would otherwise read as "staged and ready".
 *
 * Empty sections are dropped rather than rendered as empty headers.
 */
export function groupChanges(changes: Change[]): Section[] {
  const conflicted: Change[] = [];
  const staged: Change[] = [];
  const unstaged: Change[] = [];
  const untracked: Change[] = [];

  for (const c of changes) {
    if (isUnmerged(c)) {
      conflicted.push(c);
      continue;
    }
    if (c.index === "?" || c.worktree === "?") {
      untracked.push(c);
      continue;
    }
    if (c.index !== " ") staged.push(c);
    if (c.worktree !== " ") unstaged.push(c);
  }

  const byPath = (a: Change, b: Change) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

  return [
    { id: SECTION.CONFLICTED, title: "Conflicts", changes: conflicted.sort(byPath) },
    { id: SECTION.STAGED, title: "Staged", changes: staged.sort(byPath) },
    { id: SECTION.UNSTAGED, title: "Unstaged", changes: unstaged.sort(byPath) },
    { id: SECTION.UNTRACKED, title: "Untracked", changes: untracked.sort(byPath) },
  ].filter((s) => s.changes.length > 0);
}

/**
 * The single letter shown against a file, and which column it came from.
 *
 * Sections already say staged vs unstaged, so the badge only has to name the
 * kind of change. Within a section the relevant column is unambiguous: the
 * staged section reads X, everything else reads Y.
 */
export function badgeFor(change: Change, section: SectionId): string {
  if (section === SECTION.UNTRACKED) return "?";
  if (section === SECTION.CONFLICTED) return "!";
  const code = section === SECTION.STAGED ? change.index : change.worktree;
  return code === " " ? "M" : code;
}
