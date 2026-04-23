# @capsule/cli

Reference CLI for the [Capsule](../../README.md) format. Installs a single `capsule` binary.

## Commands

```text
capsule make <folder|slug>         create or package a capsule with friendly defaults
capsule create <slug>              scaffold a new capsule project directory
capsule pack <dir> [-o <out>]      pack a directory into <dir>.capsule
capsule inspect <file.capsule>     print manifest, files, integrity status
capsule verify <file.capsule>      verify the declared content_hash
capsule run <file.capsule>         open a capsule in the sandboxed runtime
capsule help                       show usage
```

Exit codes: `0` success, `1` error, `2` usage error.

## Flags

- `make --template <name>` — start from `blank`, `checklist`, or `calculator`
- `make --name <text>` — set the Open Screen display name
- `make --description <text>` — set the Open Screen description
- `make --no-pack` — create a template project without writing a `.capsule`
- `make --force` — overwrite an existing output `.capsule`
- `pack -o <path>` — override output path (default: `<slug>.capsule`)
- `run --port <n>` — pin the runtime port (default: random free port)
- `run --headless` — start the server but don't open a browser

## Friendly Maker

Use `make` for the normal authoring path:

```bash
capsule make my-checklist --template checklist
capsule make ./site --name "Field Guide"
capsule make ./index.html --out field-guide.capsule
```

If the path does not exist, `make` creates a project from a template and then
packages it. If the path is an existing folder with `capsule.json`, it packages
that project. If the folder has no manifest but does have `index.html`, it
generates a safe manifest and stores the web files under `content/` in the
archive.

## Development

```bash
pnpm test      # vitest — round-trips create → pack → inspect → verify
pnpm typecheck
pnpm build
```

Bin entry: `bin/capsule.mjs`. Installed as `capsule` when this package is linked globally or via `pnpm link`.
