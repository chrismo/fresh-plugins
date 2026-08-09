// rewrap — hard-wrap the paragraph under the cursor.
//
// fresh has soft `line_wrap` only. The built-in `shell_command_replace`
// (Alt+Shift+|) can pipe a selection through `fmt`, but it prompts for the
// command every time and needs the paragraph hand-selected first. This does it
// with no selection and no prompt.
//
// Registers: "Rewrap Paragraph"

const REWRAP_WIDTH = 80;

// A leading marker to keep on line 1 and hang-indent under on the rest:
// list bullets, ordered items, blockquotes. Deliberately NOT headings (`#`),
// which are single-line by nature.
const MARKER = /^(\s*)([-*+]\s+|\d+[.)]\s+|>\s+)?/;

function reflow(text: string, width: number): string {
  const first = MARKER.exec(text.split("\n")[0]) || ["", "", ""];
  const indent: string = first[1] || "";
  const marker: string = first[2] || "";
  // Continuation lines line up under the text, not under the marker.
  const hang = indent + " ".repeat(marker.length);

  // Strip each line's own leading whitespace/marker before re-joining, so an
  // already-wrapped paragraph collapses cleanly instead of keeping its breaks.
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

registerHandler("rewrap_paragraph", async function () {
  try {
    const id = editor.getActiveBufferId();
    const cursor = editor.getCursorPosition(); // byte offset
    const text = await editor.getBufferText(id);
    const lines = text.split("\n");

    // Byte offset of the start of each line. The editor speaks UTF-8 bytes and
    // JS strings are UTF-16, so `.length` is wrong here — one em-dash would
    // shift every offset after it and corrupt the buffer.
    const starts: number[] = new Array(lines.length);
    let at = 0;
    for (let i = 0; i < lines.length; i++) {
      starts[i] = at;
      at += editor.utf8ByteLength(lines[i]) + 1; // +1 for "\n"
    }

    let cur = 0;
    while (cur + 1 < lines.length && starts[cur + 1] <= cursor) cur++;

    if (lines[cur].trim() === "") {
      editor.setStatus("Rewrap: cursor is on a blank line");
      return;
    }

    // Expand to the blank-line-delimited paragraph.
    let a = cur;
    while (a > 0 && lines[a - 1].trim() !== "") a--;
    let b = cur;
    while (b + 1 < lines.length && lines[b + 1].trim() !== "") b++;

    const original = lines.slice(a, b + 1).join("\n");
    const wrapped = reflow(original, REWRAP_WIDTH);

    if (wrapped === original) {
      editor.setStatus("Rewrap: already wrapped");
      return;
    }

    const from = starts[a];
    const to = from + editor.utf8ByteLength(original);

    // No atomic replace exists in the plugin API, so this is delete-then-insert
    // and therefore two undo entries. The first undo shows the paragraph gone;
    // a second restores the original.
    editor.deleteRange(id, from, to);
    editor.insertText(id, from, wrapped);

    const n = wrapped.split("\n").length;
    editor.setStatus(
      "Rewrapped " + (b - a + 1) + " line(s) to " + n + " at width " + REWRAP_WIDTH,
    );
  } catch (e) {
    // An unhandled rejection takes down the whole plugin runtime, not just this
    // command, so every path has to land here.
    editor.setStatus("Rewrap failed: " + String(e));
  }
});

editor.registerCommand(
  "Rewrap Paragraph",
  "Hard-wrap the paragraph under the cursor to " + REWRAP_WIDTH + " columns",
  "rewrap_paragraph",
  null,
);
