import {
  CapsuleError,
  ErrorCode,
  extractEmbeddedCapsule,
  looksLikeHtml,
  type CapsuleManifest,
} from "@capsule/core/browser";
import { computeContentHash } from "./hash.js";
import { parseManifestBytes } from "./manifest.js";
import { readArchive, type ReadArchiveOptions, type ReadArchiveResult } from "./zip.js";

export interface LoadedCapsule {
  archive: ReadArchiveResult;
  manifest: CapsuleManifest;
  integrity: { declared: string | null; actual: string; match: boolean };
  /** True when the input was a self-opening `.capsule.html` wrapper. */
  wrapped: boolean;
  /** Size of the `.capsule` archive itself, in bytes. */
  archiveBytes: number;
}

/**
 * Browser twin of @capsule/core `loadCapsuleFromBuffer`: accepts a `.capsule`
 * archive or a self-opening `.capsule.html`, validates the archive and the
 * manifest, and refuses to load when a declared content hash does not match.
 */
export async function loadCapsule(
  input: Uint8Array,
  options: ReadArchiveOptions = {},
): Promise<LoadedCapsule> {
  const wrapped = looksLikeHtml(input);
  const bytes = wrapped ? extractEmbeddedCapsule(input) : input;
  const archive = await readArchive(bytes, options);

  const manifestEntry = archive.byPath.get("capsule.json");
  if (!manifestEntry || manifestEntry.isDirectory) {
    throw new CapsuleError(ErrorCode.ArchiveMissingManifest, "capsule.json is missing from archive");
  }
  const entries = new Set(archive.entries.filter((e) => !e.isDirectory).map((e) => e.path));
  const manifest = parseManifestBytes(manifestEntry.bytes, { entries });

  const actual = await computeContentHash(archive);
  const declared = manifest.integrity?.content_hash ?? null;
  if (declared && declared !== actual) {
    throw new CapsuleError(
      ErrorCode.IntegrityMismatch,
      `content hash mismatch: expected ${declared}, got ${actual}`,
    );
  }
  return {
    archive,
    manifest,
    integrity: { declared, actual, match: declared === null || declared === actual },
    wrapped,
    archiveBytes: bytes.byteLength,
  };
}
