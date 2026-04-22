import { createHash } from "node:crypto";
import type { ArchiveEntry, ReadArchiveResult } from "./archive.js";
import { CapsuleError, ErrorCode } from "./errors.js";

const INCLUDED_PREFIXES = ["content/", "assets/", "metadata/", "source/"] as const;
const EXCLUDED_PREFIXES = ["signatures/", "receipts/"] as const;

/**
 * Compute the canonical content hash per SIGNING-AND-INTEGRITY.md.
 *
 * Scope:
 *   - capsule.json with `integrity` stripped and keys sorted (canonical JSON)
 *   - content/** assets/** metadata/** source/**
 * Excluded: signatures/**, receipts/**, directory entries.
 *
 * Canonical serialization per entry:
 *   "<path>\n<uncompressed length>\n"  ||  <bytes>  ||  "\n"
 * Entries are processed in ascending UTF-8 path order.
 */
export function computeContentHash(archive: ReadArchiveResult): string {
  const hasher = createHash("sha256");
  const manifest = archive.byPath.get("capsule.json");
  if (!manifest || manifest.isDirectory) {
    throw new CapsuleError(
      ErrorCode.ArchiveMissingManifest,
      "cannot hash archive without capsule.json",
    );
  }
  hashEntry(hasher, "capsule.json", canonicalManifestBytes(manifest.bytes));

  const inScope = archive.entries
    .filter(isHashable)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  for (const entry of inScope) {
    hashEntry(hasher, entry.path, entry.bytes);
  }
  return `sha256:${hasher.digest("hex")}`;
}

function isHashable(entry: ArchiveEntry): boolean {
  if (entry.isDirectory) return false;
  if (entry.path === "capsule.json") return false;
  if (EXCLUDED_PREFIXES.some((p) => entry.path.startsWith(p))) return false;
  return INCLUDED_PREFIXES.some((p) => entry.path.startsWith(p));
}

function hashEntry(hasher: import("node:crypto").Hash, path: string, bytes: Uint8Array): void {
  hasher.update(`${path}\n${bytes.byteLength}\n`);
  hasher.update(bytes);
  hasher.update("\n");
}

/**
 * Strip `integrity` and re-serialize with sorted keys so the hash is stable
 * regardless of whether `content_hash` has been written back yet.
 */
export function canonicalManifestBytes(raw: Uint8Array): Uint8Array {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  const parsed = JSON.parse(text) as Record<string, unknown>;
  // Always exclude integrity from the hash scope.
  delete parsed.integrity;
  return new TextEncoder().encode(canonicalJsonStringify(parsed));
}

export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify(obj[k])}`)
    .join(",");
  return `{${body}}`;
}

export interface VerifyIntegrityResult {
  expected: string;
  actual: string;
  match: boolean;
}

export function verifyIntegrity(archive: ReadArchiveResult, expected: string): VerifyIntegrityResult {
  const actual = computeContentHash(archive);
  return { expected, actual, match: actual === expected };
}
