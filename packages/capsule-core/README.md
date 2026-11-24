# @capsule/core

Format library for the [Capsule](../../README.md) standard. Zero runtime dependencies on any sandbox or HTTP server: pure format handling.

Two entry points:

- `@capsule/core`: the full Node library.
- `@capsule/core/browser`: the browser-safe subset (path rules, hash serialization, manifest checks, wrapper format), used by [`@capsule/web`](../capsule-web) so both runtimes enforce identical rules.

## What's in here

| Module | Purpose |
| --- | --- |
| `paths.ts` | Archive path rule enforcement (no `..`, no `/`-absolute, no drive prefixes, no NUL, no backslash) |
| `manifest.ts` | `capsule.json` validation via JSON Schema (ajv); entry-file existence check |
| `archive.ts` | Safe ZIP reader (`yauzl`); rejects symlinks, unsupported compression, size and ratio bombs |
| `hash.ts` | Canonical SHA-256 content hash per [`SIGNING-AND-INTEGRITY.md`](../../docs/SIGNING-AND-INTEGRITY.md) |
| `pack.ts` | Deterministic packer (`yazl`); stable ordering, normalized timestamps, stamped integrity |
| `canonical.ts` | Canonical content-hash serialization, shared with the browser viewer (no Node APIs) |
| `manifest-checks.ts` | Semantic manifest checks JSON Schema can't express, shared with the browser viewer |
| `embedded.ts` | Self-opening `.capsule.html` wrapper: extract, embed, detect |
| `browser.ts` | The `@capsule/core/browser` entry point: everything above that runs in a browser |
| `index.ts` | `loadCapsuleFromFile` / `loadCapsuleFromBuffer` end-to-end pipeline (accepts `.capsule` and `.capsule.html`) |

## Hash scope

Included: `capsule.json` (with `integrity` stripped, keys sorted), `content/**`, `assets/**`, `metadata/**`, `source/**`.
Excluded: `signatures/**`, `receipts/**`, directory entries.

Per-entry canonical form: `"<path>\n<length>\n" || bytes || "\n"`, entries processed in ascending UTF-8 path order.

## Usage

```ts
import { loadCapsuleFromFile, packArchive } from "@capsule/core";

// Read + validate + verify integrity
const { manifest, archive, integrity } = await loadCapsuleFromFile("foo.capsule");

// Produce a deterministic, integrity-stamped archive from in-memory files
const { bytes, contentHash } = await packArchive([
  { path: "capsule.json", bytes: manifestBytes },
  { path: "content/index.html", bytes: htmlBytes },
]);
```

## Testing

```bash
pnpm test      # vitest run
pnpm typecheck # tsc --noEmit
```
