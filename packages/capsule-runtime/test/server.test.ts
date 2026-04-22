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

async function buildSession() {
  const files: PackFile[] = [
    { path: "capsule.json", bytes: enc.encode(JSON.stringify(baseManifest)) },
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
    expect(csp).toMatch(/connect-src 'none'/);
    // Host page references external session.js.
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

describe("session token", () => {
  it("returns a distinct hex string each call", () => {
    const a = createSessionToken();
    const b = createSessionToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-f0-9]{48}$/);
  });
});

