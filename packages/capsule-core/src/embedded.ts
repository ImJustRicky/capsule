import { CapsuleError, ErrorCode } from "./errors.js";

/**
 * Self-opening capsule wrapper (`.capsule.html`).
 *
 * A self-opening capsule is an HTML file that carries a complete viewer plus
 * the unmodified `.capsule` archive, base64-encoded inside exactly one
 *
 *   <script id="capsule-payload" type="application/vnd.capsule+zip;base64">…</script>
 *
 * element. Browsers never execute a script element with an unknown type, so
 * the payload is inert data. Any runtime can pull the original archive back
 * out with `extractEmbeddedCapsule` and verify it with its own trusted code.
 *
 * This module has no Node.js dependencies; the browser viewer uses it too.
 */

export const EMBEDDED_PAYLOAD_ID = "capsule-payload";
export const EMBEDDED_PAYLOAD_TYPE = "application/vnd.capsule+zip;base64";

interface ScriptSpan {
  /** Index of the first byte of the element's text content. */
  contentStart: number;
  /** Index one past the last byte of the element's text content. */
  contentEnd: number;
  attrs: string;
}

/**
 * Tokenize top-level <script> elements the way the HTML parser does for the
 * common case: comments are skipped, and the body of each script runs to the
 * next `</script`. Text that merely *mentions* `<script` inside another
 * script's body is therefore never mistaken for a payload element.
 */
function scanScripts(html: string): ScriptSpan[] {
  const lower = html.toLowerCase();
  const spans: ScriptSpan[] = [];
  let i = 0;
  while (i < lower.length) {
    const lt = lower.indexOf("<", i);
    if (lt < 0) break;
    // "<!--" spelled via char codes: this module is bundled into the viewer's
    // inline <script>, where that literal would put the HTML tokenizer into
    // script-escape state.
    if (lower.charCodeAt(lt + 1) === 0x21 && lower.startsWith("--", lt + 2)) {
      const end = lower.indexOf("-->", lt + 4);
      if (end < 0) break;
      i = end + 3;
      continue;
    }
    if (lower.startsWith("<script", lt) && /[\s>/]/.test(lower.charAt(lt + 7))) {
      const openEnd = lower.indexOf(">", lt + 7);
      if (openEnd < 0) break;
      const close = lower.indexOf("</script", openEnd + 1);
      if (close < 0) break;
      spans.push({
        contentStart: openEnd + 1,
        contentEnd: close,
        attrs: html.slice(lt + 7, openEnd),
      });
      const closeEnd = lower.indexOf(">", close);
      i = closeEnd < 0 ? lower.length : closeEnd + 1;
      continue;
    }
    i = lt + 1;
  }
  return spans;
}

function isPayloadScript(span: ScriptSpan): boolean {
  return /(?:^|\s)id\s*=\s*(?:"capsule-payload"|'capsule-payload'|capsule-payload(?=[\s/]|$))/i.test(
    span.attrs,
  );
}

function findPayloadScript(html: string): ScriptSpan | null {
  const matches = scanScripts(html).filter(isPayloadScript);
  if (matches.length > 1) {
    throw new CapsuleError(
      ErrorCode.EmbedAmbiguous,
      `HTML contains ${matches.length} capsule payload elements; expected exactly one`,
    );
  }
  return matches[0] ?? null;
}

/** True if the bytes look like an HTML document rather than a ZIP archive. */
export function looksLikeHtml(bytes: Uint8Array): boolean {
  // ZIP local file header magic: "PK\x03\x04".
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return false;
  let i = 0;
  // Skip a UTF-8 BOM and leading whitespace.
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) {
    i++;
  }
  return bytes[i] === 0x3c; // "<"
}

/**
 * Extract the `.capsule` archive bytes from a self-opening HTML file.
 * Throws `embed.missing` if the HTML carries no payload, `embed.ambiguous` if
 * it carries more than one, and `embed.invalid` if the payload is not base64.
 */
export function extractEmbeddedCapsule(htmlBytes: Uint8Array): Uint8Array {
  const html = new TextDecoder("utf-8").decode(htmlBytes);
  const span = findPayloadScript(html);
  const encoded = span ? html.slice(span.contentStart, span.contentEnd).replace(/\s+/g, "") : "";
  if (!span || encoded.length === 0) {
    throw new CapsuleError(
      ErrorCode.EmbedMissing,
      "this HTML file does not contain an embedded capsule",
    );
  }
  return base64ToBytes(encoded);
}

/**
 * Produce a self-opening HTML file from a viewer template (which must contain
 * exactly one empty payload element) and raw `.capsule` bytes.
 */
export function embedCapsuleInHtml(
  template: string,
  capsuleBytes: Uint8Array,
  title: string,
): string {
  const span = findPayloadScript(template);
  if (!span) {
    throw new CapsuleError(
      ErrorCode.EmbedMissing,
      "viewer template has no capsule payload element",
    );
  }
  if (template.slice(span.contentStart, span.contentEnd).trim().length > 0) {
    throw new CapsuleError(
      ErrorCode.EmbedAmbiguous,
      "viewer template already contains an embedded capsule",
    );
  }
  const encoded = wrap(bytesToBase64(capsuleBytes), 120);
  let out =
    template.slice(0, span.contentStart) + "\n" + encoded + "\n" + template.slice(span.contentEnd);
  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  return out;
}

function wrap(text: string, width: number): string {
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
  return lines.join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  return btoa(binary);
}

export function base64ToBytes(encoded: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new CapsuleError(ErrorCode.EmbedInvalid, "embedded capsule payload is not valid base64");
  }
  const binary = atob(encoded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
