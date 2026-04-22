import { describe, it, expect } from "vitest";
import {
  canonicalJsonStringify,
  computeContentHash,
  readArchiveFromBuffer,
} from "../src/index.js";
import { buildZip, validManifest } from "./helpers.js";

describe("canonicalJsonStringify", () => {
  it("sorts object keys recursively", () => {
    const a = canonicalJsonStringify({ b: 1, a: { y: 2, x: 1 } });
    const b = canonicalJsonStringify({ a: { x: 1, y: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"x":1,"y":2},"b":1}');
  });

  it("preserves array order", () => {
    expect(canonicalJsonStringify([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("computeContentHash", () => {
  async function hash(files: { path: string; content: string }[]): Promise<string> {
    const buf = await buildZip(files);
    const archive = await readArchiveFromBuffer(buf);
    return computeContentHash(archive);
  }

  it("is stable across equivalent manifests (key ordering, integrity stripped)", async () => {
    const a = await hash([
      { path: "capsule.json", content: JSON.stringify(validManifest) },
      { path: "content/index.html", content: "<h1>hi</h1>" },
    ]);
    const reordered = {
      network: validManifest.network,
      permissions: validManifest.permissions,
      entry: validManifest.entry,
      description: validManifest.description,
      version: validManifest.version,
      slug: validManifest.slug,
      name: validManifest.name,
      capsule_version: validManifest.capsule_version,
      integrity: {
        algorithm: "sha256" as const,
        content_hash:
          "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      },
    };
    const b = await hash([
      { path: "capsule.json", content: JSON.stringify(reordered) },
      { path: "content/index.html", content: "<h1>hi</h1>" },
    ]);
    expect(a).toBe(b);
  });

  it("changes when content changes", async () => {
    const a = await hash([
      { path: "capsule.json", content: JSON.stringify(validManifest) },
      { path: "content/index.html", content: "<h1>hi</h1>" },
    ]);
    const b = await hash([
      { path: "capsule.json", content: JSON.stringify(validManifest) },
      { path: "content/index.html", content: "<h1>bye</h1>" },
    ]);
    expect(a).not.toBe(b);
  });

  it("ignores signatures/ and receipts/", async () => {
    const a = await hash([
      { path: "capsule.json", content: JSON.stringify(validManifest) },
      { path: "content/index.html", content: "<h1>hi</h1>" },
    ]);
    const b = await hash([
      { path: "capsule.json", content: JSON.stringify(validManifest) },
      { path: "content/index.html", content: "<h1>hi</h1>" },
      { path: "signatures/capsule.sig.json", content: '{"any":"thing"}' },
      { path: "receipts/whatever.json", content: "{}" },
    ]);
    expect(a).toBe(b);
  });
});
