import { describe, expect, it } from "vitest";
import {
  computeContentHash as nodeHash,
  embedCapsuleInHtml,
  loadCapsuleFromBuffer,
  packArchive,
  readArchiveFromBuffer,
} from "@capsule/core";
import { computeContentHash as webHash } from "../src/hash.js";
import { loadCapsule } from "../src/load.js";
import { readArchive } from "../src/zip.js";
import { buildZip, exampleNames, manifestFile, packExample, validManifest } from "./helpers.js";

/**
 * Cross-implementation conformance: the browser reader/hasher must agree
 * byte-for-byte with the Node reference implementation, or a capsule could
 * verify in one runtime and fail (or worse, differ) in the other.
 */
describe("browser runtime ↔ Node reference implementation", async () => {
  const names = await exampleNames();

  it("has examples to check", () => {
    expect(names.length).toBeGreaterThanOrEqual(4);
  });

  for (const name of names) {
    it(`reads, hashes, and validates examples/${name} identically`, async () => {
      const bytes = await packExample(name);
      const node = await readArchiveFromBuffer(bytes);
      const web = await readArchive(bytes);

      expect(web.entries.map((e) => e.path)).toEqual(node.entries.map((e) => e.path));
      for (const entry of node.entries) {
        const twin = web.byPath.get(entry.path)!;
        expect(twin.isDirectory).toBe(entry.isDirectory);
        expect(Buffer.from(twin.bytes).equals(Buffer.from(entry.bytes))).toBe(true);
      }
      expect(await webHash(web)).toBe(nodeHash(node));

      const nodeLoaded = await loadCapsuleFromBuffer(bytes);
      const webLoaded = await loadCapsule(bytes);
      expect(webLoaded.manifest).toEqual(nodeLoaded.manifest);
      expect(webLoaded.integrity).toEqual({
        declared: nodeLoaded.integrity.declared,
        actual: nodeLoaded.integrity.actual,
        match: true,
      });
      expect(webLoaded.wrapped).toBe(false);
    });
  }

  it("agrees on a capsule with no declared hash, nested dirs, and binary assets", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255, 254]);
    const zip = await buildZip([
      manifestFile(),
      { path: "content/index.html", content: "<!doctype html><h1>hi</h1>" },
      { path: "content/", content: "" },
      { path: "assets/img/dot.png", content: png, compress: false },
      { path: "source/README.md", content: "# src" },
      { path: "signatures/author.sig", content: "excluded from hash" },
      { path: "other/ignored.txt", content: "outside hash scope" },
    ]);
    const node = await loadCapsuleFromBuffer(zip);
    const web = await loadCapsule(zip);
    expect(web.integrity).toEqual({ declared: null, actual: node.integrity.actual, match: true });
  });

  it("opens a self-opening .capsule.html exactly like the bare archive", async () => {
    const bytes = await packExample("offline-checklist");
    const template =
      '<!doctype html><title>x</title><script>var s = "<script id=\\"capsule-payload\\">";</script>' +
      '<script id="capsule-payload" type="application/vnd.capsule+zip;base64"></script>';
    const html = new TextEncoder().encode(embedCapsuleInHtml(template, bytes, "Checklist"));

    const web = await loadCapsule(html);
    const node = await loadCapsuleFromBuffer(html);
    expect(web.wrapped).toBe(true);
    expect(node.wrapped).toBe(true);
    expect(web.integrity.actual).toBe(node.integrity.actual);
    expect(web.archiveBytes).toBe(bytes.byteLength);
  });

  it("produces the hash the reference packer stamps into the manifest", async () => {
    const { bytes, contentHash } = await packArchive([
      { path: "capsule.json", bytes: new TextEncoder().encode(JSON.stringify(validManifest)) },
      { path: "content/index.html", bytes: new TextEncoder().encode("<p>ü — unicode ✓</p>") },
    ]);
    expect(await webHash(await readArchive(bytes))).toBe(contentHash);
  });
});
