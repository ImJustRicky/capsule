# Pocket Notes

A polished markdown notepad capsule. Built as a demo to show that real,
opinionated apps fit in a single `.capsule` file.

## What it shows

- **Live markdown preview.** Type on the left, see formatted output on the right.
- **`storage.local` capability.** Drafts persist between sessions, scoped to
  this capsule only — no other capsule can read them.
- **Zero network.** `network.default = "deny"` and `allow = []`. The Open
  Screen makes this contract visible before the app ever runs.
- **No dependencies.** The markdown renderer is ~100 lines of vanilla JS,
  written to be safe inside the strict CSP (no `eval`, no `innerHTML` of
  unescaped input).

## Files

```
capsule.json           manifest + capability declaration
content/index.html     entry point
content/style.css      dark theme + responsive split layout
content/app.js         editor wiring + tiny markdown renderer
source/README.md       this file
```

## Pack and run

From the repo root:

```bash
node packages/capsule-cli/bin/capsule.mjs pack examples/pocket-notes
node packages/capsule-cli/bin/capsule.mjs run pocket-notes.capsule
```
