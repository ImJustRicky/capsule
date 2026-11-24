import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yazl from "yazl";
import { packArchive, type PackFile } from "@capsule/core";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export interface BuildFile {
  path: string;
  content: string | Uint8Array;
  mode?: number;
  compress?: boolean;
}

/** Raw ZIP via yazl, with no Capsule-level processing. */
export function buildZip(files: BuildFile[]): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const f of files) {
      if (f.path.endsWith("/")) {
        zip.addEmptyDirectory(f.path, { mode: 0o40755 });
        continue;
      }
      const bytes = typeof f.content === "string" ? Buffer.from(f.content, "utf-8") : Buffer.from(f.content);
      zip.addBuffer(bytes, f.path, { mode: f.mode ?? 0o100644, compress: f.compress ?? true });
    }
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (c: Buffer) => chunks.push(c));
    zip.outputStream.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
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

export function manifestFile(overrides: Record<string, unknown> = {}): BuildFile {
  return { path: "capsule.json", content: JSON.stringify({ ...validManifest, ...overrides }) };
}

/** Collect an example directory the same way `capsule pack` does. */
export async function collectDir(root: string): Promise<PackFile[]> {
  const result: PackFile[] = [];
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of await fs.readdir(cur, { withFileTypes: true })) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        result.push({
          path: path.relative(root, full).split(path.sep).join("/"),
          bytes: new Uint8Array(await fs.readFile(full)),
        });
      }
    }
  }
  return result;
}

export async function packExample(name: string): Promise<Uint8Array> {
  const { bytes } = await packArchive(await collectDir(path.join(REPO_ROOT, "examples", name)));
  return bytes;
}

export async function exampleNames(): Promise<string[]> {
  const dir = path.join(REPO_ROOT, "examples");
  const names: string[] = [];
  for (const name of (await fs.readdir(dir)).sort()) {
    if (await fs.stat(path.join(dir, name, "capsule.json")).catch(() => null)) names.push(name);
  }
  return names;
}

/** Replace every occurrence of `from` with same-length `to` (patches local + central names). */
export function replaceBytes(buf: Uint8Array, from: string, to: string): Uint8Array {
  if (from.length !== to.length) throw new Error("replacement must keep the length");
  const out = buf.slice();
  const f = Buffer.from(from);
  const t = Buffer.from(to);
  let hits = 0;
  for (let i = 0; i <= out.length - f.length; i++) {
    let match = true;
    for (let j = 0; j < f.length; j++) {
      if (out[i + j] !== f[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      out.set(t, i);
      hits++;
    }
  }
  if (hits === 0) throw new Error(`pattern not found: ${from}`);
  return out;
}

/** Offsets of every central directory header (signature PK\x01\x02). */
export function centralHeaders(buf: Uint8Array): number[] {
  const offsets: number[] = [];
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x01 && buf[i + 3] === 0x02) offsets.push(i);
  }
  return offsets;
}

export function eocdOffset(buf: Uint8Array): number {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) return i;
  }
  throw new Error("no EOCD");
}
