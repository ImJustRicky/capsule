# Capsule

> A single-file format for tiny apps you can open, inspect, fork, and share. Portable like PDFs. Interactive like web apps. Sandboxed by default.

`.capsule` is an open format for interactive documents. A capsule is a self-contained zip archive with a manifest, content, and integrity metadata. It opens offline, runs inside a strict sandbox, and declares every capability it wants up front. You see the contract before you click Run.

```text
PDFs made documents portable.
Capsules make interactive documents portable.
```

## Why

Most software sharing collapses into one of two bad shapes: a static file that cannot do much, or an installable app that gets too much trust. Capsule sits between them.

- **One file to share.** Email it, drop it in chat, stick it on a flash drive.
- **Offline.** No server required after download.
- **Inspectable before it runs.** The runtime shows what it can and cannot do, every time.
- **Sandboxed by default.** No ambient access to your files, clipboard, network, shell, environment, or tokens.
- **Explicit capabilities.** Network access must be allowlisted per host in the manifest. The user confirms each grant.
- **Forkable with provenance.** Content is hashed canonically; authors can sign.

## Security model (V1)

Opening a capsule is inert. Capabilities are always denied by default and mediated by the host runtime. Capsules **cannot**:

- read arbitrary files
- read the clipboard
- run shell commands
- contact the network unless the manifest allowlists specific hosts
- read environment variables, cookies, tokens, or `$HOME`
- update themselves silently
- access camera, microphone, or location

Full details: [`docs/SECURITY-MODEL.md`](docs/SECURITY-MODEL.md).

## Quick start

```bash
# install deps
pnpm install
pnpm -r build

# easiest path: make a capsule from a starter template
node packages/capsule-cli/bin/capsule.mjs make hello --template checklist

# or package an existing folder with index.html
node packages/capsule-cli/bin/capsule.mjs make ./my-site --name "My Site"

# inspect it (no execution)
node packages/capsule-cli/bin/capsule.mjs inspect hello.capsule

# run it in a sandboxed window
node packages/capsule-cli/bin/capsule.mjs run hello.capsule
```

`capsule run` starts a short-lived HTTP server bound to `127.0.0.1` on a random port with an unguessable path token, then opens a chromeless browser window with the Open Screen. The capsule HTML loads inside a sandboxed `<iframe>` with a strict Content-Security-Policy. All capability calls cross a `postMessage` bridge to the host, which enforces the manifest.

## Packages

| Package | Purpose |
| --- | --- |
| [`capsule-core`](packages/capsule-core) | Format library: manifest schema, archive reader, path rules, deterministic packer, canonical content hash |
| [`capsule-runtime`](packages/capsule-runtime) | Sandbox host: HTTP server, Open Screen UI, capability bridge, permission prompts, receipts |
| [`capsule-cli`](packages/capsule-cli) | Author tooling: `create`, `pack`, `inspect`, `verify`, `run` |

## Examples

The `examples/` directory contains reference capsules that exercise the format and capability model. Each is a plain directory you can `capsule pack` and `capsule run`.

## Standards draft

The format is documented as a standards draft in [`docs/`](docs/). The V1 implementation treats these files as the source of truth:

- [`CAPSULE-1.0-DRAFT.md`](docs/CAPSULE-1.0-DRAFT.md) — high-level standard
- [`ARCHIVE-FORMAT.md`](docs/ARCHIVE-FORMAT.md) — `.capsule` archive layout
- [`MANIFEST.md`](docs/MANIFEST.md) — `capsule.json` fields
- [`MANIFEST-1.0.schema.json`](docs/MANIFEST-1.0.schema.json) — JSON Schema
- [`CAPABILITY-MODEL.md`](docs/CAPABILITY-MODEL.md) — permission system
- [`SECURITY-MODEL.md`](docs/SECURITY-MODEL.md) — sandbox and threat model
- [`SIGNING-AND-INTEGRITY.md`](docs/SIGNING-AND-INTEGRITY.md) — hashing, signatures, provenance
- [`RUNTIME-CONFORMANCE.md`](docs/RUNTIME-CONFORMANCE.md) — what a compatible runtime must do
- [`OS-INTEGRATION.md`](docs/OS-INTEGRATION.md) — file extension, MIME, icons
- [`AUTHORING-GUIDE.md`](docs/AUTHORING-GUIDE.md) — how to make safe capsules

## Development

Requirements: Node 20+, pnpm 9+.

```bash
pnpm install
pnpm -r build       # build all packages (capsule-core first via workspace deps)
pnpm -r test        # vitest across all packages
pnpm -r typecheck   # tsc --noEmit across all packages
```

Tests, type checks, and builds all run in CI on Ubuntu and macOS against Node 20 and 22. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Making Capsules

For most authors, start with `capsule make`. It creates a template project when
the path does not exist, or packages an existing web folder when it does.

```bash
capsule make my-checklist --template checklist
capsule make ./dist --name "Interactive Report"
capsule make --list-templates
```

Use `capsule pack` when you already have a complete Capsule project with an
authored `capsule.json` and want strict deterministic packaging.

## Status

V1 reference implementation. The format spec is a draft, not frozen. Breaking changes are possible before 1.0. [Milestones](PLAN.md#milestones) track current progress.

## License

[MIT](LICENSE). Capsule is intended to be implementable by more than one runtime — the format, manifest, and behavior are documented independently of this implementation.
