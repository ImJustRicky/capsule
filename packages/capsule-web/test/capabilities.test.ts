import { describe, expect, it } from "vitest";
import type { CapsuleManifest } from "@capsule/core";
import {
  CapabilityError,
  checkFetchTarget,
  connectSrcFor,
  extractScope,
  hostAllowed,
  isLocalOrPrivateHost,
  sanitizeRequestHeaders,
  scopeCovers,
} from "../src/capabilities.js";
import { validManifest } from "./helpers.js";

function manifest(overrides: Partial<CapsuleManifest> = {}): CapsuleManifest {
  return { ...(validManifest as unknown as CapsuleManifest), ...overrides };
}

const fetching = manifest({
  permissions: [{ capability: "network.fetch", scope: ["api.example.com", "data.example.org:8443"], reason: "r" }],
  network: { default: "deny", allow: ["api.example.com", "data.example.org:8443", "other.example.net"] },
});

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof CapabilityError) return err.code + ": " + err.message;
    throw err;
  }
  return "ok";
}

describe("scope rules (parity with the Node runtime)", () => {
  it("extracts host[:port] for network.fetch only", () => {
    expect(extractScope("network.fetch", { url: "https://API.example.com:8443/x?y" })).toBe("api.example.com:8443");
    expect(extractScope("network.fetch", { url: "not a url" })).toBeNull();
    expect(extractScope("storage.local", { url: "https://x.test" })).toBeNull();
  });

  it("matches scopes exactly, case-insensitively, ignoring a trailing dot", () => {
    expect(scopeCovers(["api.example.com"], "API.example.com.")).toBe(true);
    expect(scopeCovers(["api.example.com"], "evil.api.example.com")).toBe(false);
    expect(scopeCovers("api.example.com", "api.example.com:8443")).toBe(false);
    expect(scopeCovers("*", "anything.test")).toBe(true);
    expect(scopeCovers(["*"], "anything.test")).toBe(false);
    expect(scopeCovers("capsule", null)).toBe(true);
  });

  it("matches the network allowlist exactly (no wildcards)", () => {
    expect(hostAllowed(["api.example.com"], "api.example.com")).toBe(true);
    expect(hostAllowed(["example.com"], "api.example.com")).toBe(false);
  });
});

describe("private network blocking", () => {
  const host = (url: string) => new URL(url).hostname;
  it.each([
    "https://localhost/",
    "https://foo.localhost/",
    "https://printer.local/",
    "https://127.0.0.1/",
    "https://2130706433/", // 127.0.0.1 as a single integer
    "https://0x7f.1/", // 127.0.0.1 in hex shorthand
    "https://10.1.2.3/",
    "https://172.20.0.1/",
    "https://192.168.1.1/",
    "https://169.254.169.254/", // cloud metadata
    "https://100.64.0.1/",
    "https://0.0.0.0/",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://[fd00::1]/",
    "https://[fe80::1]/",
  ])("blocks %s", (url) => {
    expect(isLocalOrPrivateHost(host(url))).toBe(true);
  });

  it.each(["https://example.com/", "https://8.8.8.8/", "https://172.32.0.1/", "https://[2606:4700::1111]/"])(
    "allows public %s",
    (url) => {
      expect(isLocalOrPrivateHost(host(url))).toBe(false);
    },
  );
});

describe("checkFetchTarget", () => {
  it("accepts an allowlisted, in-scope https host", () => {
    expect(checkFetchTarget(fetching, "https://api.example.com/v1").host).toBe("api.example.com");
    expect(checkFetchTarget(fetching, "https://data.example.org:8443/").host).toBe("data.example.org:8443");
  });

  it("rejects everything else with network.blocked", () => {
    expect(code(() => checkFetchTarget(fetching, "http://api.example.com/"))).toMatch(/only https/);
    expect(code(() => checkFetchTarget(fetching, "https://evil.test/"))).toMatch(/allowlist/);
    expect(code(() => checkFetchTarget(fetching, "https://other.example.net/"))).toMatch(/scope/);
    expect(code(() => checkFetchTarget(fetching, "https://user:pw@api.example.com/"))).toMatch(/credentials/);
    expect(code(() => checkFetchTarget(manifest(), "https://api.example.com/"))).toMatch(/allowlist/);
    expect(code(() => checkFetchTarget(fetching, 42))).toMatch(/network.invalid_url/);
  });

  it("blocks private hosts even when the author allowlists them", () => {
    const local = manifest({
      permissions: [{ capability: "network.fetch", scope: "*", reason: "r" }],
      network: { default: "deny", allow: ["127.0.0.1"] },
    });
    expect(code(() => checkFetchTarget(local, "https://127.0.0.1/"))).toMatch(/private/);
  });
});

describe("request headers", () => {
  it("drops credentials and hop-by-hop headers like the Node proxy", () => {
    expect(
      sanitizeRequestHeaders({
        accept: "application/json",
        Cookie: "a=b",
        Authorization: "Bearer x",
        Host: "evil",
        "Sec-Fetch-Mode": "x",
        "Proxy-Authorization": "x",
        "X-Custom": "1",
      }),
    ).toEqual({ accept: "application/json", "X-Custom": "1" });
  });

  it("rejects malformed headers", () => {
    expect(code(() => sanitizeRequestHeaders({ "bad header": "x" }))).toMatch(/invalid header name/);
    expect(code(() => sanitizeRequestHeaders({ ok: 1 }))).toMatch(/must be a string/);
    expect(code(() => sanitizeRequestHeaders(["x"]))).toMatch(/must be an object/);
  });
});

describe("viewer connect-src narrowing", () => {
  it("is 'none' unless network.fetch is declared", () => {
    expect(connectSrcFor(manifest())).toBe("'none'");
    expect(connectSrcFor(manifest({ network: { default: "deny", allow: ["api.example.com"] } }))).toBe("'none'");
  });

  it("lists only hosts that are allowlisted, in scope, and public", () => {
    expect(connectSrcFor(fetching)).toBe("https://api.example.com https://data.example.org:8443");
    const withLocal = manifest({
      permissions: [{ capability: "network.fetch", scope: "*", reason: "r" }],
      network: { default: "deny", allow: ["127.0.0.1:8080", "api.example.com"] },
    });
    expect(connectSrcFor(withLocal)).toBe("https://api.example.com");
  });
});
