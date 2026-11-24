import { CapsuleError, ErrorCode, isDirectoryEntry, validateArchivePath } from "@capsule/core/browser";

/**
 * Dependency-free ZIP reader for browsers (and Node ≥ 18, which is how it is
 * unit-tested against the reference packer). Decompression uses the platform
 * `DecompressionStream("deflate-raw")`.
 *
 * It enforces the same archive rules as the Node reader in @capsule/core
 * (ARCHIVE-FORMAT.md): path rules, no symlinks, no duplicate paths, only
 * stored/deflate, total-size and compression-ratio limits. It is stricter in
 * a few places a browser cannot afford to be lax: entries may not overlap,
 * every entry's decompressed length and CRC-32 must match the central
 * directory, decompression stops the moment output exceeds the declared size,
 * and ZIP64 / multi-disk / encrypted archives are rejected.
 */

export interface ArchiveEntry {
  path: string;
  /** Decompressed bytes. Directory entries have zero-length bytes. */
  bytes: Uint8Array;
  compressedSize: number;
  uncompressedSize: number;
  isDirectory: boolean;
}

export interface ReadArchiveResult {
  entries: ArchiveEntry[];
  byPath: Map<string, ArchiveEntry>;
}

export interface ReadArchiveOptions {
  /** Hard cap on total uncompressed size. */
  maxUncompressedBytes?: number;
  /** Hard cap on compression ratio (uncompressed / compressed). */
  maxCompressionRatio?: number;
  /** Hard cap on the number of entries. */
  maxEntries?: number;
}

export const DEFAULT_ARCHIVE_LIMITS: Required<ReadArchiveOptions> = {
  // Lower than the Node reader's 1 GiB: everything is held in tab memory.
  maxUncompressedBytes: 256 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxEntries: 10_000,
};

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EOCD_MIN = 22;
const CENTRAL_MIN = 46;
const LOCAL_MIN = 30;
const UNIX_FILE_TYPE_MASK = 0xf000;
const UNIX_SYMLINK = 0xa000;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8 = 0x0800;

interface CentralRecord {
  path: string;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function malformed(message: string): CapsuleError {
  return new CapsuleError(ErrorCode.ArchiveMalformed, message);
}

export async function readArchive(
  input: Uint8Array,
  options: ReadArchiveOptions = {},
): Promise<ReadArchiveResult> {
  const opts = { ...DEFAULT_ARCHIVE_LIMITS, ...options };
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);

  const eocdOffset = findEndOfCentralDirectory(input, view);
  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);

  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw malformed("ZIP64 archives are not supported");
  }
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw malformed("multi-disk archives are not supported");
  }
  if (entryCount > opts.maxEntries) {
    throw new CapsuleError(
      ErrorCode.ArchiveSizeLimit,
      `archive has ${entryCount} entries; limit is ${opts.maxEntries}`,
    );
  }
  if (centralOffset + centralSize > eocdOffset) {
    throw malformed("central directory extends past end-of-central-directory record");
  }

  // ---- Pass 1: central directory, cheap checks before any decompression.
  const records: CentralRecord[] = [];
  const seen = new Set<string>();
  let totalUncompressed = 0;
  let totalCompressed = 0;
  let p = centralOffset;
  for (let n = 0; n < entryCount; n++) {
    if (p + CENTRAL_MIN > centralOffset + centralSize) {
      throw malformed("central directory is truncated");
    }
    if (view.getUint32(p, true) !== SIG_CENTRAL) {
      throw malformed("bad central directory signature");
    }
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc32 = view.getUint32(p + 16, true);
    const compressedSize = view.getUint32(p + 20, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const externalAttributes = view.getUint32(p + 38, true);
    const localOffset = view.getUint32(p + 42, true);
    const nameEnd = p + CENTRAL_MIN + nameLength;
    if (nameEnd > centralOffset + centralSize) throw malformed("central directory is truncated");
    const path = decodeName(input.subarray(p + CENTRAL_MIN, nameEnd), flags);
    p = nameEnd + extraLength + commentLength;

    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      throw malformed(`ZIP64 entry is not supported: ${path}`);
    }
    if ((externalAttributes >>> 16 & UNIX_FILE_TYPE_MASK) === UNIX_SYMLINK) {
      throw new CapsuleError(ErrorCode.ArchiveSymlink, `archive contains symlink: ${path}`);
    }
    if (flags & FLAG_ENCRYPTED) {
      throw new CapsuleError(ErrorCode.ArchiveEncrypted, `archive entry is encrypted: ${path}`);
    }
    if (method !== 0 && method !== 8) {
      throw new CapsuleError(
        ErrorCode.ArchiveUnsupportedCompression,
        `unsupported ZIP compression method ${method} for ${path}`,
      );
    }
    validateArchivePath(path);
    if (seen.has(path)) {
      throw new CapsuleError(ErrorCode.ArchiveDuplicatePath, `archive contains duplicate path: ${path}`);
    }
    seen.add(path);
    if (method === 0 && compressedSize !== uncompressedSize) {
      throw malformed(`stored entry has mismatched sizes: ${path}`);
    }
    totalUncompressed += uncompressedSize;
    totalCompressed += compressedSize;
    if (totalUncompressed > opts.maxUncompressedBytes) {
      throw new CapsuleError(
        ErrorCode.ArchiveSizeLimit,
        `archive uncompressed size exceeds ${opts.maxUncompressedBytes} bytes`,
      );
    }
    records.push({ path, method, crc32, compressedSize, uncompressedSize, localOffset });
  }

  if (opts.maxCompressionRatio > 0 && totalCompressed > 0) {
    const ratio = totalUncompressed / totalCompressed;
    if (ratio > opts.maxCompressionRatio) {
      throw new CapsuleError(
        ErrorCode.ArchiveRatioLimit,
        `archive compression ratio ${ratio.toFixed(1)} exceeds limit ${opts.maxCompressionRatio}`,
      );
    }
  }

  // ---- Pass 2: locate each entry's data and reject overlapping entries
  // (the "overlapping files" zip-bomb construction).
  const spans = records.map((record) => {
    const lo = record.localOffset;
    if (lo + LOCAL_MIN > centralOffset) throw malformed(`local header out of range: ${record.path}`);
    if (view.getUint32(lo, true) !== SIG_LOCAL) {
      throw malformed(`bad local header signature: ${record.path}`);
    }
    const dataStart = lo + LOCAL_MIN + view.getUint16(lo + 26, true) + view.getUint16(lo + 28, true);
    const dataEnd = dataStart + record.compressedSize;
    if (dataEnd > centralOffset) throw malformed(`entry data out of range: ${record.path}`);
    return { record, headerStart: lo, dataStart, dataEnd };
  });
  const ordered = [...spans].sort((a, b) => a.headerStart - b.headerStart);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i]!.headerStart < ordered[i - 1]!.dataEnd) {
      throw malformed(`archive entries overlap: ${ordered[i]!.record.path}`);
    }
  }

  // ---- Pass 3: decompress and verify.
  const entries: ArchiveEntry[] = [];
  for (const { record, dataStart, dataEnd } of spans) {
    const isDirectory = isDirectoryEntry(record.path);
    let bytes: Uint8Array;
    if (isDirectory) {
      bytes = new Uint8Array(0);
    } else {
      const raw = input.subarray(dataStart, dataEnd);
      bytes = record.method === 0
        ? raw.slice()
        : await inflateRaw(raw, record.uncompressedSize, record.path);
      if (crc32(bytes) !== record.crc32) {
        throw new CapsuleError(ErrorCode.ArchiveCrcMismatch, `CRC-32 mismatch for ${record.path}`);
      }
    }
    entries.push({
      path: record.path,
      bytes,
      compressedSize: record.compressedSize,
      uncompressedSize: record.uncompressedSize,
      isDirectory,
    });
  }

  return { entries, byPath: new Map(entries.map((e) => [e.path, e] as const)) };
}

function findEndOfCentralDirectory(input: Uint8Array, view: DataView): number {
  if (input.byteLength < EOCD_MIN) throw malformed("file is too small to be a ZIP archive");
  const lowest = Math.max(0, input.byteLength - EOCD_MIN - 0xffff);
  for (let i = input.byteLength - EOCD_MIN; i >= lowest; i--) {
    if (view.getUint32(i, true) !== SIG_EOCD) continue;
    const commentLength = view.getUint16(i + 20, true);
    if (i + EOCD_MIN + commentLength === input.byteLength) return i;
  }
  throw malformed("not a ZIP archive (no end-of-central-directory record)");
}

function decodeName(bytes: Uint8Array, flags: number): string {
  if (flags & FLAG_UTF8) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new CapsuleError(ErrorCode.PathNotUtf8, "archive path is not valid UTF-8");
    }
  }
  // Without the UTF-8 flag the name is CP437. Only ASCII is identical in
  // both encodings, and only ASCII hashes identically across runtimes.
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i]! >= 0x80) {
      throw new CapsuleError(
        ErrorCode.PathNotUtf8,
        "non-ASCII archive path without the UTF-8 flag is not supported",
      );
    }
  }
  return String.fromCharCode(...bytes);
}

async function inflateRaw(data: Uint8Array, expected: number, path: string): Promise<Uint8Array> {
  const out = new Uint8Array(expected);
  let offset = 0;
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > expected) {
        throw malformed(`entry inflates past its declared size: ${path}`);
      }
      out.set(value, offset);
      offset += value.byteLength;
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    if (err instanceof CapsuleError) throw err;
    throw malformed(`entry is not valid deflate data: ${path}`);
  }
  if (offset !== expected) throw malformed(`entry is shorter than its declared size: ${path}`);
  return out;
}

let CRC_TABLE: Uint32Array | null = null;

export function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
