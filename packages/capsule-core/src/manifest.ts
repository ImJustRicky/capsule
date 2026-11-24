import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import schema from "./manifest.schema.json" with { type: "json" };
import { CapsuleError, ErrorCode } from "./errors.js";
import { checkManifestSemantics, formatSchemaErrors } from "./manifest-checks.js";
import type { CapsuleManifest } from "./manifest-types.js";

export type { CapabilityName, PermissionRequest, CapsuleManifest } from "./manifest-types.js";

export const MANIFEST_SCHEMA = schema as unknown as Record<string, unknown>;

let cachedValidator: ValidateFunction<CapsuleManifest> | null = null;

function getValidator(): ValidateFunction<CapsuleManifest> {
  if (cachedValidator) return cachedValidator;
  const AjvCtor = (Ajv as unknown as { default?: typeof Ajv }).default ?? Ajv;
  const ajv = new AjvCtor({ allErrors: true, strict: false });
  const addFormatsFn = (addFormats as unknown as { default?: typeof addFormats }).default ?? addFormats;
  addFormatsFn(ajv);
  cachedValidator = ajv.compile<CapsuleManifest>(schema as object);
  return cachedValidator;
}

export interface ParseManifestOptions {
  /** Set of archive entry paths, used to verify `entry` points at a real file. */
  entries?: Set<string>;
}

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
  return parseManifestText(text, opts);
}

export function parseManifestText(
  text: string,
  opts: ParseManifestOptions = {},
): CapsuleManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new CapsuleError(
      ErrorCode.ManifestInvalidJson,
      `capsule.json is not valid JSON: ${(err as Error).message}`,
    );
  }
  const validate = getValidator();
  if (!validate(raw)) {
    throw new CapsuleError(ErrorCode.ManifestSchema, formatSchemaErrors(validate.errors ?? []));
  }
  const manifest = raw as CapsuleManifest;
  checkManifestSemantics(manifest, opts.entries ? { entries: opts.entries } : {});
  return manifest;
}
