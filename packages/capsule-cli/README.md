# @capsule/cli

Reference CLI for the [Capsule](../../README.md) format. Installs a single `capsule` binary.

## Commands

```text
capsule make <folder|file|slug>    create or package a capsule with friendly defaults
capsule share <file.capsule>       make a self-opening .capsule.html that opens in any browser
capsule create <slug>              scaffold a new capsule project directory
capsule pack <dir> [-o <out>]      pack a directory into <dir>.capsule
capsule inspect <file>             print manifest, files, integrity status
capsule verify <file>              verify the declared content_hash
capsule run <file>                 open a capsule in the sandboxed runtime
capsule receipts [--limit N]       print recent runtime receipts
capsule help                       show usage

`inspect`, `verify`, `run`, and `share` accept both `.capsule` archives and
self-opening `.capsule.html` files. For a wrapper, the embedded archive is
extracted and checked with the CLI's own code.
```

Exit codes: `0` success, `1` error, `2` usage error.

## Flags

- `make --template <name>` — start from `blank`, `checklist`, or `calculator`
- `make --name <text>` — set the Open Screen display name
- `make --description <text>` — set the Open Screen description
- `make --html` — also write a self-opening `.capsule.html` next to the `.capsule`
- `make --no-pack` — create a template project without writing a `.capsule`
- `make --force` — overwrite existing output files
- `share -o <path>` — output path (default: `<name>.capsule.html`)
- `share --force` — overwrite an existing output file
- `pack -o <path>` — override output path (default: `<slug>.capsule`)
- `run --port <n>` — pin the runtime port (default: random free port)
- `run --headless` — start the server but don't open a browser

## Friendly Maker

Use `make` for the normal authoring path:

```bash
capsule make my-checklist --template checklist
capsule make ./site --name "Field Guide"
capsule make ./index.html --out field-guide.capsule
capsule make my-app.html --html        # single-file app, e.g. from an AI tool
```

If the path does not exist, `make` creates a project from a template and then
packages it. If the path is an existing folder with `capsule.json`, it packages
that project. If the folder has no manifest but does have `index.html`, it
generates a safe manifest and stores the web files under `content/` in the
archive. A single `.html` file becomes `content/index.html`.

Without `--name`, the display name comes from the page's `<title>`, falling
back to the file or folder name.

## Development

```bash
pnpm test      # vitest: create → pack → inspect → verify, make --html, share
pnpm typecheck
pnpm build
```

Bin entry: `bin/capsule.mjs`. Installed as `capsule` when this package is linked globally or via `pnpm link`.
