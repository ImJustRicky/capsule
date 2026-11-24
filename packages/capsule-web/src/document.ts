import { bytesToBase64 } from "@capsule/core/browser";
import type { ReadArchiveResult } from "./zip.js";

/**
 * Turns a capsule page into a single self-contained HTML string for a
 * sandboxed `srcdoc` iframe.
 *
 * A browser-only runtime has no server to answer `style.css` or `logo.png`,
 * so every local reference the page makes declaratively (scripts, styles,
 * images, media, fonts, CSS url()/@import, srcset) is resolved against the
 * archive and inlined as a data: URL. The capsule's CSP is the very first
 * element of <head>, followed by the shared capability bridge, so nothing the
 * author wrote can run or load before the policy is in force.
 *
 * Path resolution and CSS rewriting are pure functions so they can be
 * unit-tested outside a browser; only `buildCapsuleDocument` needs the DOM.
 */

/** CSP for capsule documents. Kept in lockstep with the Node runtime's iframe CSP. */
export const CAPSULE_DOCUMENT_CSP = [
  "default-src 'none'",
  // 'unsafe-inline' lets single-file apps (the typical AI-tool output) run.
  // It grants nothing extra: capsule code is untrusted by definition, and the
  // isolation comes from the opaque-origin sandbox plus connect-src 'none'.
  // data: is how the viewer delivers the capsule's own script files.
  "script-src 'unsafe-inline' data:",
  "style-src 'unsafe-inline' data:",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data: blob:",
  "connect-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const MIME: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  txt: "text/plain",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  bmp: "image/bmp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  vtt: "text/vtt",
  wasm: "application/wasm",
};

export function mimeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return MIME[path.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
}

export function dirnameOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash + 1);
}

/** Resolve "." and ".." segments. Returns null if the path escapes the archive root. */
export function normalizeArchivePath(path: string): string | null {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.length ? out.join("/") : null;
}

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Resolve a reference found in a capsule page to an archive file path.
 * Returns null for external URLs, fragments, or files that do not exist.
 *
 * Candidates, in order:
 *   1. relative to the referring file's directory (standard URL semantics)
 *   2. relative to the archive root
 *   3. relative to the entry file's directory
 * (2) and (3) reproduce how the Node runtime serves files, so capsules that
 * work there work here too.
 */
export function resolveArchiveRef(
  archive: ReadArchiveResult,
  ref: string,
  baseDir: string,
  entryDir: string,
): string | null {
  let r = ref.trim();
  if (!r || r.startsWith("#") || r.startsWith("//") || SCHEME.test(r)) return null;
  r = r.split("#")[0]!.split("?")[0]!;
  if (!r) return null;
  try {
    r = decodeURIComponent(r);
  } catch {
    return null;
  }
  const candidates = r.startsWith("/")
    ? [normalizeArchivePath(r.slice(1))]
    : [normalizeArchivePath(baseDir + r), normalizeArchivePath(r), normalizeArchivePath(entryDir + r)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const entry = archive.byPath.get(candidate);
    if (entry && !entry.isDirectory) return candidate;
  }
  return null;
}

export interface InlineContext {
  archive: ReadArchiveResult;
  entryDir: string;
  /** Cache of path → data: URL so a repeated asset is encoded once. */
  dataUrls: Map<string, string>;
}

export function createInlineContext(archive: ReadArchiveResult, entry: string): InlineContext {
  return { archive, entryDir: dirnameOf(entry), dataUrls: new Map() };
}

export function dataUrlFor(ctx: InlineContext, path: string, mimeOverride?: string): string {
  const key = mimeOverride ? `${mimeOverride}\0${path}` : path;
  const cached = ctx.dataUrls.get(key);
  if (cached) return cached;
  const entry = ctx.archive.byPath.get(path);
  const bytes = entry?.bytes ?? new Uint8Array(0);
  const url = `data:${mimeOverride ?? mimeFor(path)};base64,${bytesToBase64(bytes)}`;
  ctx.dataUrls.set(key, url);
  return url;
}

function textOf(ctx: InlineContext, path: string): string {
  const entry = ctx.archive.byPath.get(path);
  return entry ? new TextDecoder("utf-8").decode(entry.bytes) : "";
}

const CSS_IMPORT =
  /@import\s+(?:url\(\s*(["']?)([^"')]+)\1\s*\)|(["'])([^"']+)\3)\s*([^;]*);/gi;
const CSS_URL = /url\(\s*(["']?)([^"')]*?)\1\s*\)/gi;
const MAX_IMPORT_DEPTH = 8;

/** Inline local @import rules and rewrite local url() references to data: URLs. */
export function rewriteCss(ctx: InlineContext, css: string, cssDir: string, depth = 0): string {
  const withImports = css.replace(
    CSS_IMPORT,
    (match, _q1: string, url1: string | undefined, _q2: string, url2: string | undefined, condition: string) => {
      const ref = url1 ?? url2 ?? "";
      const resolved = resolveArchiveRef(ctx.archive, ref, cssDir, ctx.entryDir);
      if (!resolved) return match; // external import: left alone, CSP blocks it
      if (depth >= MAX_IMPORT_DEPTH) return "";
      const inner = rewriteCss(ctx, textOf(ctx, resolved), dirnameOf(resolved), depth + 1).replace(
        /@charset\s+["'][^"']*["']\s*;/gi,
        "",
      );
      const media = condition.trim();
      if (!media || /^(layer|supports)\b/i.test(media)) return inner;
      return `@media ${media} {\n${inner}\n}`;
    },
  );
  return withImports.replace(CSS_URL, (match, _q: string, ref: string) => {
    const resolved = resolveArchiveRef(ctx.archive, ref, cssDir, ctx.entryDir);
    return resolved ? `url("${dataUrlFor(ctx, resolved)}")` : match;
  });
}

/** Rewrite every local URL in a srcset attribute value. */
export function rewriteSrcset(ctx: InlineContext, value: string, baseDir: string): string {
  return value
    .split(",")
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) return trimmed;
      const [url = "", ...descriptor] = trimmed.split(/\s+/);
      const resolved = resolveArchiveRef(ctx.archive, url, baseDir, ctx.entryDir);
      return [resolved ? dataUrlFor(ctx, resolved) : url, ...descriptor].join(" ");
    })
    .join(", ");
}

export interface BuildDocumentOptions {
  archive: ReadArchiveResult;
  /** The manifest entry (used for Node-compatible path fallbacks). */
  entry: string;
  /** Archive path of the page being rendered (the entry, or a linked page). */
  pagePath: string;
  /** Source of the shared capability bridge (capsule-runtime/src/host/bridge.js). */
  bridgeSource: string;
  /** Source of the in-capsule navigation shim. */
  navShimSource: string;
  /** CSP to enforce inside the document. */
  csp?: string;
}

const URL_ATTRIBUTES: ReadonlyArray<readonly [string, string]> = [
  ["img", "src"],
  ["source", "src"],
  ["video", "src"],
  ["video", "poster"],
  ["audio", "src"],
  ["track", "src"],
  ["input", "src"],
];

/** Build the srcdoc HTML for one capsule page. Browser-only (uses DOMParser). */
export function buildCapsuleDocument(opts: BuildDocumentOptions): string {
  const ctx = createInlineContext(opts.archive, opts.entry);
  const pageDir = dirnameOf(opts.pagePath);
  const resolve = (ref: string | null, baseDir = pageDir) =>
    ref === null ? null : resolveArchiveRef(opts.archive, ref, baseDir, ctx.entryDir);

  const doc = new DOMParser().parseFromString(textOf(ctx, opts.pagePath), "text/html");

  // Elements that could redirect URL resolution or navigate the frame.
  for (const el of Array.from(doc.querySelectorAll("base, meta[http-equiv='refresh' i]"))) el.remove();

  for (const link of Array.from(doc.querySelectorAll("link[href]"))) {
    const rel = (link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
    const resolved = resolve(link.getAttribute("href"));
    if (!resolved) continue;
    if (rel.includes("stylesheet")) {
      const style = doc.createElement("style");
      const media = link.getAttribute("media");
      if (media) style.setAttribute("media", media);
      style.textContent = rewriteCss(ctx, textOf(ctx, resolved), dirnameOf(resolved));
      link.replaceWith(style);
    } else {
      link.setAttribute("href", dataUrlFor(ctx, resolved));
      link.removeAttribute("integrity");
      link.removeAttribute("crossorigin");
    }
  }

  // External scripts become data: URLs (not inline text) so defer/async/module
  // semantics and execution order are exactly what the author wrote.
  for (const script of Array.from(doc.querySelectorAll("script[src]"))) {
    const resolved = resolve(script.getAttribute("src"));
    if (!resolved) continue;
    script.setAttribute("src", dataUrlFor(ctx, resolved, "text/javascript"));
    script.removeAttribute("integrity");
    script.removeAttribute("crossorigin");
  }

  for (const [tag, attr] of URL_ATTRIBUTES) {
    for (const el of Array.from(doc.querySelectorAll(`${tag}[${attr}]`))) {
      const resolved = resolve(el.getAttribute(attr));
      if (resolved) el.setAttribute(attr, dataUrlFor(ctx, resolved));
    }
  }
  for (const el of Array.from(doc.querySelectorAll("img[srcset], source[srcset]"))) {
    el.setAttribute("srcset", rewriteSrcset(ctx, el.getAttribute("srcset") ?? "", pageDir));
  }
  for (const el of Array.from(doc.querySelectorAll("image, feImage"))) {
    for (const attr of ["href", "xlink:href"]) {
      const resolved = resolve(el.getAttribute(attr));
      if (resolved) el.setAttribute(attr, dataUrlFor(ctx, resolved));
    }
  }
  for (const style of Array.from(doc.querySelectorAll("style"))) {
    style.textContent = rewriteCss(ctx, style.textContent ?? "", pageDir);
  }
  for (const el of Array.from(doc.querySelectorAll("[style]"))) {
    el.setAttribute("style", rewriteCss(ctx, el.getAttribute("style") ?? "", pageDir));
  }

  // Policy first, bridge second, author content after.
  const head = doc.head;
  const csp = doc.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", opts.csp ?? CAPSULE_DOCUMENT_CSP);
  const bridge = doc.createElement("script");
  bridge.textContent = opts.bridgeSource;
  const nav = doc.createElement("script");
  nav.textContent = opts.navShimSource;
  head.prepend(csp, bridge, nav);

  const doctype = doc.doctype ? new XMLSerializer().serializeToString(doc.doctype) + "\n" : "";
  return doctype + doc.documentElement.outerHTML;
}
