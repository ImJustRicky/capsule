import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openReceiptLog } from "../src/receipts.js";

describe("receipts log", () => {
  it("appends JSON lines and reads them back", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "capsule-receipts-"));
    try {
      const file = path.join(tmp, "receipts.jsonl");
      const log = openReceiptLog(file);
      await log.append({
        ts: "2026-04-22T00:00:00Z",
        slug: "demo",
        content_hash: null,
        event: "run.start",
      });
      await log.append({
        ts: "2026-04-22T00:00:01Z",
        slug: "demo",
        content_hash: null,
        event: "grant",
        capability: "storage.local",
        method: "set",
      });
      const records = await log.read();
      expect(records.length).toBe(2);
      expect(records[0]!.event).toBe("run.start");
      expect(records[1]!.capability).toBe("storage.local");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("honors the limit argument (most-recent window)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "capsule-receipts-"));
    try {
      const file = path.join(tmp, "receipts.jsonl");
      const log = openReceiptLog(file);
      for (let i = 0; i < 10; i++) {
        await log.append({ ts: String(i), slug: "x", content_hash: null, event: "tick" });
      }
      const records = await log.read(3);
      expect(records.length).toBe(3);
      expect(records.map((r) => r.ts)).toEqual(["7", "8", "9"]);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("returns empty array when the log doesn't exist yet", async () => {
    const log = openReceiptLog("/tmp/nonexistent-" + Date.now() + ".jsonl");
    const records = await log.read();
    expect(records).toEqual([]);
  });
});
