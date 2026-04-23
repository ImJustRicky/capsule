import { CapsuleError, ErrorCode } from "./errors.js";

const WINDOWS_DRIVE = /^[a-zA-Z]:/;
const BACKSLASH = /\\/;

/**
 * Validate an archive entry path against ARCHIVE-FORMAT.md §Path Rules.
 * Throws CapsuleError with a code; returns normalized path on success.
 */
export function validateArchivePath(raw: string): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new CapsuleError(ErrorCode.PathEmpty, "archive path is empty");
  }
  if (raw.includes("\0")) {
    throw new CapsuleError(ErrorCode.PathNul, `path contains NUL byte: ${JSON.stringify(raw)}`);
  }
  if (BACKSLASH.test(raw)) {
    throw new CapsuleError(
      ErrorCode.PathSeparator,
      `path must use forward slashes: ${JSON.stringify(raw)}`,
    );
  }
  if (raw.startsWith("/")) {
    throw new CapsuleError(ErrorCode.PathAbsolute, `path must be relative: ${JSON.stringify(raw)}`);
  }
  if (WINDOWS_DRIVE.test(raw)) {
    throw new CapsuleError(
      ErrorCode.PathDrivePrefix,
      `path has Windows drive prefix: ${JSON.stringify(raw)}`,
    );
  }
  const segments = raw.split("/");
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const isTrailingDirectoryMarker = segment === "" && i === segments.length - 1 && raw.endsWith("/");
    if (segment === "" && !isTrailingDirectoryMarker) {
      throw new CapsuleError(
        ErrorCode.PathEmptySegment,
        `path contains an empty segment: ${JSON.stringify(raw)}`,
      );
    }
    if (segment === ".") {
      throw new CapsuleError(
        ErrorCode.PathDotSegment,
        `path contains '.' segment: ${JSON.stringify(raw)}`,
      );
    }
    if (segment === "..") {
      throw new CapsuleError(
        ErrorCode.PathTraversal,
        `path contains '..' segment: ${JSON.stringify(raw)}`,
      );
    }
  }
  return raw;
}

export function isDirectoryEntry(path: string): boolean {
  return path.endsWith("/");
}
