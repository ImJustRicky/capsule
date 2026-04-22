import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import schema from "./manifest.schema.json" with { type: "json" };
import { CapsuleError, ErrorCode } from "./errors.js";
import { validateArchivePath } from "./paths.js";

export type CapabilityName =
  | "storage.local"
  | "filesystem.import"
  | "filesystem.export"
  | "clipboard.write"
  | "network.fetch"
  | "dialog.open";

export interface PermissionRequest {
  capability: CapabilityName;
  scope: string | string[];
  reason: string;
  required?: boolean;
}

export interface CapsuleManifest {
  capsule_version: "1.0";
  name: string;
  slug: string;
  version: string;
  description: string;
  entry: string;
  author?: { name?: string; id?: string; url?: string };
  permissions: PermissionRequest[];
  network: { default: "deny"; allow: string[] };
  features?: { required?: string[]; optional?: string[] };
  integrity?: { content_hash: string; algorithm: "sha256" };
  display?: {
    icon?: string;
    accent_color?: string;
    preferred_size?: { width: number; height: number };
  };
  license?: { name?: string; url?: string };
  source?: { url?: string; path?: string };
  privacy?: { summary?: string; data_stored?: string[]; data_shared?: string[] };
}

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
    throw new CapsuleError(ErrorCode.ManifestSchema, formatAjvErrors(validate.errors ?? []));
  }
  const manifest = raw as CapsuleManifest;
  validateArchivePath(manifest.entry);
  if (opts.entries && !opts.entries.has(manifest.entry)) {
    throw new CapsuleError(
      ErrorCode.ManifestEntryMissing,
      `entry file not present in archive: ${manifest.entry}`,
    );
  }
  return manifest;
}

function formatAjvErrors(errors: ErrorObject[]): string {
  if (errors.length === 0) return "manifest failed schema validation";
  return errors
    .map((e) => `${e.instancePath || "(root)"} ${e.message ?? "invalid"}`)
    .join("; ");
}
