import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  packArchive,
  loadCapsuleFromBuffer,
  readArchiveFromBuffer,
  computeContentHash,
} from "../src/index.js";
import { validManifest } from "./helpers.js";

const enc = new TextEncoder();

function baseFiles() {
  return [
    { path: "capsule.json", bytes: enc.encode(JSON.stringify(validManifest)) },
    { path: "content/index.html", bytes: enc.encode("<h1>hi</h1>") },
    { path: "assets/logo.svg", bytes: enc.encode("<svg/>") },
  ];
}

describe("packArchive", () => {
  it("stamps content_hash into manifest and round-trips load+verify", async () => {
    const res = await packArchive(baseFiles());
    expect(res.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(res.manifest.integrity?.content_hash).toBe(res.contentHash);

    const loaded = await loadCapsuleFromBuffer(Buffer.from(res.bytes));
    expect(loaded.integrity.match).toBe(true);
    expect(loaded.integrity.declared).toBe(res.contentHash);
  });

  it("produces byte-identical archives for identical inputs", async () => {
    const a = await packArchive(baseFiles());
    const b = await packArchive(baseFiles());
    const ha = createHash("sha256").update(a.bytes).digest("hex");
    const hb = createHash("sha256").update(b.bytes).digest("hex");
    expect(ha).toBe(hb);
  });

  it("produces the same content_hash regardless of input file ordering", async () => {
    const files = baseFiles();
    const reversed = [...files].reverse();
    const a = await packArchive(files);
    const b = await packArchive(reversed);
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("does not include signatures/ in the content hash", async () => {
    const withSig = [
      ...baseFiles(),
      { path: "signatures/capsule.sig.json", bytes: enc.encode('{"x":1}') },
    ];
    const a = await packArchive(baseFiles());
    const b = await packArchive(withSig);
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("hash stamped into manifest matches recomputed hash after read", async () => {
    const res = await packArchive(baseFiles());
    const archive = await readArchiveFromBuffer(Buffer.from(res.bytes));
    expect(computeContentHash(archive)).toBe(res.contentHash);
  });

  it("rejects duplicate input paths", async () => {
    await expect(
      packArchive([
        ...baseFiles(),
        { path: "content/index.html", bytes: enc.encode("<h1>duplicate</h1>") },
      ]),
    ).rejects.toThrow(/duplicate path/);
  });
});
