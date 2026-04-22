import { describe, it, expect, afterEach } from "vitest";
import {
  loadCapsuleFromBuffer,
  packArchive,
  type PackFile,
} from "@capsule/core";
import { createSessionToken, startServer } from "../src/server.js";
import type { RunningServer } from "../src/server.js";

const enc = new TextEncoder();

const baseManifest = {
  capsule_version: "1.0" as const,
  name: "Runtime Test",
  slug: "runtime-test",
  version: "0.1.0",
  description: "test",
  entry: "content/index.html",
  permissions: [],
  network: { default: "deny" as const, allow: [] },
};

async function buildSession(overrides: Record<string, unknown> = {}) {
  const files: PackFile[] = [
    { path: "capsule.json", bytes: enc.encode(JSON.stringify({ ...baseManifest, ...overrides })) },
    { path: "content/index.html", bytes: enc.encode("<!doctype html><html><head></head><body>hi</body></html>") },
    { path: "content/app.js", bytes: enc.encode("console.log('capsule');") },
  ];
  const { bytes } = await packArchive(files);
  const loaded = await loadCapsuleFromBuffer(Buffer.from(bytes));
  return {
    manifest: loaded.manifest,
    archive: loaded.archive,
    token: createSessionToken(),
  };
}

let server: RunningServer | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

async function fetchText(
  url: string,
): Promise<{ status: number; headers: Headers; body: string }> {
  const r = await fetch(url);
  return { status: r.status, headers: r.headers, body: await r.text() };
}

describe("runtime server", () => {
  it("serves the host page at /s/<token>/host.html with strict CSP", async () => {
    const session = await buildSession();
    server = await startServer(session);
    const r = await fetchText(`http://127.0.0.1:${server.port}/s/${session.token}/host.html`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/html/);
    const csp = r.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/default-src 'none'/);
    // Host page may call its own receipt + proxy endpoints; the capsule
    // iframe's CSP (asserted below) is what must deny external connects.
    expect(csp).toMatch(/connect-src 'self'/);
    expect(r.body).toContain("session.js");
  });

  it("serves session state as a separate script (CSP-safe)", async () => {
    const session = await buildSession();
    server = await startServer(session);
    const r = await fetchText(
      `http://127.0.0.1:${server.port}/s/${session.token}/session.js`,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/javascript/);
    expect(r.body).toContain("window.__CAPSULE__");
    expect(r.body).toContain('"slug":"runtime-test"');
    expect(r.body).toContain(session.token);
  });

  it("redirects / to the host page", async () => {
    const session = await buildSession();
    server = await startServer(session);
    const r = await fetch(`http://127.0.0.1:${server.port}/`, { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toContain(`/s/${session.token}/host.html`);
  });

  it("returns 404 for requests with a wrong or missing token", async () => {
    const session = await buildSession();
    server = await startServer(session);
    const wrong = await fetch(
      `http://127.0.0.1:${server.port}/s/deadbeef/host.html`,
    );
    expect(wrong.status).toBe(404);
  });

  it("serves capsule content under strict iframe CSP and injects bridge.js", async () => {
    const session = await buildSession();
    server = await startServer(session);
    const r = await fetchText(
      `http://127.0.0.1:${server.port}/s/${session.token}/capsule/`,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/html/);
    const csp = r.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/connect-src 'none'/);
    expect(csp).toMatch(/default-src 'none'/);
    expect(r.body).toContain(`/s/${session.token}/bridge.js`);
  });

  it("serves additional capsule files by path", async () => {
    const session = await buildSession();
    server = await startServer(session);
    const r = await fetchText(
      `http://127.0.0.1:${server.port}/s/${session.token}/capsule/content/app.js`,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/javascript/);
    expect(r.body).toContain("console.log('capsule')");
  });

  it("rejects methods other than GET/HEAD", async () => {
    const session = await buildSession();
    server = await startServer(session);
    const r = await fetch(`http://127.0.0.1:${server.port}/`, { method: "POST" });
    expect(r.status).toBe(405);
  });

  it("serves host.js and bridge.js from the same origin", async () => {
    const session = await buildSession();
    server = await startServer(session);
    const host = await fetchText(`http://127.0.0.1:${server.port}/s/${session.token}/host.js`);
    expect(host.status).toBe(200);
    expect(host.body).toContain("capsule-request");
    const bridge = await fetchText(
      `http://127.0.0.1:${server.port}/s/${session.token}/bridge.js`,
    );
    expect(bridge.status).toBe(200);
    expect(bridge.body).toContain("capsule-request");
    expect(bridge.body).toContain("window.capsule");
  });
});

describe("POST /receipt", () => {
  it("appends a record to the receipt log when one is configured", async () => {
    const session = await buildSession();
    const log: { records: unknown[] } = { records: [] };
    const receipts = {
      path: "(memory)",
      async append(rec: unknown) {
        log.records.push(rec);
      },
      async read() {
        return [] as never;
      },
    };
    server = await startServer({ ...session, receipts });
    const r = await fetch(
      `http://127.0.0.1:${server.port}/s/${session.token}/receipt`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "grant", capability: "storage.local", method: "set" }),
      },
    );
    expect(r.status).toBe(204);
    expect(log.records.length).toBe(1);
    const rec = log.records[0] as { event: string; capability: string; slug: string };
    expect(rec.event).toBe("grant");
    expect(rec.capability).toBe("storage.local");
    expect(rec.slug).toBe(session.manifest.slug);
  });
});

describe("POST /proxy network allowlist", () => {
  it("rejects hosts not in manifest.network.allow with 403", async () => {
    const session = await buildSession({ network: { default: "deny", allow: [] } });
    server = await startServer(session);
    const r = await fetch(
      `http://127.0.0.1:${server.port}/s/${session.token}/proxy`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/" }),
      },
    );
    expect(r.status).toBe(403);
  });

  it("rejects non-http(s) schemes with 400", async () => {
    const session = await buildSession({ network: { default: "deny", allow: ["example.com"] } });
    server = await startServer(session);
    const r = await fetch(
      `http://127.0.0.1:${server.port}/s/${session.token}/proxy`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "file:///etc/passwd" }),
      },
    );
    expect(r.status).toBe(400);
  });

  it("rejects malformed JSON with 400", async () => {
    const session = await buildSession();
    server = await startServer(session);
    const r = await fetch(
      `http://127.0.0.1:${server.port}/s/${session.token}/proxy`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" },
    );
    expect(r.status).toBe(400);
  });
});

describe("session token", () => {
  it("returns a distinct hex string each call", () => {
    const a = createSessionToken();
    const b = createSessionToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-f0-9]{48}$/);
  });
});

