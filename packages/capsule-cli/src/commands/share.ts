import { promises as fs } from "node:fs";
import path from "node:path";
import {
  extractEmbeddedCapsule,
  loadCapsuleFromBuffer,
  looksLikeHtml,
  type CapsuleManifest,
} from "@capsule/core";
import { buildSelfOpeningHtml } from "@capsule/web";
import { displayPath } from "../display-path.js";

const USAGE = `usage: capsule share <file.capsule> [-o <out.capsule.html>] [--force]

Wrap a capsule in the Capsule browser viewer, producing one .capsule.html
file that opens in any modern browser with nothing to install. The original
archive is embedded unchanged, so anyone can still verify it with
\`capsule inspect\` or the hosted viewer.
`;

interface ShareArgs {
  file: string | undefined;
  out: string | undefined;
  force: boolean;
  help: boolean;
  error: string | null;
}

export async function share(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (args.error || !args.file) {
    process.stderr.write(`${args.error ? `${args.error}\n\n` : ""}${USAGE}`);
    return 2;
  }

  const input = new Uint8Array(await fs.readFile(args.file));
  const archiveBytes = looksLikeHtml(input) ? extractEmbeddedCapsule(input) : input;
  // Full validation (archive rules, manifest schema, declared hash) before we
  // put our viewer's name on it.
  const { manifest } = await loadCapsuleFromBuffer(archiveBytes);

  const outPath = path.resolve(args.out ?? defaultSharePath(args.file));
  const written = await writeSelfOpeningHtml(archiveBytes, manifest, outPath, args.force);
  if (!written.ok) {
    process.stderr.write(written.message);
    return 1;
  }
  process.stdout.write(
    [
      `shared ${prettyPath(outPath)}`,
      `  name: ${manifest.name}`,
      `  size: ${formatBytes(written.size)}`,
      "Send this file to anyone: it opens in any modern browser, nothing to install.",
      `Recipients who want to check it with their own tools can run: capsule inspect ${shellQuote(prettyPath(outPath))}`,
      "",
    ].join("\n"),
  );
  return 0;
}

export type WriteResult = { ok: true; size: number } | { ok: false; message: string };

/** Shared by `capsule share` and `capsule make --html`. */
export async function writeSelfOpeningHtml(
  archiveBytes: Uint8Array,
  manifest: CapsuleManifest,
  outPath: string,
  force: boolean,
): Promise<WriteResult> {
  if (!/\.html?$/i.test(outPath)) {
    return { ok: false, message: "self-opening output must end in .html (e.g. name.capsule.html)\n" };
  }
  if (!force && (await fs.stat(outPath).catch(() => null))) {
    return {
      ok: false,
      message:
        `output already exists: ${prettyPath(outPath)}\n` +
        "Use --force to overwrite it, or pass -o <new-name.capsule.html>.\n",
    };
  }
  const html = await buildSelfOpeningHtml(archiveBytes, `${manifest.name} · Capsule`);
  await fs.writeFile(outPath, html);
  return { ok: true, size: Buffer.byteLength(html) };
}

export function defaultSharePath(file: string): string {
  const base = file.replace(/\.capsule\.html?$/i, "").replace(/\.capsule$/i, "");
  return `${base}.capsule.html`;
}

function parseArgs(argv: string[]): ShareArgs {
  const out: ShareArgs = { file: undefined, out: undefined, force: false, help: false, error: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--force") out.force = true;
    else if (a === "-o" || a === "--out") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) out.error = `${a} requires a value`;
      else out.out = value;
    } else if (a.startsWith("-")) out.error = `unknown option: ${a}`;
    else if (!out.file) out.file = a;
    else out.error = `unexpected argument: ${a}`;
    if (out.error) break;
  }
  return out;
}

function prettyPath(filePath: string): string {
  return displayPath(filePath);
}

function shellQuote(p: string): string {
  return /\s/.test(p) ? JSON.stringify(p) : p;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
