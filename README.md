<div align="center">

<img src="docs/assets/capsule.png" alt="Capsule" width="640" />

# Capsule

**Send someone a small app as a single file. They see exactly what it can do before it runs, and it runs in a locked-down sandbox.**

An open file format for portable, sandboxed interactive documents. Spec + reference implementation.

[![CI](https://github.com/ImJustRicky/capsule/actions/workflows/ci.yml/badge.svg)](https://github.com/ImJustRicky/capsule/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-9-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Status: V1 draft](https://img.shields.io/badge/status-V1%20draft-orange)](PLAN.md#roadmap)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

[Try it](#try-it) · [Make and share one](#make-and-share-a-capsule) · [How opening works](#how-opening-works) · [Security](#security-model) · [Spec](docs/CAPSULE-1.0-DRAFT.md) · [Contributing](CONTRIBUTING.md)

</div>

---

```text
PDFs made documents portable.
Capsules make interactive documents portable.
```

AI tools now produce a steady stream of small, useful apps: calculators, checklists, explainers, tiny games. Sharing one usually means "here's an HTML file, trust me" or "go to this link". Capsule is a third option: **one file you can email, drop in a chat, or put on a USB stick**, that opens offline, shows a plain-language list of what it can and can't do, and runs with no access to your files, network, or anything else unless the file asks and you agree.

## Try it

Open the hosted viewer and pick an example. Nothing is uploaded: the file is opened, checked, and run inside your browser tab.

**[imjustricky.github.io/capsule](https://imjustricky.github.io/capsule/)**

Or open an example directly:
[Pocket Notes](https://imjustricky.github.io/capsule/?src=examples/pocket-notes.capsule) ·
[Offline Checklist](https://imjustricky.github.io/capsule/?src=examples/offline-checklist.capsule) ·
[Poster Maker](https://imjustricky.github.io/capsule/?src=examples/poster-maker.capsule) ·
[Mortgage Calculator](https://imjustricky.github.io/capsule/?src=examples/mortgage-calculator.capsule)

> The hosted viewer is deployed by [`.github/workflows/pages.yml`](.github/workflows/pages.yml). It needs GitHub Pages enabled for the repository (Settings → Pages → Source: **GitHub Actions**).

## Make and share a capsule

> **Requirements for making capsules:** Node 20+ and pnpm 9+. Opening them needs only a browser.

```bash
pnpm install && pnpm -r build
alias capsule="node $(pwd)/packages/capsule-cli/bin/capsule.mjs"
```

Turn any single web page into a capsule. Single-file apps from AI tools work as they are, inline scripts included:

```bash
capsule make my-app.html --html
```

That writes two files:

| File | What it's for |
| --- | --- |
| `my-app.capsule` | The capsule itself: a zip with the page, a manifest, and an integrity hash. |
| `my-app.capsule.html` | A **self-opening** copy. Double-click it and it opens in any modern browser. Send this one to people who've never heard of Capsule. |

The name comes from the page's `<title>`. Other ways in:

```bash
capsule make ./my-site                       # a folder with index.html
capsule make field-notes --template checklist # start from a template
capsule share my-app.capsule                  # make a self-opening copy of an existing capsule
capsule inspect my-app.capsule.html           # see what's inside without running it
```

A capsule that needs more than its own window declares it in `capsule.json`: saving its own data, opening or saving files you choose, copying to the clipboard, pop-up messages, or connecting to specific websites. See the [authoring guide](docs/AUTHORING-GUIDE.md).

## How opening works

There are three ways to open a capsule. All of them show the same Open Screen first and enforce the same rules.

| | Install needed | Who it's for |
| --- | --- | --- |
| **Hosted viewer** | None | Anyone. Drop a `.capsule` or `.capsule.html` file on the page. |
| **Self-opening `.capsule.html`** | None | Recipients. The viewer travels inside the file. |
| **`capsule run`** (desktop) | Node 20+ and Chrome/Chromium | Authors and power users. Also used by the optional [OS installers](installers). |

**About self-opening files:** they are convenient, but whoever made the file also made the viewer inside it. A self-opening file is exactly as safe as opening any web page, no more. The viewer says so on screen. If you don't trust the sender, check the file with code you trust: drop it on the hosted viewer, or run `capsule inspect file.capsule.html`. Both pull out the embedded archive and verify it themselves.

How the browser viewer works, and what it can't do, is in [`docs/WEB-VIEWER.md`](docs/WEB-VIEWER.md).

## Security model

Opening a capsule is inert. Before anything runs, the runtime validates the archive, checks the manifest against the schema, and verifies the content hash; a capsule whose contents don't match its declared hash is refused. Capabilities are denied by default and mediated by the host. Capsules **cannot**:

- read arbitrary files (only files you pick, if they asked)
- read the clipboard
- run programs or shell commands
- contact the network, unless the manifest allowlists specific hosts and you allow it
- reach localhost or private-network addresses, even if allowlisted
- read environment variables, cookies, tokens, or `$HOME`
- update themselves
- use the camera, microphone, or location

Capsule code runs in an opaque-origin sandboxed iframe under a strict Content-Security-Policy with `connect-src 'none'`; every capability call crosses a `postMessage` bridge to the host, which checks it against the manifest and asks you.

> Full details: [`docs/SECURITY-MODEL.md`](docs/SECURITY-MODEL.md) and [`docs/WEB-VIEWER.md`](docs/WEB-VIEWER.md#security).

## How it works

```text
            ┌─────────────────────────────────────────┐
  .capsule  │  Host (trusted)                         │
  ───────►  │  • reads + validates the zip            │
            │  • checks manifest, verifies hash       │
            │  • shows the Open Screen                │
            │  • mediates every capability request    │
            │   ┌─────────────────────────────────┐   │
            │   │  Capsule (untrusted)            │   │
            │   │  sandboxed iframe, null origin  │   │
            │   │  CSP: connect-src 'none'        │   │
            │   └──────────────┬──────────────────┘   │
            │                  │ postMessage bridge   │
            └──────────────────┴──────────────────────┘
```

There are two hosts that share the same bridge (`bridge.js`), CSP, and rules:

- **Browser viewer** ([`capsule-web`](packages/capsule-web)): everything in one HTML file. It reads the zip with the browser's own decompressor, hashes with WebCrypto, and renders the capsule from `srcdoc` with each local file inlined.
- **Node runtime** ([`capsule-runtime`](packages/capsule-runtime)): a short-lived server on `127.0.0.1` with an unguessable path token, opened in a chromeless browser window. It proxies `network.fetch`, so the target site doesn't have to allow CORS.

## Packages

| Package | Purpose |
| --- | --- |
| [`capsule-core`](packages/capsule-core) | Format library: manifest schema, archive reader, path rules, deterministic packer, canonical content hash, self-opening wrapper. Its `@capsule/core/browser` entry is shared with the browser viewer. |
| [`capsule-web`](packages/capsule-web) | Zero-install browser viewer, also the template for self-opening `.capsule.html` files |
| [`capsule-runtime`](packages/capsule-runtime) | Node sandbox host: HTTP server, Open Screen, capability bridge, permission prompts, receipts |
| [`capsule-cli`](packages/capsule-cli) | Author tooling: `make`, `share`, `pack`, `inspect`, `verify`, `run`, `receipts` |

## Examples

The [`examples/`](examples) directory contains reference capsules:

- [`pocket-notes`](examples/pocket-notes): markdown notepad with live preview; saves drafts with `storage.local`
- [`offline-checklist`](examples/offline-checklist): checklist that remembers itself with `storage.local`
- [`mortgage-calculator`](examples/mortgage-calculator): pure computation, asks for nothing
- [`poster-maker`](examples/poster-maker): canvas drawing with PNG export through `filesystem.export`

## Standards draft

The format is documented independently of this implementation, so other runtimes can implement it:

| Document | Scope |
| --- | --- |
| [`CAPSULE-1.0-DRAFT.md`](docs/CAPSULE-1.0-DRAFT.md) | High-level standard |
| [`ARCHIVE-FORMAT.md`](docs/ARCHIVE-FORMAT.md) | `.capsule` archive layout and the self-opening wrapper |
| [`MANIFEST.md`](docs/MANIFEST.md) | `capsule.json` fields |
| [`MANIFEST-1.0.schema.json`](docs/MANIFEST-1.0.schema.json) | JSON Schema |
| [`CAPABILITY-MODEL.md`](docs/CAPABILITY-MODEL.md) | Permission system |
| [`SECURITY-MODEL.md`](docs/SECURITY-MODEL.md) | Sandbox and threat model |
| [`SIGNING-AND-INTEGRITY.md`](docs/SIGNING-AND-INTEGRITY.md) | Hashing, signatures, provenance |
| [`RUNTIME-CONFORMANCE.md`](docs/RUNTIME-CONFORMANCE.md) | What a compatible runtime must do |
| [`WEB-VIEWER.md`](docs/WEB-VIEWER.md) | How the browser runtime works, its guarantees and limits |
| [`OS-INTEGRATION.md`](docs/OS-INTEGRATION.md) | File extension, MIME type, icons |
| [`AUTHORING-GUIDE.md`](docs/AUTHORING-GUIDE.md) | How to make safe capsules, including from AI tools |
| [`RELEASE.md`](docs/RELEASE.md) | How releases are built, signed, and verified |

## Desktop integration (optional)

The [OS installers](installers) register Capsule as the handler for `.capsule` files, so double-clicking one opens it in the Node runtime. They're optional: the browser viewer and self-opening files cover most people. The v0.1.x installers are not yet code-signed, so your OS will warn on first launch; the one-time workarounds are in [`installers/README.md`](installers/README.md#first-launch-from-an-unsigned-release).

## Development

```bash
pnpm install
pnpm -r build                              # all packages; capsule-core builds first
pnpm -r typecheck
pnpm -r test                               # unit + cross-runtime conformance tests
pnpm --filter @capsule/web test:e2e        # browser end-to-end tests (Playwright + Chromium)
```

CI runs the build, type checks, and unit tests on Ubuntu and macOS with Node 20 and 22, plus the browser end-to-end suite on Ubuntu. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Status

V1 reference implementation. The format spec is a draft, not frozen, so breaking changes are possible before 1.0. See the [roadmap](PLAN.md#roadmap).

## Contributing

Contributions are welcome: bugs, features, examples, and spec feedback. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

[MIT](LICENSE). Capsule is meant to be implementable by more than one runtime: the format, manifest, and behavior are documented independently of this implementation.
