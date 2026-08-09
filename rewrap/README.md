# rewrap

Hard-wraps the paragraph under the cursor to 80 columns. No selection, no
prompt.

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

It preserves leading indentation and hang-indents continuation lines under list
markers — `-`, `*`, `+`, `1.`, `1)`, `>`. Headings (`#`) are deliberately not
treated as markers, being single-line by nature. An already-wrapped paragraph
is collapsed and re-wrapped rather than having its existing breaks respected.

## Known issues

- **Undo takes two steps.** The first undo leaves the paragraph deleted; the
  second restores the original. The plugin API has no atomic replace and no
  undo grouping — no `beginEdit`/`endEdit`, and `executeActions` sequences
  built-in actions rather than wrapping arbitrary edits — so the
  `deleteRange` + `insertText` pair lands as two entries.
- **Width is hardcoded** at 80 (`REWRAP_WIDTH` in `rewrap.ts`). It does not
  read `editor.page_width`.
- **No keybinding.** Binding a plugin command from `config.json` needs the
  `plugin_action` action, whose `args` shape isn't documented and is used by no
  keymap in the fresh binary; `{"name": "..."}` was a guess and did not work.
  The Keybinding Editor can bind it interactively.

## Tested

The reflow logic is exercised against plain, bulleted, em-dashed,
already-wrapped and indented paragraphs. The em-dash case matters: buffer
offsets are UTF-8 bytes while JS strings are UTF-16, so the line offsets are
built with `editor.utf8ByteLength()` — using `.length` would corrupt any
paragraph containing a multi-byte character.

The editor round trip has been exercised by hand, not automatically.
