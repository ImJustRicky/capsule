import yazl from "yazl";
import { canonicalJsonStringify } from "./hash.js";
import { validateArchivePath } from "./paths.js";
import type { CapsuleManifest } from "./manifest.js";
import { parseManifestText } from "./manifest.js";
import { readArchiveFromBuffer } from "./archive.js";
import { computeContentHash } from "./hash.js";

/**
 * Reference packer. Produces byte-stable archives given byte-stable inputs:
 *   - fixed mtime (2000-01-01 UTC)
 *   - fixed Unix mode (0o100644)
 *   - entries sorted by archive priority then path
 *   - capsule.json serialized with sorted keys
 *
 * Entry ordering per ARCHIVE-FORMAT.md §Deterministic Packing:
 *   1. capsule.json
 *   2. content/**
 *   3. assets/**
 *   4. metadata/**
 *   5. source/**
 *   6. signatures/**
 *   7. everything else (lexicographic)
 */

const FIXED_MTIME = new Date(Date.UTC(2000, 0, 1, 0, 0, 0));
const FIXED_MODE = 0o100644;

export interface PackFile {
  /** Archive-relative path (validated). */
  path: string;
  /** Raw bytes. */
  bytes: Uint8Array;
}

export interface PackOptions {
  /**
   * If true (default), re-serialize capsule.json with sorted keys and stamp
   * the computed content_hash into `integrity` after hashing.
   */
  stampIntegrity?: boolean;
}

export interface PackResult {
  bytes: Uint8Array;
  contentHash: string;
  manifest: CapsuleManifest;
}

export async function packArchive(
  files: PackFile[],
  options: PackOptions = {},
): Promise<PackResult> {
  const stampIntegrity = options.stampIntegrity ?? true;

  const manifestFile = files.find((f) => f.path === "capsule.json");
  if (!manifestFile) throw new Error("packArchive requires a capsule.json entry");

  // Validate all paths up front (defense in depth; yazl also rejects traversal).
  for (const f of files) validateArchivePath(f.path);

  // Canonicalize capsule.json (sorted keys). integrity is always stripped for
  // the hashing pass; if stampIntegrity is false, we preserve the author's
  // provided integrity block on the final write instead.
  const parsed = JSON.parse(new TextDecoder().decode(manifestFile.bytes)) as Record<
    string,
    unknown
  >;
  const authorIntegrity = parsed.integrity as Record<string, unknown> | undefined;
  delete parsed.integrity;
  const manifestCanonical = new TextEncoder().encode(canonicalJsonStringify(parsed));

  const prepared: PackFile[] = [
    { path: "capsule.json", bytes: manifestCanonical },
    ...files.filter((f) => f.path !== "capsule.json"),
  ];

  const firstZip = await writeDeterministicZip(prepared);
  const firstArchive = await readArchiveFromBuffer(firstZip);
  const contentHash = computeContentHash(firstArchive);

  if (!stampIntegrity) {
    if (!authorIntegrity) {
      const manifest = parseManifestText(new TextDecoder().decode(manifestCanonical));
      return { bytes: firstZip, contentHash, manifest };
    }
    const withAuthorIntegrity = { ...parsed, integrity: authorIntegrity };
    const bytes = new TextEncoder().encode(canonicalJsonStringify(withAuthorIntegrity));
    const repacked = await writeDeterministicZip([
      { path: "capsule.json", bytes },
      ...files.filter((f) => f.path !== "capsule.json"),
    ]);
    const manifest = parseManifestText(new TextDecoder().decode(bytes));
    return { bytes: repacked, contentHash, manifest };
  }

  const stamped = { ...parsed, integrity: { algorithm: "sha256", content_hash: contentHash } };
  const stampedBytes = new TextEncoder().encode(canonicalJsonStringify(stamped));
  const finalPrepared: PackFile[] = [
    { path: "capsule.json", bytes: stampedBytes },
    ...files.filter((f) => f.path !== "capsule.json"),
  ];
  const finalZip = await writeDeterministicZip(finalPrepared);
  const manifest = parseManifestText(new TextDecoder().decode(stampedBytes));
  return { bytes: finalZip, contentHash, manifest };
}

function writeDeterministicZip(files: PackFile[]): Promise<Uint8Array> {
  const ordered = [...files].sort(comparePackEntries);
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const f of ordered) {
      zip.addBuffer(Buffer.from(f.bytes), f.path, {
        mtime: FIXED_MTIME,
        mode: FIXED_MODE,
        compress: true,
      });
    }
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (c: Buffer) => chunks.push(c));
    zip.outputStream.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    zip.outputStream.on("error", reject);
    zip.end();
  });
}

const PRIORITY = [
  "capsule.json",
  "content/",
  "assets/",
  "metadata/",
  "source/",
  "signatures/",
];

function priority(path: string): number {
  for (let i = 0; i < PRIORITY.length; i++) {
    const p = PRIORITY[i]!;
    if (path === p || path.startsWith(p)) return i;
  }
  return PRIORITY.length;
}

function comparePackEntries(a: PackFile, b: PackFile): number {
  const pa = priority(a.path);
  const pb = priority(b.path);
  if (pa !== pb) return pa - pb;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}
