import yazl from "yazl";

export interface BuildFile {
  path: string;
  content: string | Uint8Array;
  /** Unix mode bits (upper 16 of externalAttr). Default 0o100644 regular file. */
  mode?: number;
}

export function buildZip(files: BuildFile[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const f of files) {
      const bytes =
        typeof f.content === "string" ? Buffer.from(f.content, "utf-8") : Buffer.from(f.content);
      const mode = f.mode ?? 0o100644;
      zip.addBuffer(bytes, f.path, { mode });
    }
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (c: Buffer) => chunks.push(c));
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on("error", reject);
    zip.end();
  });
}

export const validManifest = {
  capsule_version: "1.0",
  name: "Test Capsule",
  slug: "test-capsule",
  version: "0.1.0",
  description: "A test capsule.",
  entry: "content/index.html",
  permissions: [],
  network: { default: "deny", allow: [] },
} as const;
