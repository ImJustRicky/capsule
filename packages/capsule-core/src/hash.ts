import { createHash } from "node:crypto";
import type { ReadArchiveResult } from "./archive.js";
import { contentHashChunks } from "./canonical.js";

// Re-exported for backwards compatibility: these used to live here.
export { canonicalJsonStringify, canonicalManifestBytes } from "./canonical.js";

/**
 * Compute the canonical content hash per SIGNING-AND-INTEGRITY.md.
 * The serialization itself lives in canonical.ts so that browser runtimes
 * hash exactly the same bytes.
 */
export function computeContentHash(archive: ReadArchiveResult): string {
  const hasher = createHash("sha256");
  for (const chunk of contentHashChunks(archive.entries)) hasher.update(chunk);
  return `sha256:${hasher.digest("hex")}`;
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
