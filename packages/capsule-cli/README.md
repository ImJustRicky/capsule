# @capsule/cli

Reference CLI for the [Capsule](../../README.md) format. Installs a single `capsule` binary.

## Commands

```text
capsule create <slug>              scaffold a new capsule project directory
capsule pack <dir> [-o <out>]      pack a directory into <dir>.capsule
capsule inspect <file.capsule>     print manifest, files, integrity status
capsule verify <file.capsule>      verify the declared content_hash
capsule run <file.capsule>         open a capsule in the sandboxed runtime
capsule help                       show usage
```

Exit codes: `0` success, `1` error, `2` usage error.

## Flags

- `pack -o <path>` — override output path (default: `<slug>.capsule`)
- `run --port <n>` — pin the runtime port (default: random free port)
- `run --headless` — start the server but don't open a browser

## Development

```bash
pnpm test      # vitest — round-trips create → pack → inspect → verify
pnpm typecheck
pnpm build
```

Bin entry: `bin/capsule.mjs`. Installed as `capsule` when this package is linked globally or via `pnpm link`.
