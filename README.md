<div align="center">

<img src="docs/assets/capsule.png" alt="Capsule" width="640" />

# Capsule

**An open file format for portable, sandboxed interactive documents.**
Spec + reference implementation. Like PDF — but interactive.

[![CI](https://github.com/ImJustRicky/capsule/actions/workflows/ci.yml/badge.svg)](https://github.com/ImJustRicky/capsule/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-9-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Status: V1 draft](https://img.shields.io/badge/status-V1%20draft-orange)](PLAN.md#milestones)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

[Quick start](#quick-start) · [How it works](#how-it-works) · [Security model](#security-model-v1) · [Spec](docs/CAPSULE-1.0-DRAFT.md) · [Examples](examples) · [Installers](installers) · [Contributing](CONTRIBUTING.md)

</div>

---

```text
PDFs made documents portable.
Capsules make interactive documents portable.
```

`.capsule` is an open format for interactive documents. A capsule is a self-contained zip archive with a manifest, content, and integrity metadata. It opens offline, runs inside a strict sandbox, and declares every capability it wants up front. **You see the contract before you click Run.**

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

> Full details: [`docs/SECURITY-MODEL.md`](docs/SECURITY-MODEL.md).

## Quick start

> **Requirements:** Node 20+, pnpm 9+

```bash
# install + build
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

> **Tip:** add a shell alias so you can drop the prefix:
> ```bash
> alias capsule="node $(pwd)/packages/capsule-cli/bin/capsule.mjs"
> ```

## First launch after installing from a download

The v0.1.x release artifacts are **not yet code-signed** (the signing
pipeline is wired up in [`release.yml`](.github/workflows/release.yml) but
the Apple Developer / Authenticode secrets aren't populated). Until they
are, your OS will flag the downloaded installers. One-time workarounds:

### macOS — Capsule.dmg

When you drag `Capsule.app` from the DMG to `/Applications`, the OS tags it
with a quarantine flag. Double-clicking it then fails **silently** — no
error dialog, no logs, just nothing.

Strip the quarantine and re-register the app:

```bash
sudo xattr -dr com.apple.quarantine /Applications/Capsule.app
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f /Applications/Capsule.app
```

Then double-click any `.capsule` file — the sandbox window opens.

Alternatively, right-click `Capsule.app` → **Open** → **Open** once. After
that macOS remembers your decision.

### Windows — capsule-*-windows.zip

SmartScreen shows a blue **"Windows protected your PC"** dialog on first
run. Click **More info → Run anyway** once.

PowerShell may also refuse to run `install.ps1` due to the Execution
Policy. Use the bypass flag:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### Linux — capsule-*-linux.tar.gz

No signing friction. Extract the tarball and run `sudo ./install.sh`.

---

Once the release is signed (Apple notarization + Authenticode), these
workarounds go away for end users. See [`docs/RELEASE.md`](docs/RELEASE.md)
for how signing is configured.

## How it works

`capsule run` starts a short-lived HTTP server bound to `127.0.0.1` on a random port with an unguessable path token, then opens a chromeless browser window with the **Open Screen**. The capsule HTML loads inside a sandboxed `<iframe>` with a strict Content-Security-Policy. All capability calls cross a `postMessage` bridge to the host, which enforces the manifest.

```text
┌───────────────────────────────┐
│   Open Screen (host page)     │  ← shows what the capsule can/can't do
│   ┌─────────────────────────┐ │
│   │  Capsule iframe         │ │  ← strict CSP, sandboxed
│   │  • no network           │ │
│   │  • no shell             │ │
│   │  • no ambient access    │ │
│   └─────────────────────────┘ │
└───────────────────────────────┘
              ▲
              │ postMessage bridge
              ▼
┌───────────────────────────────┐
│  Local runtime server         │  ← mediates every capability call
│  127.0.0.1:<random>           │
└───────────────────────────────┘
```

## Packages

| Package | Purpose |
| --- | --- |
| [`capsule-core`](packages/capsule-core) | Format library: manifest schema, archive reader, path rules, deterministic packer, canonical content hash |
| [`capsule-runtime`](packages/capsule-runtime) | Sandbox host: HTTP server, Open Screen UI, capability bridge, permission prompts, receipts |
| [`capsule-cli`](packages/capsule-cli) | Author tooling: `make`, `pack`, `inspect`, `verify`, `run`, `receipts` |

## Examples

The [`examples/`](examples) directory contains reference capsules that exercise the format and capability model. Each is a plain directory you can `capsule pack` and `capsule run`.

- [`pocket-notes`](examples/pocket-notes) — polished markdown notepad with live preview, persists drafts via `storage.local`
- [`offline-checklist`](examples/offline-checklist) — local-only checklist that uses `storage.local`
- [`mortgage-calculator`](examples/mortgage-calculator) — pure-compute capsule, no capabilities
- [`poster-maker`](examples/poster-maker) — canvas drawing, no network

## Standards draft

The format is documented as a standards draft in [`docs/`](docs/). The V1 implementation treats these files as the source of truth:

| Document | Scope |
| --- | --- |
| [`CAPSULE-1.0-DRAFT.md`](docs/CAPSULE-1.0-DRAFT.md) | High-level standard |
| [`ARCHIVE-FORMAT.md`](docs/ARCHIVE-FORMAT.md) | `.capsule` archive layout |
| [`MANIFEST.md`](docs/MANIFEST.md) | `capsule.json` fields |
| [`MANIFEST-1.0.schema.json`](docs/MANIFEST-1.0.schema.json) | JSON Schema |
| [`CAPABILITY-MODEL.md`](docs/CAPABILITY-MODEL.md) | Permission system |
| [`SECURITY-MODEL.md`](docs/SECURITY-MODEL.md) | Sandbox and threat model |
| [`SIGNING-AND-INTEGRITY.md`](docs/SIGNING-AND-INTEGRITY.md) | Hashing, signatures, provenance |
| [`RUNTIME-CONFORMANCE.md`](docs/RUNTIME-CONFORMANCE.md) | What a compatible runtime must do |
| [`OS-INTEGRATION.md`](docs/OS-INTEGRATION.md) | File extension, MIME, icons |
| [`AUTHORING-GUIDE.md`](docs/AUTHORING-GUIDE.md) | How to make safe capsules |
| [`RELEASE.md`](docs/RELEASE.md) | How releases are built, signed, and verified |

## Making capsules

For most authors, start with `capsule make`. It creates a template project when the path does not exist, or packages an existing web folder when it does.

```bash
capsule make my-checklist --template checklist
capsule make ./dist --name "Interactive Report"
capsule make --list-templates
```

Use `capsule pack` when you already have a complete Capsule project with an authored `capsule.json` and want strict deterministic packaging.

## Development

```bash
pnpm install
pnpm -r build       # build all packages (capsule-core first via workspace deps)
pnpm -r test        # vitest across all packages
pnpm -r typecheck   # tsc --noEmit across all packages
```

Tests, type checks, and builds all run in CI on Ubuntu and macOS against Node 20 and 22. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Status

V1 reference implementation. The format spec is a draft, not frozen. Breaking changes are possible before 1.0. See [milestones](PLAN.md#milestones) for current progress.

## Contributing

Contributions are welcome — bugs, features, examples, and spec feedback. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the workflow.

## License

[MIT](LICENSE). Capsule is intended to be implementable by more than one runtime — the format, manifest, and behavior are documented independently of this implementation.

---

<div align="center">

If Capsule is useful to you, consider starring the repo to help others find it.

</div>
