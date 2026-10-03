// git-changes — a docked pane listing the files git considers changed.
//
// fresh's bundled `git_explorer` badges the file tree in place, which answers
// "what happened to this file" but not "what have I touched", the question a
// commit actually starts from. This is the second one: a JetBrains-style
// Changes dock, grouped into conflicts / staged / unstaged / untracked, with
// Enter jumping to the file.
//
// Registers: "Git Changes: Toggle Dock", "Git Changes: Refresh"
//
// Parsing and grouping live in `lib/status.ts` so they can be tested under
// node; everything here is the part that can only be exercised inside fresh.

import { badgeFor, groupChanges, parsePorcelain, SECTION } from "./lib/status.ts";
import type { Change, Section, SectionId } from "./lib/status.ts";

const editor = getEditor();

const MODE = "git-changes-dock";
const TAB_NAME = "*Git Changes*";
const TREE_KEY = "changes";

// Panel ids are plugin-local — the host keys panels by (plugin, id) — so one
// dock needs exactly one constant.
const PANEL_ID = 1;

// Theme keys, reused from the file explorer's git status palette so the dock
// and the bundled explorer badges agree on what "modified" looks like.
const COLOR = {
  added: "ui.file_status_added_fg",
  modified: "ui.file_status_modified_fg",
  deleted: "ui.file_status_deleted_fg",
  renamed: "ui.file_status_renamed_fg",
  untracked: "ui.file_status_untracked_fg",
  conflicted: "ui.file_status_conflicted_fg",
  dim: "ui.help_key_fg",
};

editor.defineConfigNumber("dockRatio", {
  default: 72,
  minimum: 30,
  maximum: 90,
  description:
    "Percentage of the window the editor keeps when the Git Changes dock opens (the dock takes the rest)",
});

// ============================================================================
// State
// ============================================================================

/** One rendered tree row, keyed so events resolve without depending on the
 * host's visible-index arithmetic. */
type Row =
  | { kind: "section"; key: string; id: SectionId }
  | { kind: "file"; key: string; id: SectionId; change: Change };

type Dock = {
  bufferId: number;
  splitId: number;
  /** Where focus was when the dock opened — files open back into this. */
  sourceSplitId: number;
  mounted: boolean;
  repoRoot: string;
  sections: Section[];
  rows: Row[];
  rowsByKey: Map<string, Row>;
  dockHeight: number;
  dockWidth: number;
  /** Set when the last refresh failed, so the panel can say why instead of
   * rendering a misleading empty list. */
  error: string | null;
};

let dock: Dock | null = null;

let refreshInFlight = false;
let refreshPending = false;

// ============================================================================
// Rendering
// ============================================================================

function colorFor(row: Row): string {
  if (row.kind === "section") return COLOR.dim;
  switch (row.id) {
    case SECTION.CONFLICTED:
      return COLOR.conflicted;
    case SECTION.UNTRACKED:
      return COLOR.untracked;
    default:
      break;
  }
  const badge = badgeFor(row.change, row.id);
  if (badge === "A") return COLOR.added;
  if (badge === "D") return COLOR.deleted;
  if (badge === "R" || badge === "C") return COLOR.renamed;
  return COLOR.modified;
}

/** Split a repo-relative path into the name and the directory shown after it,
 * the way a Changes list reads: `main.rs  src/app`. */
function splitPath(path: string): { name: string; dir: string } {
  const cut = path.lastIndexOf("/");
  if (cut === -1) return { name: path, dir: "" };
  return { name: path.slice(cut + 1), dir: path.slice(0, cut) };
}

function buildRows(sections: Section[]): Row[] {
  const rows: Row[] = [];
  for (const section of sections) {
    rows.push({ kind: "section", key: "sec:" + section.id, id: section.id });
    for (const change of section.changes) {
      // A path can appear under two sections (a staged edit with further
      // unstaged edits), so the section is part of the key, not just the path.
      rows.push({
        kind: "file",
        key: "file:" + section.id + ":" + change.path,
        id: section.id,
        change,
      });
    }
  }
  return rows;
}

function nodeFor(row: Row, sections: Section[]): unknown {
  if (row.kind === "section") {
    const section = sections.find((s) => s.id === row.id);
    const count = section ? section.changes.length : 0;
    return {
      text: {
        segments: [
          { text: (section ? section.title : row.id) + " " },
          { text: "(" + count + ")", style: { fg: COLOR.dim } },
        ],
      },
      depth: 0,
      hasChildren: count > 0,
    };
  }

  const { name, dir } = splitPath(row.change.path);
  const badge = badgeFor(row.change, row.id);
  const color = colorFor(row);

  const segments: Array<Record<string, unknown>> = [
    { text: badge + " ", style: { fg: color } },
    { text: name, style: { fg: color } },
  ];
  // A rename is only legible if you can see what it was called before.
  if (row.change.origPath) {
    segments.push({ text: "  ← " + row.change.origPath, style: { fg: COLOR.dim } });
  } else if (dir) {
    segments.push({ text: "  " + dir, style: { fg: COLOR.dim } });
  }

  return {
    // truncateToChars is render-only, so the full path stays in the model even
    // when the dock is narrow.
    text: { segments, truncateToChars: Math.max(8, dock ? dock.dockWidth - 2 : 40) },
    depth: 1,
    hasChildren: false,
  };
}

/** Rows the tree gets to draw into: the pane, minus the header line and the
 * hint bar. `listSplits()` reports a dock pane's height without accounting for
 * the tab bar, so this stays conservative rather than overrunning. */
function treeRows(d: Dock): number {
  return Math.max(3, d.dockHeight - 4);
}

function totalChanges(sections: Section[]): number {
  let n = 0;
  for (const s of sections) n += s.changes.length;
  return n;
}

function buildSpec(d: Dock): unknown {
  const header = {
    kind: "raw",
    key: "header",
    entries: [
      {
        segments: [
          { text: "Changes" },
          {
            text: d.error ? "  " + d.error : "  " + totalChanges(d.sections) + " file(s)",
            style: { fg: COLOR.dim },
          },
        ],
      },
    ],
  };

  const body = d.rows.length > 0
    ? {
      kind: "tree",
      key: TREE_KEY,
      nodes: d.rows.map((r) => nodeFor(r, d.sections)),
      itemKeys: d.rows.map((r) => r.key),
      selectedIndex: 0,
      visibleRows: treeRows(d),
      // Everything starts open: a dock that opens collapsed makes you press
      // Right three times to learn whether you have any changes at all.
      expandedKeys: d.rows.filter((r) => r.kind === "section").map((r) => r.key),
      checkable: false,
      itemHeight: 1,
      cardBorders: false,
    }
    : {
      kind: "raw",
      key: "empty",
      entries: [{ text: d.error ? "" : "  working tree clean", style: { fg: COLOR.dim } }],
    };

  return {
    kind: "col",
    children: [
      header,
      body,
      {
        kind: "hintBar",
        entries: [
          { keys: "Enter", label: "open" },
          { keys: "r", label: "refresh" },
          { keys: "q", label: "close" },
        ],
      },
    ],
  };
}

/** Pull the dock's live geometry off the split list. Returns true when it
 * changed, so a caller can skip a re-render that would draw the same thing. */
function syncDockSize(d: Dock): boolean {
  const snap = editor.listSplits().find((s) => s.splitId === d.splitId);
  if (!snap) return false;
  // Width from the text viewport (gutter excluded), height from the pane rect.
  const width = snap.viewport.width > 0 ? snap.viewport.width : snap.width;
  const height = snap.height > 0 ? snap.height : d.dockHeight;
  if (width === d.dockWidth && height === d.dockHeight) return false;
  d.dockWidth = Math.max(20, width);
  d.dockHeight = Math.max(6, height);
  return true;
}

function render(d: Dock): void {
  syncDockSize(d);
  const spec = buildSpec(d);
  if (!d.mounted) {
    d.mounted = true;
    editor.mountWidgetPanel(PANEL_ID, d.bufferId, spec);
  } else {
    editor.updateWidgetPanel(PANEL_ID, spec);
  }
}

// ============================================================================
// Git
// ============================================================================

async function loadChanges(d: Dock): Promise<void> {
  const cwd = editor.getCwd();
  const root = await editor.spawnProcess("git", ["rev-parse", "--show-toplevel"], cwd);
  if (root.exit_code !== 0 || !root.stdout.trim()) {
    d.repoRoot = "";
    d.sections = [];
    d.rows = [];
    d.rowsByKey = new Map();
    d.error = "not a git repository";
    return;
  }

  d.repoRoot = root.stdout.trim();
  // `-z` for NUL separation, which is also what stops git C-quoting paths that
  // contain spaces or non-ASCII. `lib/status.ts` depends on both.
  const status = await editor.spawnProcess("git", ["status", "--porcelain", "-z"], d.repoRoot);
  if (status.exit_code !== 0) {
    d.sections = [];
    d.rows = [];
    d.rowsByKey = new Map();
    d.error = "git status failed";
    return;
  }

  d.error = null;
  d.sections = groupChanges(parsePorcelain(status.stdout));
  d.rows = buildRows(d.sections);
  d.rowsByKey = new Map(d.rows.map((r) => [r.key, r]));
}

async function refresh(): Promise<void> {
  const d = dock;
  if (!d) return;
  if (refreshInFlight) {
    refreshPending = true;
    return;
  }
  refreshInFlight = true;
  try {
    await loadChanges(d);
    // The dock can be closed while the git subprocess is in flight.
    if (dock === d) render(d);
  } finally {
    refreshInFlight = false;
    if (refreshPending) {
      refreshPending = false;
      void refresh().catch((e) => editor.error("git-changes: " + String(e)));
    }
  }
}

// ============================================================================
// Open / close
// ============================================================================

async function openDock(): Promise<void> {
  if (dock) {
    editor.focusSplit(dock.splitId);
    return;
  }

  const sourceSplitId = editor.getActiveSplitId();

  const cfg = (editor.getPluginConfig() ?? {}) as { dockRatio?: number };
  // `ratio` is the *first* child's share — the editor content. The dock takes
  // what's left, so 0.72 gives it ~28%.
  const ratio = Math.min(0.9, Math.max(0.3, (cfg.dockRatio ?? 72) / 100));

  const result = await editor.createVirtualBufferInSplit({
    name: TAB_NAME,
    mode: MODE,
    readOnly: true,
    entries: [],
    ratio,
    role: "utility_dock",
    showLineNumbers: false,
    showCursors: false,
    editingDisabled: true,
    // The tree owns its scroll window; a buffer scrollbar on top of it would
    // let a drag push the header and hint bar off-screen.
    scrollable: false,
  });

  dock = {
    bufferId: result.bufferId,
    splitId: result.splitId ?? editor.getActiveSplitId(),
    sourceSplitId,
    mounted: false,
    repoRoot: "",
    sections: [],
    rows: [],
    rowsByKey: new Map(),
    dockHeight: 24,
    dockWidth: 40,
    error: null,
  };

  render(dock);
  await refresh();
}

function closeDock(): void {
  const d = dock;
  if (!d) return;
  // Drop the reference first: closing the split fires `buffer_closed`, which
  // would otherwise re-enter this and close the split a second time.
  dock = null;
  if (d.mounted) editor.unmountWidgetPanel(PANEL_ID);
  editor.closeSplit(d.splitId);
  editor.focusSplit(d.sourceSplitId);
}

function openRow(row: Row): void {
  const d = dock;
  if (!d || row.kind !== "file") return;

  // A deleted path has nothing to open; `openFile` would create an empty
  // buffer for it, which looks like the file came back.
  const badge = badgeFor(row.change, row.id);
  if (badge === "D") {
    editor.setStatus("git-changes: " + row.change.path + " is deleted");
    return;
  }

  const path = editor.pathJoin(d.repoRoot, row.change.path);
  editor.focusSplit(d.sourceSplitId);
  editor.openFile(path, null, null);
}

// ============================================================================
// Events
// ============================================================================

editor.on("widget_event", (args) => {
  const d = dock;
  if (!d || args.panel_id !== PANEL_ID) return;
  if (args.widget_key !== TREE_KEY) return;
  if (args.event_type !== "activate" && args.event_type !== "select") return;

  const payload = args.payload as { key?: string; index?: number } | undefined;

  // Resolve by key, not index. The host renders only un-collapsed nodes, so a
  // payload index counts visible rows while `d.rows` counts all of them — the
  // two agree until the first section is collapsed, and then silently don't.
  let row: Row | undefined;
  if (typeof payload?.key === "string") {
    row = d.rowsByKey.get(payload.key);
  } else if (typeof payload?.index === "number") {
    row = d.rows[payload.index];
  }
  if (!row) return;

  // Only Enter/click-activate opens; plain selection movement must not drag
  // the editor through every file you arrow past.
  if (args.event_type === "activate") openRow(row);
});

editor.on("buffer_closed", (data) => {
  const d = dock;
  if (!d || data.buffer_id !== d.bufferId) return;
  // Closed from the tab bar rather than through `closeDock`.
  dock = null;
  if (d.mounted) editor.unmountWidgetPanel(PANEL_ID);
});

editor.on("viewport_changed", (data) => {
  const d = dock;
  if (!d || data.buffer_id !== d.bufferId) return;
  if (syncDockSize(d)) render(d);
});

function refreshIfOpen(): void {
  if (!dock) return;
  refresh().catch((e) => editor.error("git-changes: " + String(e)));
}

editor.on("after_file_save", refreshIfOpen);
// A reverted buffer means the file changed on disk without a save — a
// `git checkout` in another terminal, say — so the list is stale.
editor.on("after_file_revert", refreshIfOpen);
editor.on("after_file_explorer_change", refreshIfOpen);
// Coming back from a terminal where the user just staged something.
editor.on("focus_gained", refreshIfOpen);

// ============================================================================
// Handlers
// ============================================================================

registerHandler("git_changes_toggle", async function () {
  try {
    if (dock) {
      closeDock();
    } else {
      await openDock();
    }
  } catch (e) {
    // An unhandled rejection takes down the whole plugin runtime, not just
    // this command, so every async path has to land here.
    editor.setStatus("git-changes: " + String(e));
  }
});

registerHandler("git_changes_refresh", async function () {
  try {
    if (!dock) {
      await openDock();
      return;
    }
    await refresh();
  } catch (e) {
    editor.setStatus("git-changes: " + String(e));
  }
});

registerHandler("git_changes_close", function () {
  closeDock();
});

/** Route a key to the focused widget. `key(...)` is smart dispatch — the host
 * picks the right action from the focused widget's kind, so Up/Down/Left/Right
 * and Enter all come through here. */
function sendKey(name: string): void {
  if (!dock) return;
  editor.widgetCommand(PANEL_ID, { kind: "key", key: name });
}

registerHandler("git_changes_up", function () {
  sendKey("Up");
});
registerHandler("git_changes_down", function () {
  sendKey("Down");
});
registerHandler("git_changes_left", function () {
  sendKey("Left");
});
registerHandler("git_changes_right", function () {
  sendKey("Right");
});
registerHandler("git_changes_enter", function () {
  sendKey("Return");
});
registerHandler("git_changes_page_up", function () {
  sendKey("PageUp");
});
registerHandler("git_changes_page_down", function () {
  sendKey("PageDown");
});
registerHandler("git_changes_home", function () {
  sendKey("Home");
});
registerHandler("git_changes_end", function () {
  sendKey("End");
});

// ============================================================================
// Mode + registration
// ============================================================================

const modeBindings: [string, string][] = [
  ["Up", "git_changes_up"],
  ["k", "git_changes_up"],
  ["Down", "git_changes_down"],
  ["j", "git_changes_down"],
  ["Left", "git_changes_left"],
  ["Right", "git_changes_right"],
  ["Return", "git_changes_enter"],
  ["PageUp", "git_changes_page_up"],
  ["PageDown", "git_changes_page_down"],
  ["Home", "git_changes_home"],
  ["End", "git_changes_end"],
  ["r", "git_changes_refresh"],
  ["q", "git_changes_close"],
  ["Escape", "git_changes_close"],
];
editor.defineMode(MODE, modeBindings, true, false);

editor.registerCommand(
  "Git Changes: Toggle Dock",
  "Show or hide a dock listing the files git reports as changed",
  "git_changes_toggle",
  null,
);

editor.registerCommand(
  "Git Changes: Refresh",
  "Re-run git status and redraw the Git Changes dock",
  "git_changes_refresh",
  null,
);
