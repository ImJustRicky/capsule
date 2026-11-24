# Browser Viewer

## Purpose

The browser viewer (`packages/capsule-web`) is a complete Capsule runtime in a single HTML file. It needs no install, no server, and no Node.js. It serves three uses:

| Use | How |
| --- | --- |
| **Hosted viewer** | The file is published as a static page (GitHub Pages). People drop a capsule on it, or open `?src=<url>`. |
| **Self-opening capsule** | The CLI embeds a `.capsule` archive inside a copy of the viewer, producing `name.capsule.html`. Double-clicking it opens the capsule. |
| **Trusted verifier** | Dropping a `.capsule.html` on the hosted viewer extracts the embedded archive and verifies it with the hosted copy of the code, not the copy inside the file. |

Nothing is uploaded. Parsing, verification, and execution all happen in the tab.

## Conformance

The browser viewer is a Level 2 (Capability) runtime as defined in [RUNTIME-CONFORMANCE.md](./RUNTIME-CONFORMANCE.md), with the browser-specific differences listed under [Limits](#limits).

It shares its rules with the Node reference implementation instead of re-implementing them:

| Concern | Shared source |
| --- | --- |
| Path rules | `@capsule/core/browser` → `paths.ts` |
| Content-hash serialization | `@capsule/core/browser` → `canonical.ts` (the Node runtime feeds the same chunks to `node:crypto`, the viewer to WebCrypto) |
| Manifest schema | `manifest.schema.json`, compiled at build time with Ajv's standalone compiler (the viewer's CSP forbids `new Function`) |
| Manifest semantic checks | `@capsule/core/browser` → `manifest-checks.ts` |
| Self-opening wrapper format | `@capsule/core/browser` → `embedded.ts` |
| Capability bridge inside the capsule | `capsule-runtime/src/host/bridge.js`, injected as-is |

A cross-implementation test suite (`packages/capsule-web/test/conformance.test.ts`) packs every example with the Node packer and checks that both readers return identical entries, identical content hashes, and identical manifests.

## Opening a capsule

1. **Read the archive.** A dependency-free ZIP reader uses the platform `DecompressionStream("deflate-raw")`. It enforces the [archive rules](./ARCHIVE-FORMAT.md) and is stricter than the Node reader where a browser can't afford to be lax:
   - path rules, no symlinks, no duplicate paths, stored or deflate only
   - total-size (256 MiB), entry-count (10,000), and compression-ratio (200:1) limits, checked from the central directory **before** inflating anything
   - entries may not overlap (the "overlapping files" zip-bomb construction)
   - every entry's decompressed length and CRC-32 must match; inflation stops the moment output exceeds the declared size
   - ZIP64, multi-disk, and encrypted archives are rejected
2. **Validate the manifest** against the schema and the semantic checks.
3. **Verify integrity.** If the manifest declares a `content_hash` and the content doesn't match, the capsule is refused with `integrity.mismatch` and nothing runs.
4. **Show the Open Screen.** It shows the name, author, and version; whether the capsule is unchanged since it was packed; what it can do, in plain language; and what it can't. Details and the full file list are one click away.

## Running a capsule

When you press Run:

1. **The viewer narrows its own network policy.** It appends a second CSP `<meta>` to its own page: `connect-src` set to only the hosts the capsule may reach (allowlisted, inside the `network.fetch` scope, and public), or `'none'`. CSP can only ever be tightened, so this lasts until the page reloads. Opening a different capsule afterwards reloads the page.
2. **The page is turned into one self-contained document.** A browser-only runtime has no server to answer `style.css`, so every local reference the page makes declaratively is resolved against the archive and inlined:
   - `<link rel="stylesheet">` becomes `<style>`, with `url()` and `@import` resolved relative to the stylesheet
   - `<script src>` becomes a `data:` URL, so `defer`, `async`, module semantics, and execution order are exactly what the author wrote
   - `img`, `source`, `video`, `audio`, `track`, `srcset`, SVG `<image>`, `style` attributes, and other `<link>` hrefs become `data:` URLs
   - `<base>` and `<meta http-equiv="refresh">` are removed

   References resolve relative to the referring file first, then from the archive root, then relative to the entry's folder, which reproduces how the Node runtime serves files.
3. **The capsule's CSP goes first.** The document's first `<head>` element is the capsule CSP `<meta>`, then the shared `bridge.js`, then a small navigation shim. Nothing the author wrote can load or run before the policy is in force.
4. **The document runs in a sandboxed iframe:** `<iframe sandbox="allow-scripts allow-forms" srcdoc="…">`. Without `allow-same-origin` it has an opaque (`null`) origin.

Relative links between pages (`<a href="about.html">`) are caught by the navigation shim and rendered by the host from the archive.

### Capsule document CSP

```text
default-src 'none';
script-src 'unsafe-inline' data:;
style-src 'unsafe-inline' data:;
img-src data: blob:;
media-src data: blob:;
font-src data: blob:;
connect-src 'none';
worker-src 'none';
frame-src 'none';
child-src 'none';
object-src 'none';
manifest-src 'none';
base-uri 'none';
form-action 'none'
```

`'unsafe-inline'` lets single-file apps run; that's the usual output of AI tools. It grants nothing extra: capsule code is untrusted by definition, so there is no "injected script" to defend against. Isolation comes from the opaque-origin sandbox plus `connect-src 'none'`. `eval` stays blocked, as in the Node runtime.

A `srcdoc` frame **inherits** its parent's CSP and adds its own on top, and both are enforced. The viewer page's own policy therefore has to allow what capsule documents need (inline and `data:` scripts and styles, `data:`/`blob:` media). After Run, the inherited policy also carries the narrowed `connect-src`, so even if the capsule's own policy were somehow bypassed, the capsule could still reach nothing beyond its allowlisted hosts.

## Capabilities

The mediation pipeline matches the Node runtime: **declared → in scope → user decision → dispatch → receipt.** An undeclared capability or an out-of-scope network target is rejected without prompting. The user's decision is remembered for the page session.

| Capability | Browser backend |
| --- | --- |
| `storage.local` | IndexedDB, keyed by `slug@content-hash` like the Node runtime. Falls back to memory, with an on-screen notice, if the browser blocks storage (some browsers do on `file://`). 5 MB per value. |
| `filesystem.import` | A file picker. If the request didn't come from a recent click, the viewer shows a "Choose file…" step first, because browsers only open pickers on a user gesture. |
| `filesystem.export` | The File System Access save picker where available, otherwise a download. File names are sanitized. |
| `clipboard.write` | `navigator.clipboard.writeText`, with the same gesture step if the browser requires one. |
| `dialog.open` | The browser's own `alert` / `confirm` / `prompt`, prefixed with the capsule's name. |
| `network.fetch` | A direct `fetch` from the viewer: `https` only, allowlisted and in-scope hosts only, literal private and local addresses blocked, `credentials: "omit"`, no referrer, redirects refused, the Node proxy's header policy, 25 MB response cap. The response envelope matches the Node proxy. |

Activity (opens, runs, grants, denials, navigation) is recorded for the session and shown under **Inspect → Activity this session**.

## Security

What the end-to-end suite (`packages/capsule-web/test/e2e/run.mjs`) proves in Chromium, with a probe capsule that tries every escape hatch:

- the capsule's origin is `null`; `localStorage` and the parent page's DOM are unreachable
- direct `fetch` and image loads to a live local server are blocked, and the server receives zero requests
- popups and `eval` are blocked
- undeclared capabilities fail with `capability.not_declared`
- `network.fetch` to an allowlisted but private host fails with `network.blocked` after the prompt
- after Run, the viewer page itself can no longer reach that server either
- a capsule whose content doesn't match its declared hash is refused before anything renders

### Self-opening files are not a trust boundary

A `.capsule.html` carries its own viewer, so **whoever made the file made the viewer**. A malicious sender can ship a viewer that lies. Opening one is as safe as opening any web page in your browser, and no safer. The viewer says this on screen, under the Open Screen card.

To check a self-opening file with code you trust:

- drop it on the hosted viewer, which extracts the embedded archive and verifies it itself, or
- run `capsule inspect file.capsule.html` or `capsule verify file.capsule.html`.

### Hosting the viewer

Capsule storage lives in the viewer's origin. A viewer hosted on a shared origin (for example `username.github.io`, shared by every Pages site of that user) shares IndexedDB with those other sites. For production use, host the viewer on a dedicated origin.

## Limits

These are browser constraints, not format changes. A capsule that respects them works in both runtimes.

| Limit | Why | What to do |
| --- | --- | --- |
| Assets referenced only from JavaScript (`img.src = "logo.png"`) don't resolve | There is no server; only declarative references are inlined | Reference assets from HTML or CSS, or inline them |
| ES modules with **relative** imports between files don't resolve | Modules loaded from `data:` URLs have no base URL | Bundle modules into one file (most AI-tool output already is) |
| `network.fetch` targets must allow CORS | There is no proxy in a browser | Use `capsule run`, which proxies requests, for APIs without CORS |
| Hostnames that *resolve* to private addresses (DNS rebinding) can't be checked | Browsers can't resolve DNS | Literal private addresses are blocked; Chromium's Private Network Access adds protection |
| Redirects are refused | The browser can't re-check each hop against the allowlist | Point at the final URL |
| An author's own CSP `<meta>` with `script-src 'self'` blocks the inlined scripts | `'self'` means nothing in an opaque origin | Don't ship a CSP inside a capsule; the runtime provides one |
| Archives above 256 MiB uncompressed are refused | Everything is held in tab memory | Keep capsules small |
| `WebRTC` isn't covered by CSP in most browsers | Platform gap, shared with the Node runtime | Tracked; see [SECURITY-MODEL.md](./SECURITY-MODEL.md#known-gaps) |

## Building and testing

```bash
pnpm --filter @capsule/web build        # dist/viewer.html (single file)
pnpm --filter @capsule/web test         # unit + conformance (Node)
pnpm --filter @capsule/web test:e2e     # Playwright + Chromium
node packages/capsule-web/scripts/build-site.mjs site   # viewer + packed examples, as deployed to Pages
```

The build fails if the bundled JavaScript contains `</script` or `<!--`, either of which would break inline embedding. `CAPSULE_VIEWER_URL` sets the hosted-viewer link shown in self-opening files (default `https://imjustricky.github.io/capsule/`).
