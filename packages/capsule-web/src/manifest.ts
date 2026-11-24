import {
  CapsuleError,
  ErrorCode,
  checkManifestSemantics,
  formatSchemaErrors,
  type CapsuleManifest,
} from "@capsule/core/browser";
// Generated at build time from @capsule/core's manifest.schema.json with Ajv's
// standalone compiler, so the browser enforces the exact same schema without
// needing `new Function` (which the viewer's CSP forbids).
import validateSchema from "./generated/manifest-validator.js";

export interface ParseManifestOptions {
  entries?: Set<string>;
}

/** Browser twin of @capsule/core `parseManifestBytes`; same errors, same rules. */
export function parseManifestBytes(
  bytes: Uint8Array,
  opts: ParseManifestOptions = {},
): CapsuleManifest {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CapsuleError(ErrorCode.ManifestInvalidJson, "capsule.json is not valid UTF-8");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new CapsuleError(
      ErrorCode.ManifestInvalidJson,
      `capsule.json is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (!validateSchema(raw)) {
    throw new CapsuleError(ErrorCode.ManifestSchema, formatSchemaErrors(validateSchema.errors ?? []));
  }
  const manifest = raw as CapsuleManifest;
  checkManifestSemantics(manifest, opts.entries ? { entries: opts.entries } : {});
  return manifest;
}
