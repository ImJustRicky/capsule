import { promises as fs } from "node:fs";
import yauzl from "yauzl";
import { CapsuleError, ErrorCode } from "./errors.js";
import { isDirectoryEntry, validateArchivePath } from "./paths.js";

/** ZIP external-attribute bits for symbolic link (Unix file type 0xA000). */
const UNIX_SYMLINK_MODE = 0xa000;

export interface ArchiveEntry {
  path: string;
  /** Decompressed bytes. Directory entries have zero-length bytes. */
  bytes: Uint8Array;
  compressedSize: number;
  uncompressedSize: number;
  isDirectory: boolean;
}

export interface ReadArchiveOptions {
  /** Warn threshold (uncompressed) — currently informational only. */
  warnUncompressedBytes?: number;
  /** Hard cap on total uncompressed size; throws if exceeded. */
  maxUncompressedBytes?: number;
  /** Hard cap on compression ratio (uncompressed / compressed). */
  maxCompressionRatio?: number;
}

const DEFAULT_OPTIONS: Required<ReadArchiveOptions> = {
  warnUncompressedBytes: 250 * 1024 * 1024,
  maxUncompressedBytes: 1024 * 1024 * 1024,
  maxCompressionRatio: 200,
};

export interface ReadArchiveResult {
  entries: ArchiveEntry[];
  byPath: Map<string, ArchiveEntry>;
}

export async function readArchiveFromFile(
  filePath: string,
  options: ReadArchiveOptions = {},
): Promise<ReadArchiveResult> {
  const bytes = await fs.readFile(filePath);
  return readArchiveFromBuffer(bytes, options);
}

export function readArchiveFromBuffer(
  buffer: Buffer | Uint8Array,
  options: ReadArchiveOptions = {},
): Promise<ReadArchiveResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("failed to open archive"));
      const entries: ArchiveEntry[] = [];
      const seenPaths = new Set<string>();
      let totalUncompressed = 0;
      let totalCompressed = 0;

      zip.on("error", reject);
      zip.on("end", () => {
        if (opts.maxCompressionRatio > 0 && totalCompressed > 0) {
          const ratio = totalUncompressed / totalCompressed;
          if (ratio > opts.maxCompressionRatio) {
            return reject(
              new CapsuleError(
                ErrorCode.ArchiveRatioLimit,
                `archive compression ratio ${ratio.toFixed(1)} exceeds limit ${opts.maxCompressionRatio}`,
              ),
            );
          }
        }
        const byPath = new Map(entries.map((e) => [e.path, e] as const));
        resolve({ entries, byPath });
      });

      zip.on("entry", (entry: yauzl.Entry) => {
        try {
          const rawName = entry.fileName;
          const externalAttr = (entry.externalFileAttributes ?? 0) >>> 16;
          if ((externalAttr & 0xf000) === UNIX_SYMLINK_MODE) {
            throw new CapsuleError(
              ErrorCode.ArchiveSymlink,
              `archive contains symlink: ${rawName}`,
            );
          }
          if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
            throw new CapsuleError(
              ErrorCode.ArchiveUnsupportedCompression,
              `unsupported ZIP compression method ${entry.compressionMethod} for ${rawName}`,
            );
          }
          validateArchivePath(rawName);
          if (seenPaths.has(rawName)) {
            throw new CapsuleError(
              ErrorCode.ArchiveDuplicatePath,
              `archive contains duplicate path: ${rawName}`,
            );
          }
          seenPaths.add(rawName);
          const isDir = isDirectoryEntry(rawName);
          totalUncompressed += entry.uncompressedSize;
          totalCompressed += entry.compressedSize;
          if (totalUncompressed > opts.maxUncompressedBytes) {
            throw new CapsuleError(
              ErrorCode.ArchiveSizeLimit,
              `archive uncompressed size exceeds ${opts.maxUncompressedBytes} bytes`,
            );
          }
          if (isDir) {
            entries.push({
              path: rawName,
              bytes: new Uint8Array(0),
              compressedSize: entry.compressedSize,
              uncompressedSize: entry.uncompressedSize,
              isDirectory: true,
            });
            zip.readEntry();
            return;
          }
          zip.openReadStream(entry, (readErr, stream) => {
            if (readErr || !stream) {
              return reject(readErr ?? new Error(`failed to read ${rawName}`));
            }
            const chunks: Buffer[] = [];
            stream.on("data", (c: Buffer) => chunks.push(c));
            stream.on("end", () => {
              entries.push({
                path: rawName,
                bytes: new Uint8Array(Buffer.concat(chunks)),
                compressedSize: entry.compressedSize,
                uncompressedSize: entry.uncompressedSize,
                isDirectory: false,
              });
              zip.readEntry();
            });
            stream.on("error", reject);
          });
        } catch (entryErr) {
          reject(entryErr);
        }
      });

      zip.readEntry();
    });
  });
}

export interface LoadedCapsule {
  archive: ReadArchiveResult;
  manifestBytes: Uint8Array;
}

export function requireManifestEntry(archive: ReadArchiveResult): Uint8Array {
  const manifest = archive.byPath.get("capsule.json");
  if (!manifest || manifest.isDirectory) {
    throw new CapsuleError(ErrorCode.ArchiveMissingManifest, "capsule.json is missing from archive");
  }
  return manifest.bytes;
}
