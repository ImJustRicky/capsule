import { CapsuleError, ErrorCode } from "./errors.js";
import type { CapsuleManifest } from "./manifest-types.js";
import { validateArchivePath } from "./paths.js";

/**
 * Semantic manifest checks that JSON Schema cannot express. Shared by the
 * Node reference implementation and the browser viewer, which each run their
 * own (equivalent) schema validator first.
 */

export const SUPPORTED_REQUIRED_FEATURES: ReadonlySet<string> = new Set([
  "archive.zip",
  "manifest.1.0",
  "sandbox.web",
  "integrity.sha256",
  "capability.storage.local",
  "capability.filesystem.import",
  "capability.filesystem.export",
  "capability.clipboard.write",
  "capability.network.fetch",
  "capability.dialog.open",
]);

export interface ManifestSemanticOptions {
  /** Set of archive entry paths, used to verify `entry` points at a real file. */
  entries?: Set<string>;
  /** Features this runtime supports. Defaults to SUPPORTED_REQUIRED_FEATURES. */
  supportedFeatures?: ReadonlySet<string>;
}

export function checkManifestSemantics(
  manifest: CapsuleManifest,
  opts: ManifestSemanticOptions = {},
): void {
  validateArchivePath(manifest.entry);
  const supported = opts.supportedFeatures ?? SUPPORTED_REQUIRED_FEATURES;
  const unsupported = (manifest.features?.required ?? []).filter(
    (feature) => !supported.has(feature),
  );
  if (unsupported.length > 0) {
    throw new CapsuleError(
      ErrorCode.ManifestSchema,
      `unsupported required feature(s): ${unsupported.join(", ")}`,
    );
  }
  if (opts.entries && !opts.entries.has(manifest.entry)) {
    throw new CapsuleError(
      ErrorCode.ManifestEntryMissing,
      `entry file not present in archive: ${manifest.entry}`,
    );
  }
}

/** Format JSON-Schema (Ajv-shaped) errors into one readable line. */
export function formatSchemaErrors(
  errors: ReadonlyArray<{ instancePath?: string; message?: string }>,
): string {
  if (errors.length === 0) return "manifest failed schema validation";
  return errors.map((e) => `${e.instancePath || "(root)"} ${e.message ?? "invalid"}`).join("; ");
}
