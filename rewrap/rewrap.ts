// rewrap — hard-wrap the paragraph under the cursor, or every paragraph a
// selection touches.

import { lineAt, lineStarts, rewrapLines, selectedLines } from "./lib/rewrap.ts";

const REWRAP_WIDTH = 80;

registerHandler("rewrap_paragraph", async function () {
  try {
    const id = editor.getActiveBufferId();
    const cursor = editor.getPrimaryCursor();
    if (!cursor) {
      editor.setStatus("Rewrap: no cursor");
      return;
    }
    const text = await editor.getBufferText(id);
    const lines = text.split("\n");
    const starts = lineStarts(lines, (s) => editor.utf8ByteLength(s));

    const sel = cursor.selection;
    const sweep = sel !== null && sel.start !== sel.end;

    let first: number, last: number;
    if (sweep) {
      [first, last] = selectedLines(starts, sel.start, sel.end);
    } else {
      first = last = lineAt(starts, cursor.position);
      if (lines[first].trim() === "") {
        editor.setStatus("Rewrap: cursor is on a blank line");
        return;
      }
    }

    const r = rewrapLines(lines, first, last, REWRAP_WIDTH, { skipFencesAndTables: sweep });
    if (!r) {
      editor.setStatus("Rewrap: nothing to wrap in the selection");
      return;
    }
    if (r.wrapped === r.original) {
      editor.setStatus("Rewrap: already wrapped");
      return;
    }

    const from = starts[r.a];
    const to = from + editor.utf8ByteLength(r.original);

    // No atomic replace in the plugin API, so undo takes two steps. Replacing
    // the whole sweep as one span keeps it at two.
    editor.deleteRange(id, from, to);
    editor.insertText(id, from, r.wrapped);

    if (sweep) {
      // Collapses the now-stale selection.
      editor.setBufferCursor(id, from + editor.utf8ByteLength(r.wrapped));
      editor.setStatus(
        "Rewrapped " + r.paragraphs + " paragraph(s) at width " + REWRAP_WIDTH,
      );
    } else {
      const n = r.wrapped.split("\n").length;
      editor.setStatus(
        "Rewrapped " + (r.b - r.a + 1) + " line(s) to " + n + " at width " + REWRAP_WIDTH,
      );
    }
  } catch (e) {
    // An unhandled rejection takes down the whole plugin runtime.
    editor.setStatus("Rewrap failed: " + String(e));
  }
});

editor.registerCommand(
  "Rewrap Paragraph",
  "Hard-wrap the paragraph under the cursor, or every paragraph in the selection, to " +
    REWRAP_WIDTH + " columns",
  "rewrap_paragraph",
  null,
);
