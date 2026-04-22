export * from "./errors.js";
export * from "./paths.js";
export * from "./manifest.js";
export * from "./archive.js";
export * from "./hash.js";
export * from "./pack.js";

import { readArchiveFromBuffer, readArchiveFromFile, requireManifestEntry } from "./archive.js";
import type { ReadArchiveOptions, ReadArchiveResult } from "./archive.js";
import { parseManifestBytes } from "./manifest.js";
import type { CapsuleManifest } from "./manifest.js";
import { computeContentHash, verifyIntegrity } from "./hash.js";
import { CapsuleError, ErrorCode } from "./errors.js";

export interface LoadCapsuleResult {
  archive: ReadArchiveResult;
  manifest: CapsuleManifest;
  integrity: { declared: string | null; actual: string; match: boolean };
}

export async function loadCapsuleFromFile(
  path: string,
  options?: ReadArchiveOptions,
): Promise<LoadCapsuleResult> {
  const archive = await readArchiveFromFile(path, options);
  return finish(archive);
}

export async function loadCapsuleFromBuffer(
  buffer: Buffer | Uint8Array,
  options?: ReadArchiveOptions,
): Promise<LoadCapsuleResult> {
  const archive = await readArchiveFromBuffer(buffer, options);
  return finish(archive);
}

function finish(archive: ReadArchiveResult): LoadCapsuleResult {
  const manifestBytes = requireManifestEntry(archive);
  const entries = new Set(archive.entries.filter((e) => !e.isDirectory).map((e) => e.path));
  const manifest = parseManifestBytes(manifestBytes, { entries });
  const declared = manifest.integrity?.content_hash ?? null;
  const result = declared
    ? verifyIntegrity(archive, declared)
    : { expected: "", actual: computeContentHash(archive), match: true };
  if (declared && !result.match) {
    throw new CapsuleError(
      ErrorCode.IntegrityMismatch,
      `content hash mismatch: expected ${declared}, got ${result.actual}`,
    );
  }
  return {
    archive,
    manifest,
    integrity: {
      declared,
      actual: result.actual,
      match: result.match,
    },
  };
}

