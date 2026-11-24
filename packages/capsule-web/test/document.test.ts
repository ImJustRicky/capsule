import { describe, expect, it } from "vitest";
import {
  createInlineContext,
  dataUrlFor,
  mimeFor,
  normalizeArchivePath,
  resolveArchiveRef,
  rewriteCss,
  rewriteSrcset,
} from "../src/document.js";
import type { ReadArchiveResult } from "../src/zip.js";

function archiveOf(files: Record<string, string>): ReadArchiveResult {
  const entries = Object.entries(files).map(([path, text]) => {
    const bytes = new TextEncoder().encode(text);
    return { path, bytes, compressedSize: bytes.length, uncompressedSize: bytes.length, isDirectory: path.endsWith("/") };
  });
  return { entries, byPath: new Map(entries.map((e) => [e.path, e] as const)) };
}

const archive = archiveOf({
  "capsule.json": "{}",
  "content/index.html": "<p>",
  "content/style.css": "body{}",
  "content/img/logo.svg": "<svg/>",
  "content/sub/page.html": "<p>",
  "assets/font.woff2": "font",
  "assets/bg.png": "png",
  "theme.css": "root{}",
});

describe("normalizeArchivePath", () => {
  it("resolves dot segments and refuses to escape the root", () => {
    expect(normalizeArchivePath("content/./img/../style.css")).toBe("content/style.css");
    expect(normalizeArchivePath("content/../../etc/passwd")).toBeNull();
    expect(normalizeArchivePath("")).toBeNull();
  });
});

describe("resolveArchiveRef", () => {
  const r = (ref: string, base = "content/") => resolveArchiveRef(archive, ref, base, "content/");

  it("resolves relative to the referring file first", () => {
    expect(r("style.css")).toBe("content/style.css");
    expect(r("img/logo.svg?v=2#frag")).toBe("content/img/logo.svg");
    expect(r("../assets/bg.png")).toBe("assets/bg.png");
    expect(r("../style.css", "content/sub/")).toBe("content/style.css");
  });

  it("falls back to archive-root and entry-relative lookups like the Node runtime", () => {
    expect(r("assets/bg.png")).toBe("assets/bg.png");
    expect(r("theme.css")).toBe("theme.css");
    expect(r("style.css", "content/sub/")).toBe("content/style.css");
    expect(r("/assets/font.woff2")).toBe("assets/font.woff2");
  });

  it("decodes percent-escapes", () => {
    const a = archiveOf({ "content/my file.css": "x" });
    expect(resolveArchiveRef(a, "my%20file.css", "content/", "content/")).toBe("content/my file.css");
  });

  it("ignores external URLs, fragments, and missing files", () => {
    for (const ref of ["https://cdn.test/x.js", "//cdn.test/x.js", "data:,x", "javascript:alert(1)", "#top", "", "missing.css", "../../../etc/passwd"]) {
      expect(r(ref)).toBeNull();
    }
  });
});

describe("CSS rewriting", () => {
  it("inlines local url() as data: URLs and leaves external ones alone", () => {
    const ctx = createInlineContext(archive, "content/index.html");
    const out = rewriteCss(
      ctx,
      `a{background:url(../assets/bg.png)} b{src:url("../assets/font.woff2")} c{background:url('https://x.test/y.png')}`,
      "content/",
    );
    expect(out).toContain(`url("data:image/png;base64,${btoa("png")}")`);
    expect(out).toContain(`url("data:font/woff2;base64,${btoa("font")}")`);
    expect(out).toContain(`url('https://x.test/y.png')`);
  });

  it("inlines local @import, keeps media conditions, strips nested @charset", () => {
    const a = archiveOf({
      "content/index.html": "",
      "content/a.css": `@import url("b.css") print; .a{}`,
      "content/b.css": `@charset "utf-8"; .b{background:url(img.png)}`,
      "content/img.png": "i",
    });
    const ctx = createInlineContext(a, "content/index.html");
    const out = rewriteCss(ctx, `@import "a.css"; @import url(https://fonts.test/x.css);`, "content/");
    expect(out).toContain(".a{}");
    expect(out).toContain("@media print {");
    expect(out).toContain(".b{background:url(\"data:image/png;base64,");
    expect(out).not.toContain("@charset");
    expect(out).toContain("@import url(https://fonts.test/x.css);");
  });

  it("stops recursive @import cycles", () => {
    const a = archiveOf({ "content/index.html": "", "content/loop.css": `@import "loop.css"; .x{}` });
    const ctx = createInlineContext(a, "content/index.html");
    const out = rewriteCss(ctx, `@import "loop.css";`, "content/");
    expect(out.match(/\.x\{\}/g)?.length).toBe(8);
  });

  it("rewrites srcset candidates and keeps descriptors", () => {
    const ctx = createInlineContext(archive, "content/index.html");
    const out = rewriteSrcset(ctx, "img/logo.svg 1x, https://x.test/a.png 2x", "content/");
    expect(out).toMatch(/^data:image\/svg\+xml;base64,\S+ 1x, https:\/\/x\.test\/a\.png 2x$/);
  });

  it("caches data: URLs per path", () => {
    const ctx = createInlineContext(archive, "content/index.html");
    expect(dataUrlFor(ctx, "assets/bg.png")).toBe(dataUrlFor(ctx, "assets/bg.png"));
    expect(ctx.dataUrls.size).toBe(1);
  });

  it("maps common extensions to MIME types", () => {
    expect(mimeFor("a/b.JS")).toBe("text/javascript");
    expect(mimeFor("x.woff2")).toBe("font/woff2");
    expect(mimeFor("noext")).toBe("application/octet-stream");
  });
});
