# Capsule

Capsule is a single-file format and local runtime for tiny shareable apps you can open, inspect, fork, and run safely.

## Core Pitch

Most software sharing still means one of two bad choices:

- open a static file that cannot do much
- install an app or run code that gets too much trust

Capsule sits between them.

```text
Tiny apps as files.
Portable like PDFs.
Interactive like web apps.
Sandboxed by default.
Inspectable before running.
```

## Product Thesis

A `.capsule` file should feel like a new internet object:

- one file to share
- opens offline
- contains its UI, assets, manifest, and source summary
- requests explicit capabilities instead of ambient machine access
- can be inspected before it runs
- can be forked without losing provenance

## Non-Negotiable Security Model

Security is the product.

- Opening a capsule is inert by default.
- Capsules cannot access the filesystem directly.
- Capsules cannot run shell commands in V1.
- Capsules cannot access the network unless the manifest allowlists hosts.
- Capsules cannot auto-update.
- Capsules cannot read environment variables, SSH keys, browser cookies, local tokens, or `$HOME`.
- Each capsule gets isolated local storage.
- All host APIs are mediated by the runtime.
- Permissions are revocable per capsule.
- Every run records a local receipt.

## Distribution Is the Product, Too

A format only matters if the person receiving the file can open it. PDFs became universal because a reader ended up everywhere. Capsule's answer is to need no reader install at all:

1. **Hosted browser viewer.** A static page anyone can drop a capsule on.
2. **Self-opening `.capsule.html`.** The viewer travels inside the file, so a recipient double-clicks it and it opens in their browser.
3. **Desktop runtime and OS installers.** Optional, for authors and power users.

The strongest wedge is AI-made software: tools now produce endless small single-file apps, and there is no safe way to send one. `capsule make page.html --html` turns any of them into something you can send to anyone.

## MVP Runtime

V1 should use a web sandbox, not native execution.

Recommended shape:

- `.capsule` is a zip-compatible archive.
- Runtime validates `capsule.json`.
- Runtime verifies content hashes.
- Runtime opens the entry file in a sandboxed webview or browser iframe.
- No Node APIs are exposed to capsule code.
- Capsule code talks to the host through a tiny capability API.

Allowed V1 capabilities:

- `storage.local`: read/write capsule-private state
- `filesystem.import`: user-picked file import only
- `filesystem.export`: user-picked file export only
- `clipboard.write`: write only, explicit user action
- `network.fetch`: allowlisted hosts only
- `dialog.open`: host-mediated confirm/input/select prompts

Denied in V1:

- shell
- background daemon access
- arbitrary filesystem paths
- native plugins
- local network scan
- clipboard read
- camera/mic/location
- hidden updates

## Capsule Archive Layout

```text
example.capsule
  capsule.json
  app/
    index.html
    app.js
    style.css
  assets/
  source/
    README.md
  signatures/
  receipts/
```

## Manifest Draft

```json
{
  "capsule_version": "1.0",
  "name": "Mortgage Calculator",
  "slug": "mortgage-calculator",
  "version": "0.1.0",
  "author": {
    "name": "Ricky",
    "url": null
  },
  "entry": "app/index.html",
  "permissions": [
    {
      "capability": "storage.local",
      "scope": "capsule",
      "reason": "Save scenarios locally"
    }
  ],
  "network": {
    "default": "deny",
    "allow": []
  },
  "integrity": {
    "content_hash": "sha256:TODO"
  }
}
```

## Open Screen UX

Before a capsule runs, the runtime shows:

```text
Mortgage Calculator
Unsigned local capsule

This capsule can:
✓ save its own settings

This capsule cannot:
× read your files
× access your clipboard
× use the network
× run shell commands
× update itself silently

[Inspect] [Run Once] [Trust This Version]
```

## First Demo Capsules

Pick demos that make the format feel real without needing risky permissions.

- loan calculator
- tiny game
- interactive explainer
- invoice generator
- printable poster maker
- offline checklist
- recipe scaler
- SVG icon editor

## Technical Packages

```text
packages/
  capsule-core/       manifest parser, archive reader, hashing, self-opening wrapper
  capsule-web/        zero-install browser viewer (hosted page + .capsule.html template)
  capsule-runtime/    Node sandbox host and capability bridge
  capsule-cli/        make, share, pack, inspect, verify, run
examples/
  mortgage-calculator/
  poster-maker/
  tiny-game/
```

Keep the core independent of Electron. Desktop is a shell around the runtime, not the runtime itself.

## Standards Docs

The standards-style draft lives in `docs/`.

Start with `docs/README.md`, then treat these as the implementation source of truth:

- `docs/CAPSULE-1.0-DRAFT.md`
- `docs/ARCHIVE-FORMAT.md`
- `docs/MANIFEST.md`
- `docs/MANIFEST-1.0.schema.json`
- `docs/CAPABILITY-MODEL.md`
- `docs/SECURITY-MODEL.md`
- `docs/SIGNING-AND-INTEGRITY.md`
- `docs/RUNTIME-CONFORMANCE.md`
- `docs/OS-INTEGRATION.md`
- `docs/AUTHORING-GUIDE.md`
- `docs/WEB-VIEWER.md`

## CLI Sketch

```bash
capsule create mortgage-calculator
capsule pack ./mortgage-calculator
capsule inspect mortgage-calculator.capsule
capsule run mortgage-calculator.capsule
capsule verify mortgage-calculator.capsule
capsule share mortgage-calculator.capsule   # self-opening .capsule.html
capsule make page.html --html                # any single web page, e.g. from an AI tool
```

## Roadmap

### Done

1. Manifest schema and archive format.
2. `capsule inspect` for local `.capsule` files.
3. `capsule pack` with deterministic hashing.
4. Web sandbox runner with no host capabilities.
5. `storage.local`.
6. User-picked import/export.
7. Allowlisted `network.fetch`.
8. Receipt log.
9. First demo capsules.
10. Open Screen.
11. **Zero-install browser viewer**, sharing path rules, hashing, schema, and the bridge with the Node runtime, and covered by cross-runtime conformance tests.
12. **Self-opening `.capsule.html`** (`capsule share`, `capsule make --html`), accepted by every runtime as input.
13. **Single-file apps run as they are.** Inline scripts are allowed, and the name is taken from `<title>`.

### Now

- Publish the hosted viewer (GitHub Pages workflow is in place; Pages must be enabled for the repository).
- Get capsules into people's hands: share real AI-made apps as `.capsule.html` and watch what breaks.
- A conformance fixture set (`fixtures/*.capsule`) and `capsule inspect --json`, so third-party runtimes can test themselves.

### Next

- "Export as capsule" for AI tools: a documented prompt, plus an MCP server or plugin that returns a `.capsule.html`.
- Author signatures (the format reserves `signatures/`) and showing who signed on the Open Screen.
- Persistent, revocable grants tied to signer and content identity.
- Restyle the Node runtime's Open Screen to match the browser viewer.

### Paused

- Code-signed OS installers and notarization. The pipeline exists ([docs/RELEASE.md](docs/RELEASE.md)), but signing certificates only pay off once people are double-clicking `.capsule` files. Until then the browser paths cover recipients with zero install.
- A dedicated desktop app (Electron or Tauri).

## Anti-Goals

- Not a package manager.
- Not an app store first.
- Not a replacement for Electron.
- Not a browser extension platform.
- Not a way to run arbitrary npm packages on a user machine.
- Not a native plugin runtime in V1.

## README Hook

```text
Capsule is a single-file format for tiny apps you can open, inspect, fork, and share.

Portable like PDFs. Interactive like apps. Sandboxed by default.
```
