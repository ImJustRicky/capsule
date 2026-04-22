import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Append-only local receipts log. Each line is a compact JSON object —
 * easy to inspect with `tail` or parse with `jq`. The log lives outside the
 * capsule archive; runtimes MUST NOT write back into the archive.
 *
 * Path: $XDG_STATE_HOME/capsule/receipts.jsonl on Linux
 *       ~/Library/Application Support/capsule/receipts.jsonl on macOS
 *       %LOCALAPPDATA%/capsule/receipts.jsonl on Windows
 *       falls back to ~/.capsule/receipts.jsonl
 */

export interface ReceiptRecord {
  /** ISO timestamp. */
  ts: string;
  /** Capsule slug from the manifest. */
  slug: string;
  /** Declared content hash if any, else null. */
  content_hash: string | null;
  /** One of: "run.start", "run.end", "request", "grant", "deny". */
  event: string;
  /** Capability name if relevant. */
  capability?: string;
  /** Capability method if relevant. */
  method?: string;
  /** Scope recorded with the decision. */
  scope?: string | string[];
  /** Host session token prefix (first 6 chars) — lets you correlate without logging full tokens. */
  session?: string;
  /** Free-form detail. */
  detail?: string;
}

export interface ReceiptLog {
  path: string;
  append(record: ReceiptRecord): Promise<void>;
  /** Read recent records, newest last. */
  read(limit?: number): Promise<ReceiptRecord[]>;
}

export function defaultReceiptPath(): string {
  const plat = process.platform;
  const home = os.homedir();
  const override = process.env.CAPSULE_RECEIPTS_PATH;
  if (override) return override;
  let base: string;
  if (plat === "darwin") {
    base = path.join(home, "Library", "Application Support", "capsule");
  } else if (plat === "win32") {
    base = process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "capsule")
      : path.join(home, "AppData", "Local", "capsule");
  } else {
    const xdg = process.env.XDG_STATE_HOME;
    base = xdg ? path.join(xdg, "capsule") : path.join(home, ".local", "state", "capsule");
  }
  return path.join(base, "receipts.jsonl");
}

export function openReceiptLog(filePath: string = defaultReceiptPath()): ReceiptLog {
  return {
    path: filePath,
    async append(record) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, JSON.stringify(record) + "\n", "utf8");
    },
    async read(limit?: number) {
      const text = await fs.readFile(filePath, "utf8").catch((err) => {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw err;
      });
      const lines = text.split("\n").filter((l) => l.length > 0);
      const slice = limit ? lines.slice(-limit) : lines;
      const out: ReceiptRecord[] = [];
      for (const line of slice) {
        try {
          out.push(JSON.parse(line) as ReceiptRecord);
        } catch {
          // Skip malformed lines — the log is best-effort forensics, not authoritative.
        }
      }
      return out;
    },
  };
}
