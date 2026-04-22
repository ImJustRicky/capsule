import { promises as fs } from "node:fs";
import path from "node:path";
import { packArchive, type PackFile } from "@capsule/core";

export async function pack(argv: string[]): Promise<number> {
  const { dir, out } = parseArgs(argv);
  if (!dir) {
    process.stderr.write("usage: capsule pack <dir> [-o <out.capsule>]\n");
    return 2;
  }

  const absDir = path.resolve(dir);
  const stat = await fs.stat(absDir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    process.stderr.write(`not a directory: ${dir}\n`);
    return 1;
  }

  const files = await collectFiles(absDir, absDir);
  const result = await packArchive(files);

  const outPath = out ?? `${result.manifest.slug}.capsule`;
  await fs.writeFile(outPath, result.bytes);
  process.stdout.write(`packed ${outPath}\n  content_hash: ${result.contentHash}\n  size: ${result.bytes.byteLength} bytes\n`);
  return 0;
}

interface PackArgs {
  dir: string | undefined;
  out: string | undefined;
}

function parseArgs(argv: string[]): PackArgs {
  let dir: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-o" || a === "--out") {
      out = argv[++i];
    } else if (!dir) {
      dir = a;
    }
  }
  return { dir, out };
}

async function collectFiles(root: string, dir: string): Promise<PackFile[]> {
  const result: PackFile[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const entries = await fs.readdir(cur, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isSymbolicLink()) continue; // Never pack symlinks.
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      const rel = path.relative(root, full).split(path.sep).join("/");
      const bytes = await fs.readFile(full);
      result.push({ path: rel, bytes: new Uint8Array(bytes) });
    }
  }
  return result;
}
