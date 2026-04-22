import { loadCapsuleFromFile } from "@capsule/core";

export async function inspect(argv: string[]): Promise<number> {
  const [file] = argv;
  if (!file) {
    process.stderr.write("usage: capsule inspect <file.capsule>\n");
    return 2;
  }

  const { manifest, archive, integrity } = await loadCapsuleFromFile(file);
  const out = process.stdout;

  out.write(`${manifest.name} ${manifest.version}\n`);
  out.write(`  slug:        ${manifest.slug}\n`);
  out.write(`  description: ${manifest.description}\n`);
  out.write(`  entry:       ${manifest.entry}\n`);
  if (manifest.author?.name) {
    out.write(`  author:      ${manifest.author.name}${manifest.author.url ? ` (${manifest.author.url})` : ""}\n`);
  }

  out.write("\nIntegrity:\n");
  out.write(`  declared: ${integrity.declared ?? "(none)"}\n`);
  out.write(`  computed: ${integrity.actual}\n`);
  out.write(`  status:   ${integrity.declared ? (integrity.match ? "ok" : "MISMATCH") : "unsigned"}\n`);

  out.write("\nCapabilities requested:\n");
  if (manifest.permissions.length === 0) {
    out.write("  (none)\n");
  } else {
    for (const p of manifest.permissions) {
      const scope = Array.isArray(p.scope) ? p.scope.join(", ") : p.scope;
      out.write(`  - ${p.capability} [${scope}] — ${p.reason}\n`);
    }
  }

  out.write("\nNetwork:\n");
  out.write(`  default: ${manifest.network.default}\n`);
  out.write(
    `  allow:   ${manifest.network.allow.length === 0 ? "(none)" : manifest.network.allow.join(", ")}\n`,
  );

  out.write("\nFiles:\n");
  const files = archive.entries
    .filter((e) => !e.isDirectory)
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  for (const f of files) {
    out.write(`  ${formatSize(f.uncompressedSize).padStart(8)}  ${f.path}\n`);
  }
  out.write(`\n${files.length} file(s), ${formatSize(totalSize(files))} uncompressed\n`);
  return 0;
}

function totalSize(files: { uncompressedSize: number }[]): number {
  return files.reduce((n, f) => n + f.uncompressedSize, 0);
}

function formatSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  return `${(n / 1024 / 1024).toFixed(2)}M`;
}
