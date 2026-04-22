import { describe, it, expect } from "vitest";
import { parseManifestText, CapsuleError } from "../src/index.js";
import { validManifest } from "./helpers.js";

describe("parseManifestText", () => {
  it("accepts a minimal valid manifest", () => {
    const m = parseManifestText(JSON.stringify(validManifest));
    expect(m.slug).toBe("test-capsule");
  });

  it("rejects invalid JSON", () => {
    expect(() => parseManifestText("{not json")).toThrow(CapsuleError);
  });

  it("rejects missing required fields", () => {
    const { name: _name, ...broken } = validManifest;
    expect(() => parseManifestText(JSON.stringify(broken))).toThrow(/schema|name/i);
  });

  it("rejects wrong capsule_version", () => {
    expect(() =>
      parseManifestText(JSON.stringify({ ...validManifest, capsule_version: "2.0" })),
    ).toThrow();
  });

  it("rejects network.default other than deny", () => {
    expect(() =>
      parseManifestText(
        JSON.stringify({ ...validManifest, network: { default: "allow", allow: [] } }),
      ),
    ).toThrow();
  });

  it("rejects unknown capabilities", () => {
    expect(() =>
      parseManifestText(
        JSON.stringify({
          ...validManifest,
          permissions: [{ capability: "shell", scope: "*", reason: "no" }],
        }),
      ),
    ).toThrow();
  });

  it("rejects entry when not listed in archive entries", () => {
    expect(() =>
      parseManifestText(JSON.stringify(validManifest), {
        entries: new Set(["content/other.html"]),
      }),
    ).toThrow(/entry file not present/);
  });
});
