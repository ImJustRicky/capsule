import { describe, expect, it } from "vitest";
import { CapsuleError } from "@capsule/core";
import { loadCapsule } from "../src/load.js";
import { crc32, readArchive } from "../src/zip.js";
import { buildZip, centralHeaders, eocdOffset, manifestFile, replaceBytes } from "./helpers.js";

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toSatisfy((err: unknown) => {
    if (!(err instanceof CapsuleError)) throw err;
    expect(err.code).toBe(code);
    return true;
  });
}

const index = { path: "content/index.html", content: "<!doctype html><p>ok</p>" };

describe("browser ZIP reader: archive rules", () => {
  it("rejects path traversal", async () => {
    const zip = await buildZip([manifestFile(), index, { path: "aa/evil.txt", content: "x" }]);
    await expectCode(readArchive(replaceBytes(zip, "aa/evil.txt", "../evil.txt")), "path.traversal");
  });

  it("rejects absolute paths", async () => {
    const zip = await buildZip([manifestFile(), index, { path: "xetc/passwd", content: "x" }]);
    await expectCode(readArchive(replaceBytes(zip, "xetc/passwd", "/etc/passwd")), "path.absolute");
  });

  it("rejects backslash separators", async () => {
    const zip = await buildZip([manifestFile(), index, { path: "a_b.txt", content: "x" }]);
    await expectCode(readArchive(replaceBytes(zip, "a_b.txt", "a\\b.txt")), "path.separator");
  });

  it("rejects symlinks", async () => {
    const zip = await buildZip([manifestFile(), index, { path: "content/link", content: "/etc/passwd", mode: 0o120777 }]);
    await expectCode(readArchive(zip), "archive.symlink");
  });

  it("rejects duplicate paths", async () => {
    const zip = await buildZip([manifestFile(), index, { path: "dup1.txt", content: "a" }, { path: "dup2.txt", content: "b" }]);
    await expectCode(readArchive(replaceBytes(zip, "dup2.txt", "dup1.txt")), "archive.duplicate_path");
  });

  it("rejects unsupported compression methods", async () => {
    const zip = (await buildZip([manifestFile(), index])).slice();
    const view = new DataView(zip.buffer);
    const central = centralHeaders(zip)[1]!;
    view.setUint16(central + 10, 12, true); // bzip2
    await expectCode(readArchive(zip), "archive.unsupported_compression");
  });

  it("rejects encrypted entries", async () => {
    const zip = (await buildZip([manifestFile(), index])).slice();
    const view = new DataView(zip.buffer);
    const central = centralHeaders(zip)[0]!;
    view.setUint16(central + 8, view.getUint16(central + 8, true) | 1, true);
    await expectCode(readArchive(zip), "archive.encrypted");
  });

  it("rejects archives over the uncompressed size limit", async () => {
    const zip = await buildZip([manifestFile(), index, { path: "content/big.txt", content: "a".repeat(4096) }]);
    await expectCode(readArchive(zip, { maxUncompressedBytes: 1024, maxCompressionRatio: 0 }), "archive.size_limit");
  });

  it("rejects compression bombs by ratio before inflating", async () => {
    const zip = await buildZip([manifestFile(), { path: "content/zeros.bin", content: new Uint8Array(4 * 1024 * 1024) }]);
    await expectCode(readArchive(zip), "archive.ratio_limit");
  });

  it("rejects too many entries", async () => {
    const files = [manifestFile(), index, ...Array.from({ length: 5 }, (_, i) => ({ path: `content/f${i}.txt`, content: "x" }))];
    await expectCode(readArchive(await buildZip(files), { maxEntries: 3 }), "archive.size_limit");
  });

  it("rejects CRC mismatches", async () => {
    const zip = await buildZip([manifestFile(), { path: "content/data.txt", content: "HELLO-CAPSULE", compress: false }]);
    await expectCode(readArchive(replaceBytes(zip, "HELLO-CAPSULE", "HELLO-CAPSULF")), "archive.crc_mismatch");
  });

  it("rejects entries that inflate past their declared size", async () => {
    const zip = (await buildZip([manifestFile(), { path: "content/data.txt", content: "x".repeat(300) }])).slice();
    const view = new DataView(zip.buffer);
    const central = centralHeaders(zip)[1]!;
    view.setUint32(central + 24, 10, true); // claim 10 bytes uncompressed
    await expectCode(readArchive(zip, { maxCompressionRatio: 0 }), "archive.malformed");
  });

  it("rejects overlapping entries", async () => {
    const zip = (await buildZip([manifestFile(), { path: "content/a.txt", content: "aaaa" }, { path: "content/b.txt", content: "bbbb" }])).slice();
    const view = new DataView(zip.buffer);
    const [, a, b] = centralHeaders(zip);
    view.setUint32(b! + 42, view.getUint32(a! + 42, true), true);
    await expectCode(readArchive(zip), "archive.malformed");
  });

  it("rejects ZIP64 markers", async () => {
    const zip = (await buildZip([manifestFile(), index])).slice();
    const view = new DataView(zip.buffer);
    view.setUint16(eocdOffset(zip) + 10, 0xffff, true);
    await expectCode(readArchive(zip), "archive.malformed");
  });

  it("rejects truncated archives and non-ZIP input", async () => {
    const zip = await buildZip([manifestFile(), index]);
    await expectCode(readArchive(zip.subarray(0, zip.length - 30)), "archive.malformed");
    await expectCode(readArchive(new TextEncoder().encode("definitely not a zip file at all")), "archive.malformed");
    await expectCode(readArchive(new Uint8Array(3)), "archive.malformed");
  });

  it("rejects invalid deflate data", async () => {
    const zip = (await buildZip([manifestFile(), { path: "content/data.txt", content: "q".repeat(64) }])).slice();
    const view = new DataView(zip.buffer);
    const central = centralHeaders(zip)[1]!;
    const local = view.getUint32(central + 42, true);
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    // 0xff starts a deflate block with the reserved block type 3.
    zip.fill(0xff, dataStart, dataStart + view.getUint32(central + 20, true));
    await expectCode(readArchive(zip, { maxCompressionRatio: 0 }), "archive.malformed");
  });
});

describe("browser loader: manifest + integrity", () => {
  it("rejects a capsule whose content does not match its declared hash", async () => {
    const zip = await buildZip([
      manifestFile({ integrity: { algorithm: "sha256", content_hash: `sha256:${"0".repeat(64)}` } }),
      index,
    ]);
    await expectCode(loadCapsule(zip), "integrity.mismatch");
  });

  it("rejects a missing manifest", async () => {
    await expectCode(loadCapsule(await buildZip([index])), "archive.missing_manifest");
  });

  it("rejects manifests that fail the schema (same Ajv schema as core)", async () => {
    await expectCode(loadCapsule(await buildZip([manifestFile({ slug: "Bad Slug" }), index])), "manifest.schema");
    await expectCode(loadCapsule(await buildZip([manifestFile({ extra: true }), index])), "manifest.schema");
    await expectCode(
      loadCapsule(await buildZip([manifestFile({ network: { default: "allow", allow: [] } }), index])),
      "manifest.schema",
    );
  });

  it("rejects a manifest whose entry file is missing", async () => {
    await expectCode(loadCapsule(await buildZip([manifestFile()])), "manifest.entry_missing");
  });

  it("rejects unsupported required features", async () => {
    await expectCode(
      loadCapsule(await buildZip([manifestFile({ features: { required: ["capability.shell"] } }), index])),
      "manifest.schema",
    );
  });

  it("rejects invalid JSON", async () => {
    await expectCode(loadCapsule(await buildZip([{ path: "capsule.json", content: "{nope" }, index])), "manifest.invalid_json");
  });

  it("rejects HTML that carries no capsule", async () => {
    await expectCode(loadCapsule(new TextEncoder().encode("<!doctype html><p>just a page</p>")), "embed.missing");
  });
});

describe("crc32", () => {
  it("matches known vectors", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});
