export class CapsuleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CapsuleError";
    this.code = code;
  }
}

export const ErrorCode = {
  PathEmpty: "path.empty",
  PathAbsolute: "path.absolute",
  PathTraversal: "path.traversal",
  PathDrivePrefix: "path.drive_prefix",
  PathNul: "path.nul",
  PathSeparator: "path.separator",
  PathNotUtf8: "path.not_utf8",
  ArchiveSymlink: "archive.symlink",
  ArchiveUnsupportedCompression: "archive.unsupported_compression",
  ArchiveMissingManifest: "archive.missing_manifest",
  ArchiveSizeLimit: "archive.size_limit",
  ArchiveRatioLimit: "archive.ratio_limit",
  ManifestInvalidJson: "manifest.invalid_json",
  ManifestSchema: "manifest.schema",
  ManifestEntryMissing: "manifest.entry_missing",
  IntegrityMismatch: "integrity.mismatch",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
