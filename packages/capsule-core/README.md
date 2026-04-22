# @capsule/core

Format library for the [Capsule](../../README.md) standard. Zero runtime dependencies on any sandbox or HTTP server — pure format handling.

## What's in here

| Module | Purpose |
| --- | --- |
| `paths.ts` | Archive path rule enforcement (no `..`, no `/`-absolute, no drive prefixes, no NUL, no backslash) |
| `manifest.ts` | `capsule.json` validation via JSON Schema (ajv); entry-file existence check |
| `archive.ts` | Safe ZIP reader (`yauzl`); rejects symlinks, unsupported compression, size and ratio bombs |
| `hash.ts` | Canonical SHA-256 content hash per [`SIGNING-AND-INTEGRITY.md`](../../docs/SIGNING-AND-INTEGRITY.md) |
| `pack.ts` | Deterministic packer (`yazl`); stable ordering, normalized timestamps, stamped integrity |
| `index.ts` | `loadCapsuleFromFile` / `loadCapsuleFromBuffer` end-to-end pipeline |

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
