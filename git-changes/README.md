# git-changes

A docked pane listing the files git reports as changed, grouped the way a
commit is actually assembled.

```
Changes  7 file(s)
Conflicts (1)
  ! merge.rs        src/app
Staged (2)
  A  status.ts      git-changes/lib
  M  README.md
Unstaged (3)
  M  main.rs        src
  D  old.rs         src
  R  after.txt      ← before.txt
Untracked (1)
  ?  scratch.md
                    Enter open  r refresh  q close
```

## Why, when fresh already ships `git_explorer`

The bundled `git_explorer` badges entries **in place** in the file tree. That
answers "what happened to this file" when you're already looking at it. It
can't answer "what have I touched", because the changed files are scattered
across a tree that's mostly unchanged.

This is the second question: one list, only the changed files, grouped by
whether they're staged. The two coexist — different namespaces, different
config keys, no overlap.

## Install

```
https://github.com/chrismo/fresh-plugins#git-changes
```

In fresh: command palette → **`Package: Install from URL`**.

## Use

| Command                     | Does                                    |
|-----------------------------|-----------------------------------------|
| `Git Changes: Toggle Dock`  | Open the dock, or close it if it's open |
| `Git Changes: Refresh`      | Re-run `git status` (opens the dock first if closed) |

### Binding a key

**Installing this does not give you a keybinding** — fresh has no mechanism for
a plugin to ship one. A plugin contributes a *command*; the key is always the
user's.

Add it to the `keybindings` array in `~/.config/fresh/config.json`, binding the
**handler** name as the action string (any unrecognized action becomes
`PluginAction(s)`, which dispatches the `registerHandler` name — not the
command label):

```json
{"key": "9", "modifiers": ["alt"],
 "action": "git_changes_toggle", "args": {}, "when": "normal"}
```

`alt+9` is where JetBrains puts its Version Control tool window, so it may
already be in your fingers. Any free chord works.

### Inside the dock

| Key            | Does                                        |
|----------------|---------------------------------------------|
| `↑` `↓` `j` `k`| Move the selection                          |
| `←` `→`        | Collapse / expand a section                 |
| `Enter`        | Open the file in the split you came from    |
| `r`            | Refresh                                     |
| `q` `Esc`      | Close the dock                              |

Selection alone doesn't open anything — arrowing down a long list would
otherwise drag the editor through every file you pass.

The dock refreshes itself on save, on revert, on file-explorer changes, and
when the window regains focus (so staging something in another terminal shows
up when you switch back).

## Settings

| Key                              | Default | Does                                          |
|----------------------------------|---------|-----------------------------------------------|
| `plugins.git-changes.dockRatio`  | `72`    | Percent of the window the *editor* keeps; the dock takes the rest |

## Grouping

Sections appear only when non-empty, in this order:

- **Conflicts** — the unmerged pairs (`UU`, `AA`, `DD`, `AU`, `UA`, `DU`, `UD`).
  These get their own section rather than being filed under staged: `UU` has a
  non-space index column, so the obvious "X isn't a space ⇒ staged" test would
  claim a conflicted file is ready to commit.
- **Staged** — index column set.
- **Unstaged** — worktree column set.
- **Untracked** — `??`.

A file can appear **twice** — `MM` means staged edits plus further unstaged
edits to the same path, and showing it once would hide half of what the next
commit captures.

Renames show as `after.txt ← before.txt`.

## Known limits

- **One repo.** The dock reads `git rev-parse --show-toplevel` from the
  editor's cwd and shows that repository. Nested sub-repos in a monorepo are
  not discovered — the bundled `git_explorer` does that via a helper in
  fresh's own `plugins/lib/`, which an installed package can't import (only
  relative imports inside the package are bundled).
- **Deleted files can't be opened.** `Enter` on one reports it instead of
  creating an empty buffer that looks like the file came back.
- **No staging from the dock.** It's a view, not a commit tool.

## Layout

```
git-changes.ts     everything that touches editor.*
lib/status.ts      porcelain parsing + grouping, pure
test/status.test.mjs
```

The split is what makes any of it testable — there's no harness for driving
fresh headlessly, so the pure half runs under node:

```sh
node --test git-changes/test/status.test.mjs
```

`lib/status.ts` parses `git status --porcelain -z`. The `-z` matters twice:
it's what stops git C-quoting paths containing spaces or non-ASCII, and it
makes a rename **two** NUL-separated fields (`R  new\0old\0`) with no ` -> `
separator. Reading that as one field is the classic `-z` bug — you get a path
with a NUL in it and silently lose the entry that follows. There's a test
pinning it.

## Tested

`lib/status.ts` has 14 passing node tests covering the `-z` rename/copy
two-field form, paths with spaces, ignored entries, the `MM` double-listing,
unmerged-vs-staged, section ordering, and sorting.

The dock itself — the split, the tree widget, the key routing — has **not**
been exercised in a running editor yet. `fresh --cmd script check` passes, but
that only proves the file parses: it reports `ok` for a file importing a module
that doesn't exist, so it says nothing about whether the package bundles or
behaves.

What the runtime behaviour rests on instead is fresh's own source: the dock is
the `role: "utility_dock"` + `mountWidgetPanel` pattern that bundled
`code-tour` and `search_replace` use, and the `import type` / `export type`
split across a package-local `lib/` is what bundled `panel-manager.ts` and
`types.ts` already ship. Reasoned from the code, not observed.
