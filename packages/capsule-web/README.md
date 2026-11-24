# @capsule/web

Zero-install browser viewer for [Capsule](../../README.md). The whole runtime is one HTML file (`dist/viewer.html`), which is both:

- the **hosted viewer**: publish it as a static page, then drop a capsule on it or open `?src=<url>`
- the **template for self-opening capsules**: `capsule share` embeds a `.capsule` archive inside a copy of it, producing `name.capsule.html`

How it works, what it guarantees, and its limits: [`docs/WEB-VIEWER.md`](../../docs/WEB-VIEWER.md).

## Layout

| Path | Purpose |
| --- | --- |
| `src/zip.ts` | Dependency-free ZIP reader on `DecompressionStream`, with the archive rules and bomb limits |
| `src/hash.ts` | Content hash via WebCrypto, plus a portable SHA-256 for non-secure contexts |
| `src/manifest.ts` | Manifest validation with a schema validator compiled at build time |
| `src/load.ts` | `loadCapsule(bytes)`: accepts `.capsule` and `.capsule.html`, mirrors `@capsule/core` |
| `src/capabilities.ts` | Pure capability rules (scope, allowlist, private hosts, headers) and plain-language wording |
| `src/host.ts` | Capability mediation and browser backends (IndexedDB, pickers, clipboard, fetch) |
| `src/document.ts` | Turns a capsule page into one self-contained `srcdoc` document under the capsule CSP |
| `src/viewer.ts`, `viewer.html`, `viewer.css` | The UI |
| `src/shims/navigate.js` | In-capsule shim that routes relative links through the host |
| `src/node.ts` | Node entry point: `viewerHtmlPath()`, `buildSelfOpeningHtml(bytes, title)` |
| `scripts/build.mjs` | Bundles the viewer with esbuild and inlines it into `dist/viewer.html` |
| `scripts/gen-validator.mjs` | Compiles `@capsule/core`'s manifest schema with Ajv standalone |
| `scripts/build-site.mjs` | Viewer plus packed examples, as deployed to GitHub Pages |

Archive path rules, hash serialization, manifest semantic checks, and the wrapper format come from `@capsule/core/browser`; the in-capsule bridge is `capsule-runtime/src/host/bridge.js`. Nothing security-relevant is duplicated.

## Node API

```ts
import { buildSelfOpeningHtml, viewerHtmlPath } from "@capsule/web";

const html = await buildSelfOpeningHtml(capsuleBytes, "My App · Capsule");
```

## Scripts

```bash
pnpm build        # dist/viewer.html + dist/node.js
pnpm test         # unit + cross-runtime conformance tests (Node)
pnpm test:e2e     # Playwright + Chromium end-to-end tests
pnpm typecheck
```

`CAPSULE_VIEWER_URL` sets the hosted-viewer link shown inside self-opening files (default `https://imjustricky.github.io/capsule/`).
