import { describe, it, expect } from "vitest";
import { CapabilityMediator, connectSrcFromManifest } from "../src/capabilities.js";

const manifest = {
  capsule_version: "1.0" as const,
  name: "t",
  slug: "t",
  version: "0.1.0",
  description: "t",
  entry: "content/index.html",
  permissions: [
    {
      capability: "network.fetch" as const,
      scope: ["api.weather.gov", "api.example.com"],
      reason: "demo",
    },
    {
      capability: "storage.local" as const,
      scope: "capsule",
      reason: "demo",
    },
  ],
  network: { default: "deny" as const, allow: ["api.weather.gov", "api.example.com"] },
};

describe("CapabilityMediator", () => {
  const m = new CapabilityMediator(manifest);

  it("finds declared capabilities and rejects unknowns", () => {
    expect(m.declarationFor("network.fetch")).not.toBeNull();
    expect(m.declarationFor("clipboard.write")).toBeNull();
  });

  it("enforces array scopes", () => {
    const d = m.declarationFor("network.fetch")!;
    expect(m.scopeCovers(d, "api.weather.gov")).toBe(true);
    expect(m.scopeCovers(d, "other.com")).toBe(false);
  });

  it("accepts null requested-scope for scope-free capabilities", () => {
    const d = m.declarationFor("storage.local")!;
    expect(m.scopeCovers(d, null)).toBe(true);
  });

  it("treats '*' declared scope as wildcard", () => {
    const d = { capability: "network.fetch" as const, scope: "*", reason: "." };
    expect(m.scopeCovers(d, "any.example.net")).toBe(true);
  });
});

describe("connectSrcFromManifest", () => {
  it("returns 'none' when the allowlist is empty", () => {
    const none = { ...manifest, network: { default: "deny" as const, allow: [] } };
    expect(connectSrcFromManifest(none)).toBe("'none'");
  });
  it("lists allowed origins as https", () => {
    expect(connectSrcFromManifest(manifest)).toBe(
      "'self' https://api.weather.gov https://api.example.com",
    );
  });
});
