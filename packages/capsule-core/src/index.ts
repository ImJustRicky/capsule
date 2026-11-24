export * from "./errors.js";
export * from "./paths.js";
export * from "./manifest.js";
export * from "./manifest-checks.js";
export * from "./archive.js";
export * from "./canonical.js";
export * from "./hash.js";
export * from "./pack.js";
export * from "./embedded.js";

import { promises as fs } from "node:fs";
import { readArchiveFromBuffer, requireManifestEntry } from "./archive.js";
import type { ReadArchiveOptions, ReadArchiveResult } from "./archive.js";
import { parseManifestBytes } from "./manifest.js";
import type { CapsuleManifest } from "./manifest.js";
import { computeContentHash, verifyIntegrity } from "./hash.js";
import { extractEmbeddedCapsule, looksLikeHtml } from "./embedded.js";
import { CapsuleError, ErrorCode } from "./errors.js";

export interface LoadCapsuleResult {
  archive: ReadArchiveResult;
  manifest: CapsuleManifest;
  integrity: { declared: string | null; actual: string; match: boolean };
  /** True when the input was a self-opening `.capsule.html` wrapper. */
  wrapped: boolean;
}

/**
 * Load a `.capsule` archive, or a self-opening `.capsule.html` file (the
 * embedded archive is extracted and verified exactly like a bare archive).
 */
export async function loadCapsuleFromFile(
  path: string,
  options?: ReadArchiveOptions,
): Promise<LoadCapsuleResult> {
  const bytes = await fs.readFile(path);
  return loadCapsuleFromBuffer(bytes, options);
}

export async function loadCapsuleFromBuffer(
  buffer: Buffer | Uint8Array,
  options?: ReadArchiveOptions,
): Promise<LoadCapsuleResult> {
  const input = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const wrapped = looksLikeHtml(input);
  const archiveBytes = wrapped ? extractEmbeddedCapsule(input) : input;
  const archive = await readArchiveFromBuffer(archiveBytes, options);
  return finish(archive, wrapped);
}

function finish(archive: ReadArchiveResult, wrapped: boolean): LoadCapsuleResult {
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
    wrapped,
  };
}
