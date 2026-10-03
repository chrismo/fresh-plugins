# rewrap

Hard-wraps the paragraph under the cursor to 80 columns, or every paragraph a
selection touches. No prompt.

fresh has soft `line_wrap` only — nothing that inserts real newlines. The
built-in `shell_command_replace` (`Alt+Shift+|`) can pipe a selection through
`fmt -w 80`, but it prompts for the command every time and needs the paragraph
selected first, which is too much ceremony for a reflow.

## Install

```
https://github.com/chrismo/fresh-plugins#rewrap
```

via `Package: Install from URL` in the command palette.

## Use

Put the cursor anywhere in a paragraph and run **Rewrap Paragraph** from the
palette. The paragraph is whatever is delimited by blank lines.

With a selection, every paragraph the selection touches is rewrapped, as if the
cursor had been placed in each one in turn. Touching counts: a selection that
starts mid-paragraph or catches only the first character of the last one still
takes all of both. Blank lines between paragraphs are kept as they were.

A selection skips **fenced code blocks** (`` ``` `` or `~~~`) and **tables**
(lines starting with `|`), passing them through untouched. Dragging across one
is usually incidental; reflowing it would mangle it. Putting the cursor in one
with no selection is deliberate, so that still wraps it as before.

It preserves leading indentation and hang-indents continuation lines under list
markers — `-`, `*`, `+`, `1.`, `1)`, `>`. Headings (`#`) are deliberately not
treated as markers, being single-line by nature. An already-wrapped paragraph
is collapsed and re-wrapped rather than having its existing breaks respected.

### Binding a key

**Installing this does not give you a keybinding.** fresh has no mechanism for
a plugin to ship one: the package manifest has no keybindings field
(`contributes` carries only `languages` and `grammars`), and
`editor.registerCommand` takes no key. A plugin contributes a *command*; the
key is always the user's.

Add it to the `keybindings` array in `~/.config/fresh/config.json` yourself.
Bind the **handler** name as the action string — any unrecognized action
becomes `PluginAction(s)`, which dispatches the `registerHandler` name:

```json
{"key": "w", "modifiers": ["ctrl","alt","shift"],
 "action": "rewrap_paragraph", "args": {}, "when": "normal"}
```

That chord is the non-Cmd alternate the JetBrains **WrapToColumn** plugin
ships, so it may already be in your fingers. Any free chord works. Prefer a
multi-modifier one — plain `alt+<letter>` is scarce real estate in a terminal
keymap, and on macOS several of them never arrive intact.

## Known issues

- **Undo takes two steps.** The first undo leaves the text deleted; the
  second restores the original. A selection is replaced as one span, so it's
  still two steps however many paragraphs it covers. The plugin API has no atomic replace and no
  undo grouping — no `beginEdit`/`endEdit`, and `executeActions` sequences
  built-in actions rather than wrapping arbitrary edits — so the
  `deleteRange` + `insertText` pair lands as two entries.
- **A heading with no blank line after it** joins the paragraph below when
  that paragraph is rewrapped — same as before selections existed, but a sweep
  makes it easier to hit.
- **The selection stretches after a sweep.** `setBufferCursor` moves the
  cursor to the end of the rewrapped text but keeps the selection's anchor,
  so the selection grows to match instead of clearing.
- **Multi-cursor** uses the primary cursor's selection only.
- **Width is hardcoded** at 80 (`REWRAP_WIDTH` in `rewrap.ts`). It does not
  read `editor.page_width`.
- ~~No keybinding.~~ **Solved.** Bind the *handler* name directly as the
  action string — fresh's `from_str` turns any unrecognized action into
  `PluginAction(s)`, which dispatches the `registerHandler` name (not the
  command label, and no `plugin_action` indirection):

  ```json
  {"key": "w", "modifiers": ["ctrl","alt","shift"], "action": "rewrap_paragraph", "when": "normal"}
  ```

## Layout

```
rewrap.ts             everything that touches editor.*
lib/rewrap.ts         reflow, line offsets, selection → paragraphs; pure
test/rewrap.test.mjs
```

```sh
node --test rewrap/test/rewrap.test.mjs
```

## Tested

`lib/rewrap.ts` has 18 node tests: the selection boundary rules (an end on a
line's first byte excludes that line, one byte past includes it), expanding
to paragraph bounds and trimming blank endpoints inward, blank separators kept
verbatim, fences (including blank lines inside them and a selection starting
inside one), tables, and UTF-8 line offsets. The em-dash case matters: buffer
offsets are UTF-8 bytes while JS strings are UTF-16, so `.length` would corrupt
any paragraph containing a multi-byte character.

Both paths have been exercised by hand in fresh 0.5.1, including a sweep
across many paragraphs of real prose: every touched paragraph rewrapped, none
outside the selection changed, and the `./lib/` import loads.
