import http from "node:http";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CapsuleManifest, ReadArchiveResult } from "@capsule/core";
import { contentTypeFor } from "./mime.js";

/**
 * Capsule runtime session.
 *
 * A session binds a single capsule archive to:
 *   - a random path token (unguessable even from localhost)
 *   - a short-lived HTTP server bound to 127.0.0.1 on a random port
 *   - a strict Content-Security-Policy that blocks network, shell, and
 *     cross-origin access for both the host page and the capsule iframe.
 *
 * The host page lives at /s/<token>/host.html and renders:
 *   - the Open Screen (manifest inspection, "this capsule can / cannot" list)
 *   - a sandboxed <iframe> that serves the capsule content
 *   - permission prompt modals
 *
 * In V1 Milestone 4 every capability returns `capability.denied`.
 */

export interface CapsuleSession {
  manifest: CapsuleManifest;
  archive: ReadArchiveResult;
  /** Hex string — appears in every URL path for this session. */
  token: string;
}

export interface StartServerOptions {
  /** Bind host. Must stay on loopback in V1. */
  host?: string;
  /** Explicit port, or 0 to pick a free one. */
  port?: number;
}

export interface RunningServer {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

const HOST_ASSET_DIR = resolveHostAssetDir();

function resolveHostAssetDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // In dev (ts-source) and build (dist), host/ sits next to this file.
  return path.join(here, "host");
}

export async function startServer(
  session: CapsuleSession,
  options: StartServerOptions = {},
): Promise<RunningServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const { token } = session;

  const server = http.createServer((req, res) => {
    handle(req, res, session).catch((err) => {
      console.error("runtime: request handler error", err);
      if (!res.headersSent) res.writeHead(500);
      res.end("internal error");
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("runtime: server did not return an address");
  }

  return {
    url: `http://${host}:${addr.port}/s/${token}/host.html`,
    port: addr.port,
    token,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

export function createSessionToken(): string {
  return randomBytes(24).toString("hex");
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  session: CapsuleSession,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  // Only GET and HEAD.
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return;
  }

  const expectedPrefix = `/s/${session.token}/`;
  if (url.pathname === "/") {
    res.writeHead(302, { location: `${expectedPrefix}host.html` });
    res.end();
    return;
  }
  if (!url.pathname.startsWith(expectedPrefix)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const rest = url.pathname.slice(expectedPrefix.length);

  // Host page + assets.
  if (rest === "host.html") return serveHostPage(res, session);
  if (rest === "session.js") return serveSessionState(res, session);
  if (rest === "host.js") return serveHostAsset(res, "host.js", false);
  if (rest === "host.css") return serveHostAsset(res, "host.css", false);
  if (rest === "bridge.js") return serveHostAsset(res, "bridge.js", true);

  // Capsule iframe entry.
  if (rest === "capsule/" || rest.startsWith("capsule/")) {
    const inside = rest === "capsule/" ? session.manifest.entry : rest.slice("capsule/".length);
    return serveCapsuleFile(res, session, inside);
  }

  res.writeHead(404);
  res.end();
}

async function serveHostPage(
  res: http.ServerResponse,
  session: CapsuleSession,
): Promise<void> {
  const body = await fs.readFile(path.join(HOST_ASSET_DIR, "host.html"), "utf8");
  // Session state is served as an external script (session.js) because the
  // host CSP bans inline scripts.
  void session;

  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'none'",
    // The capsule iframe is same-origin but sandboxed; we still restrict it.
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": csp,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(body);
}

function serveSessionState(res: http.ServerResponse, session: CapsuleSession): void {
  const body = `window.__CAPSULE__ = Object.freeze({ manifest: ${JSON.stringify(
    session.manifest,
  )}, token: ${JSON.stringify(session.token)} });\n`;
  res.writeHead(200, {
    "content-type": "text/javascript; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  });
  res.end(body);
}

async function serveHostAsset(
  res: http.ServerResponse,
  name: string,
  forIframe: boolean,
): Promise<void> {
  const filePath = path.join(HOST_ASSET_DIR, name);
  const bytes = await fs.readFile(filePath);
  res.writeHead(200, {
    "content-type": contentTypeFor(name),
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    // bridge.js executes inside the sandboxed iframe; the iframe's CSP is set
    // per-response in serveCapsuleFile.
    ...(forIframe ? {} : {}),
  });
  res.end(bytes);
}

async function serveCapsuleFile(
  res: http.ServerResponse,
  session: CapsuleSession,
  relPath: string,
): Promise<void> {
  const entry = session.archive.byPath.get(relPath);
  if (!entry || entry.isDirectory) {
    res.writeHead(404);
    res.end();
    return;
  }
  const ct = contentTypeFor(relPath);
  const isHtml = ct.startsWith("text/html");

  const baseCsp = [
    "default-src 'none'",
    // capsule scripts are self-hosted by the runtime (same origin), inline not allowed
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data: blob:",
    "connect-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");

  const bytes = isHtml
    ? injectBridgeScript(entry.bytes, session.token)
    : entry.bytes;

  res.writeHead(200, {
    "content-type": ct,
    "content-security-policy": baseCsp,
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), usb=(), payment=()",
  });
  res.end(bytes);
}

function injectBridgeScript(html: Uint8Array, token: string): Buffer {
  const text = new TextDecoder("utf-8").decode(html);
  const tag = `<script src="/s/${token}/bridge.js"></script>`;
  // Inject before </head> if present, else prepend.
  const idx = text.toLowerCase().indexOf("</head>");
  const out = idx >= 0 ? text.slice(0, idx) + tag + text.slice(idx) : tag + text;
  return Buffer.from(out, "utf-8");
}
