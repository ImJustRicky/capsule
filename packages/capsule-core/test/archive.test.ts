import { describe, it, expect } from "vitest";
import {
  readArchiveFromBuffer,
  loadCapsuleFromBuffer,
  CapsuleError,
} from "../src/index.js";
import { buildZip, validManifest } from "./helpers.js";

describe("readArchiveFromBuffer", () => {
  it("reads a simple archive", async () => {
    const buf = await buildZip([
      { path: "capsule.json", content: JSON.stringify(validManifest) },
      { path: "content/index.html", content: "<h1>hi</h1>" },
    ]);
    const res = await readArchiveFromBuffer(buf);
    expect(res.byPath.get("capsule.json")).toBeDefined();
    expect(res.byPath.get("content/index.html")?.bytes.byteLength).toBeGreaterThan(0);
  });

  it("rejects symlink entries", async () => {
    const buf = await buildZip([
      { path: "capsule.json", content: JSON.stringify(validManifest) },
      { path: "content/link", content: "target", mode: 0o120777 },
    ]);
    await expect(readArchiveFromBuffer(buf)).rejects.toBeInstanceOf(CapsuleError);
  });

});

describe("loadCapsuleFromBuffer", () => {
  it("loads, validates, and hashes a capsule", async () => {
    const buf = await buildZip([
      { path: "capsule.json", content: JSON.stringify(validManifest) },
      { path: "content/index.html", content: "<h1>hi</h1>" },
    ]);
    const loaded = await loadCapsuleFromBuffer(buf);
    expect(loaded.manifest.slug).toBe("test-capsule");
    expect(loaded.integrity.actual).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(loaded.integrity.declared).toBeNull();
  });

  it("fails when declared content_hash does not match", async () => {
    const bogusManifest = {
      ...validManifest,
      integrity: {
        algorithm: "sha256" as const,
        content_hash:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      },
    };
    const buf = await buildZip([
      { path: "capsule.json", content: JSON.stringify(bogusManifest) },
      { path: "content/index.html", content: "<h1>hi</h1>" },
    ]);
    await expect(loadCapsuleFromBuffer(buf)).rejects.toThrow(/content hash mismatch/);
  });

  it("fails when capsule.json is missing", async () => {
    const buf = await buildZip([{ path: "content/index.html", content: "x" }]);
    await expect(loadCapsuleFromBuffer(buf)).rejects.toThrow(/capsule\.json/);
  });

  it("fails when entry file is missing from archive", async () => {
    const buf = await buildZip([
      { path: "capsule.json", content: JSON.stringify(validManifest) },
    ]);
    await expect(loadCapsuleFromBuffer(buf)).rejects.toThrow(/entry file not present/);
  });
});
