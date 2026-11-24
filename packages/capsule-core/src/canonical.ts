import { CapsuleError, ErrorCode } from "./errors.js";

/**
 * Canonical content-hash serialization, shared by every Capsule runtime.
 *
 * This module is deliberately free of Node.js APIs so the exact same bytes
 * are produced by the Node reference implementation (which feeds them to
 * `node:crypto`) and by the browser viewer (which feeds them to WebCrypto).
 * See SIGNING-AND-INTEGRITY.md for the normative description.
 *
 * Scope:
 *   - capsule.json with `integrity` stripped and keys sorted (canonical JSON)
 *   - content/** assets/** metadata/** source/**
 * Excluded: signatures/**, receipts/**, directory entries, anything else.
 *
 * Canonical serialization per entry:
 *   "<path>\n<uncompressed length>\n"  ||  <bytes>  ||  "\n"
 * Entries are processed in ascending path order (UTF-16 code unit order,
 * which equals UTF-8 byte order for the ASCII paths V1 archives contain).
 */

export const HASH_INCLUDED_PREFIXES = ["content/", "assets/", "metadata/", "source/"] as const;
export const HASH_EXCLUDED_PREFIXES = ["signatures/", "receipts/"] as const;

/** The minimal entry shape needed for hashing. Both archive readers produce it. */
export interface HashableEntry {
  path: string;
  bytes: Uint8Array;
  isDirectory: boolean;
}

const encoder = new TextEncoder();
const NEWLINE = encoder.encode("\n");

export function isHashableEntry(entry: HashableEntry): boolean {
  if (entry.isDirectory) return false;
  if (entry.path === "capsule.json") return false;
  if (HASH_EXCLUDED_PREFIXES.some((p) => entry.path.startsWith(p))) return false;
  return HASH_INCLUDED_PREFIXES.some((p) => entry.path.startsWith(p));
}

/**
 * Produce the ordered list of byte chunks whose concatenation is the input to
 * SHA-256. Callers choose the hash backend.
 */
export function contentHashChunks(entries: readonly HashableEntry[]): Uint8Array[] {
  const manifest = entries.find((e) => e.path === "capsule.json" && !e.isDirectory);
  if (!manifest) {
    throw new CapsuleError(
      ErrorCode.ArchiveMissingManifest,
      "cannot hash archive without capsule.json",
    );
  }
  const chunks: Uint8Array[] = [];
  pushEntry(chunks, "capsule.json", canonicalManifestBytes(manifest.bytes));

  const inScope = entries
    .filter(isHashableEntry)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const entry of inScope) {
    pushEntry(chunks, entry.path, entry.bytes);
  }
  return chunks;
}

function pushEntry(chunks: Uint8Array[], path: string, bytes: Uint8Array): void {
  chunks.push(encoder.encode(`${path}\n${bytes.byteLength}\n`));
  chunks.push(bytes);
  chunks.push(NEWLINE);
}

export function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * Strip `integrity` and re-serialize with sorted keys so the hash is stable
 * regardless of whether `content_hash` has been written back yet.
 */
export function canonicalManifestBytes(raw: Uint8Array): Uint8Array {
  let text: string;
  let parsed: Record<string, unknown>;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    throw new CapsuleError(
      ErrorCode.ManifestInvalidJson,
      `capsule.json is not valid UTF-8 JSON: ${(err as Error).message}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CapsuleError(ErrorCode.ManifestInvalidJson, "capsule.json must be a JSON object");
  }
  delete parsed.integrity;
  return encoder.encode(canonicalJsonStringify(parsed));
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

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, "0");
  return out;
}
