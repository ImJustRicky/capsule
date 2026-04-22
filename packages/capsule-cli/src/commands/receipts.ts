import { defaultReceiptPath, openReceiptLog } from "@capsule/runtime";

export async function receipts(argv: string[]): Promise<number> {
  const { limit, pathOverride, json } = parseArgs(argv);
  const filePath = pathOverride ?? defaultReceiptPath();
  const log = openReceiptLog(filePath);

  const records = await log.read(limit).catch((err) => {
    process.stderr.write(`failed to read receipts: ${err.message}\n`);
    return null;
  });
  if (!records) return 1;
  if (records.length === 0) {
    process.stdout.write(`no receipts recorded yet (${filePath})\n`);
    return 0;
  }

  if (json) {
    for (const r of records) process.stdout.write(JSON.stringify(r) + "\n");
    return 0;
  }

  process.stdout.write(`${filePath}\n\n`);
  for (const r of records) {
    const parts: string[] = [r.ts, r.slug, r.event];
    if (r.capability) parts.push(`${r.capability}${r.method ? `.${r.method}` : ""}`);
    if (r.scope !== undefined) {
      const s = Array.isArray(r.scope) ? r.scope.join(",") : String(r.scope);
      parts.push(`[${s}]`);
    }
    if (r.detail) parts.push(`— ${r.detail}`);
    process.stdout.write(parts.join("  ") + "\n");
  }
  process.stdout.write(`\n${records.length} record(s)\n`);
  return 0;
}

interface Args {
  limit: number | undefined;
  pathOverride: string | undefined;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  let limit: number | undefined;
  let pathOverride: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--json") json = true;
    else if (a === "--limit") limit = Number(argv[++i]);
    else if (a === "--path") pathOverride = argv[++i];
  }
  return { limit, pathOverride, json };
}
