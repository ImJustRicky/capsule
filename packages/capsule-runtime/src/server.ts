import http from "node:http";
import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { promises as fs } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CapsuleManifest, ReadArchiveResult } from "@capsule/core";
import { contentTypeFor } from "./mime.js";
import { connectSrcFromManifest } from "./capabilities.js";
import type { ReceiptLog, ReceiptRecord } from "./receipts.js";

/**
 * Capsule runtime session.
 *
 * A session binds one capsule archive to:
 *   - a random path token (unguessable even from localhost)
 *   - a short-lived HTTP server bound to 127.0.0.1
 *   - a strict CSP that blocks shell, cross-origin, and ambient network access
 *   - a receipt log for provenance
 *
 * In V1 capabilities are granted only after an explicit user confirmation on
 * the Open Screen's permission modal. The Node server here mediates two extra
 * surfaces beyond asset serving: a receipt sink and a narrowly-scoped network
 * proxy for allowlisted hosts.
 */

export interface CapsuleSession {
  manifest: CapsuleManifest;
  archive: ReadArchiveResult;
  /** Hex string — appears in every URL path for this session. */
  token: string;
  /** Runtime-computed canonical content hash, even when not declared. */
  contentHash?: string | null;
  /** Optional receipt sink. */
  receipts?: ReceiptLog | null;
}

export interface StartServerOptions {
  host?: string;
  port?: number;
}

export interface RunningServer {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

const HOST_ASSET_DIR = resolveHostAssetDir();
const MAX_POST_BYTES = 10 * 1024 * 1024; // 10 MB — generous for file imports
const MAX_PROXY_RESPONSE_BYTES = 25 * 1024 * 1024;
const MAX_PROXY_REDIRECTS = 5;
const PROXY_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

function resolveHostAssetDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "host");
}

export async function startServer(
  session: CapsuleSession,
  options: StartServerOptions = {},
): Promise<RunningServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;

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
    url: `http://${host}:${addr.port}/s/${session.token}/host.html`,
    port: addr.port,
    token: session.token,
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

  const expectedPrefix = `/s/${session.token}/`;
  if (url.pathname === "/") {
    if (req.method !== "GET" && req.method !== "HEAD") return respond(res, 405, "");
    res.writeHead(302, { location: `${expectedPrefix}host.html` });
    res.end();
    return;
  }
  if (!url.pathname.startsWith(expectedPrefix)) {
    return respond(res, 404, "");
  }
  const rest = url.pathname.slice(expectedPrefix.length);

  // POST endpoints (host → server).
  if (req.method === "POST") {
    if (rest === "receipt") return handleReceipt(req, res, session);
    if (rest === "proxy") return handleProxy(req, res, session);
    return respond(res, 404, "");
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD, POST" });
    res.end();
    return;
  }

  if (rest === "host.html") return serveHostPage(res, session);
  if (rest === "session.js") return serveSessionState(res, session);
  if (rest === "host.js") return serveHostAsset(res, "host.js");
  if (rest === "host.css") return serveHostAsset(res, "host.css");
  if (rest === "bridge.js") return serveHostAsset(res, "bridge.js");

  if (rest === "capsule/" || rest.startsWith("capsule/")) {
    const inside = rest === "capsule/" ? session.manifest.entry : rest.slice("capsule/".length);
    return serveCapsuleFile(res, session, inside);
  }

  return respond(res, 404, "");
}

async function serveHostPage(
  res: http.ServerResponse,
  session: CapsuleSession,
): Promise<void> {
  const body = await fs.readFile(path.join(HOST_ASSET_DIR, "host.html"), "utf8");

  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    // Host must be able to call its own endpoints (receipt + proxy).
    "connect-src 'self'",
    "frame-src 'self'",
    "worker-src 'none'",
    "object-src 'none'",
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
  )}, token: ${JSON.stringify(session.token)}, content_hash: ${JSON.stringify(
    session.contentHash ?? session.manifest.integrity?.content_hash ?? null,
  )} });\n`;
  res.writeHead(200, {
    "content-type": "text/javascript; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  });
  res.end(body);
}

async function serveHostAsset(res: http.ServerResponse, name: string): Promise<void> {
  const filePath = path.join(HOST_ASSET_DIR, name);
  const bytes = await fs.readFile(filePath);
  res.writeHead(200, {
    "content-type": contentTypeFor(name),
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  });
  res.end(bytes);
}

async function serveCapsuleFile(
  res: http.ServerResponse,
  session: CapsuleSession,
  relPath: string,
): Promise<void> {
  const entry = session.archive.byPath.get(relPath);
  if (!entry || entry.isDirectory) return respond(res, 404, "");
  const ct = contentTypeFor(relPath);
  const isHtml = ct.startsWith("text/html");

  // Capsule iframe CSP. connect-src is 'none' by design — the capsule never
  // talks to the network directly; it always goes through the host bridge.
  const baseCsp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data: blob:",
    "connect-src 'none'",
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");

  const bytes = isHtml ? injectBridgeScript(entry.bytes, session.token) : entry.bytes;

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
  const idx = text.toLowerCase().indexOf("</head>");
  const out = idx >= 0 ? text.slice(0, idx) + tag + text.slice(idx) : tag + text;
  return Buffer.from(out, "utf-8");
}

// ---------- POST: receipt sink ----------

async function handleReceipt(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  session: CapsuleSession,
): Promise<void> {
  const body = await readBody(req);
  if (!body) return respond(res, 400, "empty");
  let parsed: Partial<ReceiptRecord>;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body)) as Partial<ReceiptRecord>;
  } catch {
    return respond(res, 400, "bad json");
  }
  if (!session.receipts) return respond(res, 204, "");
  const record: ReceiptRecord = {
    ts: new Date().toISOString(),
    slug: session.manifest.slug,
    content_hash: session.manifest.integrity?.content_hash ?? null,
    event: parsed.event ?? "request",
    session: session.token.slice(0, 6),
    ...(parsed.capability ? { capability: parsed.capability } : {}),
    ...(parsed.method ? { method: parsed.method } : {}),
    ...(parsed.scope !== undefined ? { scope: parsed.scope } : {}),
    ...(parsed.detail ? { detail: parsed.detail } : {}),
  };
  await session.receipts.append(record);
  return respond(res, 204, "");
}

// ---------- POST: network proxy ----------

async function handleProxy(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  session: CapsuleSession,
): Promise<void> {
  const body = await readBody(req);
  if (!body) return respond(res, 400, "empty");
  let parsed: { url?: string; method?: string; headers?: unknown; body?: unknown };
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return respond(res, 400, "bad json");
  }
  if (!parsed.url) return respond(res, 400, "missing url");

  let target: URL;
  try {
    target = new URL(parsed.url);
  } catch {
    return respond(res, 400, "invalid url");
  }

  const method = normalizeProxyMethod(parsed.method);
  if (!method) return respond(res, 400, "unsupported method");
  if ((method === "GET" || method === "HEAD") && parsed.body !== undefined) {
    return respond(res, 400, `${method} requests cannot include a body`);
  }
  if (parsed.body !== undefined && typeof parsed.body !== "string") {
    return respond(res, 400, "body must be a string");
  }

  try {
    await ensureProxyTargetAllowed(session, target);
  } catch (err) {
    if (err instanceof ProxyReject) return respond(res, err.status, err.message);
    throw err;
  }

  let outgoingHeaders: Record<string, string>;
  try {
    outgoingHeaders = sanitizeProxyHeaders(parsed.headers);
  } catch (err) {
    return respond(res, 400, (err as Error).message);
  }

  outgoingHeaders["user-agent"] = "capsule-runtime/0.1";

  let upstream: Response;
  try {
    const init: RequestInit = {
      method,
      headers: outgoingHeaders,
    };
    if (parsed.body !== undefined) init.body = parsed.body as string;
    upstream = await fetchAllowlisted(session, target, init);
  } catch (err) {
    if (err instanceof ProxyReject) return respond(res, err.status, err.message);
    return respond(res, 502, `upstream error: ${(err as Error).message}`);
  }

  let buf: Buffer;
  try {
    buf = await readResponseBytes(upstream, MAX_PROXY_RESPONSE_BYTES);
  } catch (err) {
    if (err instanceof ProxyReject) return respond(res, err.status, err.message);
    return respond(res, 502, `upstream error: ${(err as Error).message}`);
  }

  // Forward a minimal, safe subset of headers.
  const forwarded: Record<string, string> = { "content-type": "application/json" };
  const ct = upstream.headers.get("content-type");
  const outgoingResponse = {
    status: upstream.status,
    ok: upstream.ok,
    headers: { "content-type": ct ?? "application/octet-stream" },
    body_b64: buf.toString("base64"),
  };
  res.writeHead(200, forwarded);
  res.end(JSON.stringify(outgoingResponse));
}

class ProxyReject extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ProxyReject";
    this.status = status;
  }
}

function normalizeProxyMethod(raw: unknown): string | null {
  const method = String(raw ?? "GET").toUpperCase();
  return PROXY_METHODS.has(method) ? method : null;
}

function sanitizeProxyHeaders(input: unknown): Record<string, string> {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("headers must be an object");
  }

  const outgoingHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof k !== "string" || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k)) {
      throw new Error(`invalid header name: ${k}`);
    }
    if (typeof v !== "string") {
      throw new Error(`header value must be a string: ${k}`);
    }
    const lk = k.toLowerCase();
    if (
      lk === "cookie" ||
      lk === "authorization" ||
      lk === "host" ||
      lk === "content-length" ||
      lk.startsWith("sec-") ||
      lk.startsWith("proxy-")
    ) {
      continue;
    }
    outgoingHeaders[k] = v;
  }
  return outgoingHeaders;
}

async function fetchAllowlisted(
  session: CapsuleSession,
  start: URL,
  init: RequestInit,
): Promise<Response> {
  let current = start;
  for (let redirects = 0; redirects <= MAX_PROXY_REDIRECTS; redirects++) {
    await ensureProxyTargetAllowed(session, current);
    const upstream = await fetch(current.toString(), {
      ...init,
      redirect: "manual",
    });
    if (!isRedirect(upstream.status)) return upstream;

    const location = upstream.headers.get("location");
    if (!location) return upstream;
    if (redirects === MAX_PROXY_REDIRECTS) {
      throw new ProxyReject(502, "too many redirects");
    }
    current = new URL(location, current);
  }
  throw new ProxyReject(502, "too many redirects");
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

async function ensureProxyTargetAllowed(session: CapsuleSession, target: URL): Promise<void> {
  if (target.protocol !== "https:") {
    throw new ProxyReject(400, "only https allowed");
  }
  if (!hostAllowed(session.manifest.network.allow, target.host)) {
    throw new ProxyReject(403, "host not in network allowlist");
  }
  const declaration = session.manifest.permissions.find((p) => p.capability === "network.fetch");
  if (!declaration) {
    throw new ProxyReject(403, "network.fetch not declared");
  }
  if (!scopeCoversNetwork(declaration.scope, target.host)) {
    throw new ProxyReject(403, "host not in network.fetch scope");
  }
  await rejectUnsafeNetworkHost(target.hostname);
}

function hostAllowed(allow: readonly string[], host: string): boolean {
  // allow is matched against exact host[:port]. No wildcards in V1.
  const normalized = normalizeHost(host);
  return allow.some((h) => normalizeHost(h) === normalized);
}

function scopeCoversNetwork(scope: string | readonly string[], host: string): boolean {
  const normalized = normalizeHost(host);
  if (typeof scope === "string") {
    if (scope === "*" || scope === "any") return true;
    return normalizeHost(scope) === normalized;
  }
  return scope.some((h) => normalizeHost(h) === normalized);
}

async function rejectUnsafeNetworkHost(hostname: string): Promise<void> {
  const host = normalizeHostname(hostname);
  if (isUnsafeHostname(host)) {
    throw new ProxyReject(403, "local and private network hosts are blocked");
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: false });
  } catch (err) {
    throw new ProxyReject(502, `dns lookup failed: ${(err as Error).message}`);
  }
  if (addresses.some((addr) => isUnsafeIp(addr.address))) {
    throw new ProxyReject(403, "local and private network addresses are blocked");
  }
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, "");
}

function normalizeHostname(hostname: string): string {
  return normalizeHost(hostname).replace(/^\[/, "").replace(/\]$/, "");
}

function isUnsafeHostname(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    return true;
  }
  return isUnsafeIp(hostname);
}

function isUnsafeIp(address: string): boolean {
  const normalized = normalizeHostname(address);
  const family = isIP(normalized);
  if (family === 4) return isUnsafeIpv4(normalized);
  if (family === 6) return isUnsafeIpv6(normalized);
  return false;
}

function isUnsafeIpv4(address: string): boolean {
  const parts = address.split(".").map((p) => Number(p));
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isUnsafeIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    return isUnsafeIpv4(lower.slice("::ffff:".length));
  }
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("ff")
  );
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ProxyReject(502, "upstream response too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// ---------- helpers ----------

function readBody(req: http.IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (c: Buffer) => {
      total += c.byteLength;
      if (total > MAX_POST_BYTES) {
        req.destroy();
        return resolve(null);
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0)));
    req.on("error", reject);
  });
}

function respond(res: http.ServerResponse, status: number, text: string): void {
  if (!res.headersSent) {
    res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  }
  res.end(text);
}

// Re-exported helpers for host-page CSP decisions.
export { connectSrcFromManifest };
