import { describe, it, expect } from "vitest";
import {
  CapsuleError,
  base64ToBytes,
  bytesToBase64,
  embedCapsuleInHtml,
  extractEmbeddedCapsule,
  loadCapsuleFromBuffer,
  looksLikeHtml,
  packArchive,
} from "../src/index.js";
import { validManifest } from "./helpers.js";

const SLOT = '<script id="capsule-payload" type="application/vnd.capsule+zip;base64"></script>';
const enc = (s: string) => new TextEncoder().encode(s);

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof CapsuleError) return err.code;
    throw err;
  }
  return "ok";
}

async function sampleCapsule(): Promise<Uint8Array> {
  const { bytes } = await packArchive([
    { path: "capsule.json", bytes: enc(JSON.stringify(validManifest)) },
    { path: "content/index.html", bytes: enc("<!doctype html><h1>hi</h1>") },
  ]);
  return bytes;
}

describe("self-opening wrapper (.capsule.html)", () => {
  it("round-trips the archive bytes unchanged and sets the title", async () => {
    const capsule = await sampleCapsule();
    const html = embedCapsuleInHtml(`<!doctype html><title>Capsule</title>${SLOT}`, capsule, `A <b>&</b> "B"`);
    expect(html).toContain("<title>A &lt;b&gt;&amp;&lt;/b&gt; &quot;B&quot;</title>");
    const extracted = extractEmbeddedCapsule(enc(html));
    expect(Buffer.from(extracted).equals(Buffer.from(capsule))).toBe(true);
  });

  it("loads through loadCapsuleFromBuffer and reports wrapped", async () => {
    const capsule = await sampleCapsule();
    const html = embedCapsuleInHtml(`<!doctype html>${SLOT}`, capsule, "x");
    const loaded = await loadCapsuleFromBuffer(enc(html));
    expect(loaded.wrapped).toBe(true);
    expect(loaded.manifest.slug).toBe("test-capsule");
    expect((await loadCapsuleFromBuffer(capsule)).wrapped).toBe(false);
  });

  it("ignores payload-looking text inside other scripts and comments", async () => {
    const capsule = await sampleCapsule();
    const decoyScript = `<script>const t = '<script id="capsule-payload">AAAA';</script>`;
    const decoyComment = `<!-- <script id="capsule-payload">AAAA</script> -->`;
    const html = embedCapsuleInHtml(`<!doctype html>${decoyScript}${decoyComment}${SLOT}`, capsule, "x");
    expect(Buffer.from(extractEmbeddedCapsule(enc(html))).equals(Buffer.from(capsule))).toBe(true);
  });

  it("refuses ambiguous, missing, and malformed payloads", () => {
    expect(codeOf(() => extractEmbeddedCapsule(enc(`${SLOT}${SLOT}`)))).toBe("embed.ambiguous");
    expect(codeOf(() => extractEmbeddedCapsule(enc("<!doctype html><p>no capsule</p>")))).toBe("embed.missing");
    expect(codeOf(() => extractEmbeddedCapsule(enc(SLOT)))).toBe("embed.missing");
    expect(codeOf(() => extractEmbeddedCapsule(enc('<script id=capsule-payload>not*base64!</script>')))).toBe("embed.invalid");
  });

  it("refuses templates without exactly one empty slot", async () => {
    const capsule = await sampleCapsule();
    expect(codeOf(() => embedCapsuleInHtml("<p>no slot</p>", capsule, "x"))).toBe("embed.missing");
    expect(codeOf(() => embedCapsuleInHtml(`${SLOT}${SLOT}`, capsule, "x"))).toBe("embed.ambiguous");
    const filled = embedCapsuleInHtml(SLOT, capsule, "x");
    expect(codeOf(() => embedCapsuleInHtml(filled, capsule, "x"))).toBe("embed.ambiguous");
  });

  it("tells HTML from ZIP", async () => {
    expect(looksLikeHtml(await sampleCapsule())).toBe(false);
    expect(looksLikeHtml(enc("﻿  \n<!doctype html>"))).toBe(true);
    expect(looksLikeHtml(enc("hello"))).toBe(false);
  });

  it("base64 helpers round-trip large binary input", () => {
    const data = new Uint8Array(200_000).map((_, i) => (i * 31) & 0xff);
    expect(Buffer.from(base64ToBytes(bytesToBase64(data))).equals(Buffer.from(data))).toBe(true);
  });
});
