import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { CapsuleManifest } from "@capsule/core";
import { sha256, sha256Portable } from "../src/hash.js";
import { CapabilityHost, type HostUi } from "../src/host.js";
import { validManifest } from "./helpers.js";

function makeUi(decision: "granted" | "denied" = "granted"): HostUi & { prompts: string[]; notes: string[] } {
  const prompts: string[] = [];
  const notes: string[] = [];
  return {
    prompts,
    notes,
    promptPermission: vi.fn(async (capability: string, scope: string | null) => {
      prompts.push(`${capability}:${scope ?? ""}`);
      return decision;
    }),
    requestGesture: vi.fn(async () => true),
    alert: vi.fn(),
    confirm: vi.fn(() => true),
    prompt: vi.fn(() => "typed"),
    notify: vi.fn((m: string) => {
      notes.push(m);
    }),
  };
}

function manifest(overrides: Partial<CapsuleManifest> = {}): CapsuleManifest {
  return {
    ...(validManifest as unknown as CapsuleManifest),
    permissions: [
      { capability: "storage.local", scope: "capsule", reason: "save" },
      { capability: "dialog.open", scope: "capsule", reason: "ask" },
      { capability: "network.fetch", scope: ["api.example.com"], reason: "data" },
    ],
    network: { default: "deny", allow: ["api.example.com", "elsewhere.example.com"] },
    ...overrides,
  };
}

const req = (capability: string, method: string, args?: unknown) => ({
  kind: "capsule-request" as const,
  id: "c1",
  capability,
  method,
  args,
});

describe("CapabilityHost mediation pipeline", () => {
  it("rejects undeclared capabilities without prompting", async () => {
    const ui = makeUi();
    const host = new CapabilityHost(manifest(), "sha256:x", ui);
    const reply = await host.handle(req("clipboard.write", "text", { text: "x" }));
    expect(reply).toMatchObject({ ok: false, error: "capability.not_declared" });
    expect(ui.prompts).toEqual([]);
    expect(host.receipts.at(-1)).toMatchObject({ event: "deny", detail: "capability.not_declared" });
  });

  it("rejects out-of-scope network targets without prompting", async () => {
    const ui = makeUi();
    const host = new CapabilityHost(manifest(), "sha256:x", ui);
    const reply = await host.handle(req("network.fetch", "request", { url: "https://elsewhere.example.com/" }));
    expect(reply).toMatchObject({ ok: false, error: "capability.scope_violation" });
    expect(ui.prompts).toEqual([]);
  });

  it("asks once per capability+scope per session and honors denial", async () => {
    const ui = makeUi("denied");
    const host = new CapabilityHost(manifest(), "sha256:x", ui);
    expect(await host.handle(req("storage.local", "get", { key: "k" }))).toMatchObject({ ok: false, error: "capability.denied" });
    expect(await host.handle(req("storage.local", "set", { key: "k", value: 1 }))).toMatchObject({ ok: false, error: "capability.denied" });
    expect(ui.prompts).toEqual(["storage.local:"]);
  });

  it("stores values per capsule (memory fallback when IndexedDB is unavailable)", async () => {
    const ui = makeUi();
    const host = new CapabilityHost(manifest(), "sha256:x", ui);
    expect(await host.handle(req("storage.local", "set", { key: "items", value: [1, 2] }))).toEqual({ ok: true, value: true });
    expect(await host.handle(req("storage.local", "get", { key: "items" }))).toEqual({ ok: true, value: [1, 2] });
    expect(await host.handle(req("storage.local", "keys"))).toEqual({ ok: true, value: ["items"] });
    expect(await host.handle(req("storage.local", "delete", { key: "items" }))).toEqual({ ok: true, value: true });
    expect(await host.handle(req("storage.local", "get", { key: "items" }))).toEqual({ ok: true, value: null });
    expect(ui.notes).toHaveLength(1);
    expect(ui.notes[0]).toMatch(/temporary/);
  });

  it("refuses oversized storage values and unknown methods", async () => {
    const host = new CapabilityHost(manifest(), "sha256:x", makeUi());
    expect(await host.handle(req("storage.local", "set", { key: "k", value: "x".repeat(6 * 1024 * 1024) }))).toMatchObject({
      ok: false,
      error: "storage.quota",
    });
    expect(await host.handle(req("storage.local", "nuke"))).toMatchObject({ ok: false, error: "method.unknown" });
  });

  it("routes dialogs through the host UI with the capsule name attached", async () => {
    const ui = makeUi();
    const host = new CapabilityHost(manifest(), "sha256:x", ui);
    expect(await host.handle(req("dialog.open", "confirm", { message: "Sure?" }))).toEqual({ ok: true, value: true });
    expect(ui.confirm).toHaveBeenCalledWith("Test Capsule\n\nSure?");
    expect(await host.handle(req("dialog.open", "prompt", { message: "Name?", default: "a" }))).toEqual({ ok: true, value: "typed" });
  });

  it("validates fetch requests before any network access", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const host = new CapabilityHost(manifest(), "sha256:x", makeUi());
    const reply = await host.handle(req("network.fetch", "request", { url: "https://api.example.com/", method: "GET", body: "x" }));
    expect(reply).toMatchObject({ ok: false, error: "network.invalid_request" });
    expect(await host.handle(req("network.fetch", "request", { url: "https://api.example.com/", method: "TRACE" }))).toMatchObject({
      ok: false,
      error: "network.invalid_request",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("returns the Node proxy's response envelope and never sends credentials", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("hello", { status: 201, headers: { "content-type": "text/plain" } }));
    const host = new CapabilityHost(manifest(), "sha256:x", makeUi());
    const reply = await host.handle(
      req("network.fetch", "request", { url: "https://api.example.com/v1", method: "post", body: "{}", headers: { Cookie: "x", accept: "*/*" } }),
    );
    expect(reply).toEqual({
      ok: true,
      value: { status: 201, ok: true, headers: { "content-type": "text/plain" }, body_b64: btoa("hello") },
    });
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init).toMatchObject({ method: "POST", credentials: "omit", redirect: "error", headers: { accept: "*/*" } });
    fetchSpy.mockRestore();
  });
});

describe("SHA-256", () => {
  it("portable implementation matches node:crypto at block boundaries", () => {
    for (const size of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 100_003]) {
      const data = new Uint8Array(randomBytes(size));
      const expected = createHash("sha256").update(data).digest("hex");
      expect(Buffer.from(sha256Portable(data)).toString("hex")).toBe(expected);
    }
  });

  it("WebCrypto path agrees with the portable path", async () => {
    const data = new TextEncoder().encode("capsule");
    expect(Buffer.from(await sha256(data)).toString("hex")).toBe(Buffer.from(sha256Portable(data)).toString("hex"));
  });
});
