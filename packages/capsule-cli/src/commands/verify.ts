import { loadCapsuleFromFile } from "@capsule/core";

export async function verify(argv: string[]): Promise<number> {
  const [file] = argv;
  if (!file) {
    process.stderr.write("usage: capsule verify <file.capsule>\n");
    return 2;
  }
  const { integrity, manifest } = await loadCapsuleFromFile(file);
  if (!integrity.declared) {
    process.stdout.write(
      `unsigned capsule ${manifest.slug}\n  computed: ${integrity.actual}\n`,
    );
    return 0;
  }
  if (integrity.match) {
    process.stdout.write(`ok  ${manifest.slug}  ${integrity.actual}\n`);
    return 0;
  }
  process.stderr.write(
    `MISMATCH ${manifest.slug}\n  declared: ${integrity.declared}\n  computed: ${integrity.actual}\n`,
  );
  return 1;
}
