# fresh-plugins

Plugins for the [fresh](https://getfresh.dev/) terminal editor.

A monorepo: each top-level directory is one installable package, selected at
install time by a URL fragment.

## Plugins

| Name                | Does                                          |
|---------------------|-----------------------------------------------|
| [rewrap](rewrap/)   | Hard-wrap the paragraph under the cursor      |

## Installing

In fresh, open the command palette and run **`Package: Install from URL`**:

```
https://github.com/chrismo/fresh-plugins#rewrap
```

The `#rewrap` fragment is the directory name. Without it fresh would try to
install the repo root, which isn't a package.

Installed packages land in `~/.config/fresh/plugins/packages/`.

Note the palette command is `Package: Install from URL` — the docs call it
`pkg: Install from URL`, which matches nothing in 0.4.7.

## Adding a plugin

```
mkdir my-thing
```

`my-thing/package.json` — the `name` must match the directory, since the
directory is what the `#fragment` selects:

```json
{
  "$schema": "https://fresh-editor.dev/schemas/package.schema.json",
  "name": "my-thing",
  "version": "0.1.0",
  "description": "…",
  "type": "plugin",
  "author": "chrismo",
  "license": "MIT",
  "repository": "https://github.com/chrismo/fresh-plugins",
  "keywords": ["…"],
  "fresh": { "min_version": "0.4.7", "entry": "my-thing.ts" }
}
```

`fresh --cmd init` scaffolds one interactively if you'd rather not hand-write
it. (`fresh --init` is deprecated. Careful: bare `fresh --cmd init` means
*scaffold a package*, while `fresh --cmd init check` / `init reload` act on
your personal `~/.config/fresh/init.ts`.)

Then validate:

```sh
./bin/check
```

It checks the required manifest fields, that `fresh.entry` exists, and that the
package name matches its directory. Non-zero exit on any problem.

## Writing plugin code

The runtime is **ES2020 in QuickJS** — no DOM, no Node, no npm imports. Types
live at `~/.config/fresh/types/fresh.d.ts` once fresh is installed.

Three things that will bite:

- **Handlers must be named**, not closures — the host invokes them by name
  across the realm boundary. Use the `registerHandler(name, fn)` global, then
  `editor.registerCommand(label, desc, handlerName, null)`.
- **An unhandled promise rejection kills the whole plugin runtime**, not just
  your command. Every async path needs its own `try/catch`.
- **Buffer offsets are UTF-8 bytes; JS strings are UTF-16.** Use
  `editor.utf8ByteLength()` to convert. Using `.length` corrupts any text
  containing multi-byte characters — one em-dash shifts every offset after it.

Most `editor.*` calls that ask the host something are async — `await` them.

### Testing

There's no harness for driving fresh headlessly. What works:

- Keep the pure logic (parsing, formatting) in plain functions and exercise
  them with `node` before wiring them to `editor.*`.
- `fresh --cmd init check` syntax-checks `~/.config/fresh/init.ts` from any
  shell. It does report real errors with line:col — but it also prints `ok`
  when the file doesn't exist, so `ok` alone proves nothing.
- For the round trip, symlink the entry into `~/.config/fresh/init.ts` and use
  the palette's `init: Reload init.ts`. `fresh --cmd init reload` needs
  `$FRESH_SESSION` and only works inside fresh's integrated terminal.
- `fresh --safe` skips `init.ts` and all plugins — the recovery hatch when a
  plugin wedges the editor.

## License

MIT
