import type { CapabilityName, CapsuleManifest, PermissionRequest } from "@capsule/core/browser";

/**
 * Pure capability rules for the browser runtime. These mirror the Node
 * reference runtime (capsule-runtime host.js + server.ts) so a capsule gets
 * the same decisions in either place:
 *
 *   1. undeclared capability          → capability.not_declared (no prompt)
 *   2. scope does not cover request   → capability.scope_violation (no prompt)
 *   3. user decision                  → granted / capability.denied
 *   4. network targets additionally need https, the manifest allowlist, the
 *      network.fetch scope, and a public host.
 */

export const CAPABILITY_NAMES: readonly CapabilityName[] = [
  "storage.local",
  "filesystem.import",
  "filesystem.export",
  "clipboard.write",
  "network.fetch",
  "dialog.open",
];

/**
 * Plain-language wording for the Open Screen and permission prompts. People
 * deciding whether to run something should never have to parse jargon like
 * "host-mediated" or "scope".
 */

/** "This capsule can …" */
export const CAPABILITY_CAN: Record<CapabilityName, string> = {
  "storage.local": "Save its own data on this device",
  "filesystem.import": "Open files you choose",
  "filesystem.export": "Save files where you choose",
  "clipboard.write": "Copy text to your clipboard",
  "network.fetch": "Connect to specific websites",
  "dialog.open": "Show pop-up messages",
};

/** "Allow <name> to …?" */
export const CAPABILITY_ASK: Record<CapabilityName, string> = {
  "storage.local": "save data on this device",
  "filesystem.import": "open a file you choose",
  "filesystem.export": "save a file where you choose",
  "clipboard.write": "copy text to your clipboard",
  "network.fetch": "connect to",
  "dialog.open": "show pop-up messages",
};

/** Blocked no matter what the manifest says (shown under Details). */
export const ALWAYS_DENIED: readonly string[] = [
  "Run programs or shell commands",
  "Read files you didn’t choose",
  "Read your clipboard",
  "Update itself",
  "Use your camera, microphone, or location",
  "Reach devices on your local network",
];

/** Hosts a network.fetch grant can actually reach: allowlisted, in scope, public. */
export function reachableHosts(manifest: CapsuleManifest): string[] {
  const declaration = declarationFor(manifest, "network.fetch");
  if (!declaration) return [];
  return manifest.network.allow.filter(
    (h) => scopeCovers(declaration.scope, h) && !isLocalOrPrivateHost(h.replace(/:\d+$/, "")),
  );
}

/** One plain sentence describing everything the capsule cannot do. */
export function cannotSentence(manifest: CapsuleManifest): string {
  const requested = new Set(manifest.permissions.map((p) => p.capability));
  if (requested.size === 0) {
    return "It runs entirely inside its own window: no internet, no saved data, and no access to your files, clipboard, or anything else on your computer.";
  }
  const parts: string[] = [];
  parts.push(requested.has("network.fetch") ? "connect to any other website" : "use the internet");
  parts.push(requested.has("filesystem.import") ? "see files you don’t choose" : "see your files");
  parts.push("read your clipboard");
  return `It can’t ${parts.join(", ")}, or reach anything else on your computer.`;
}

export class CapabilityError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CapabilityError";
    this.code = code;
  }
}

export function isCapabilityName(value: string): value is CapabilityName {
  return (CAPABILITY_NAMES as readonly string[]).includes(value);
}

export function declarationFor(
  manifest: CapsuleManifest,
  capability: string,
): PermissionRequest | null {
  return manifest.permissions.find((p) => p.capability === capability) ?? null;
}

/** The concrete scope value a call targets, or null when the capability is unscoped. */
export function extractScope(capability: string, args: unknown): string | null {
  if (capability !== "network.fetch") return null;
  const url = (args as { url?: unknown } | null | undefined)?.url;
  if (typeof url !== "string") return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function normalizeHost(host: string): string {
  return String(host).toLowerCase().replace(/\.$/, "");
}

export function scopeCovers(declared: string | readonly string[], requested: string | null): boolean {
  if (requested === null) return true;
  const normalized = normalizeHost(requested);
  if (typeof declared === "string") {
    if (declared === "*" || declared === "any") return true;
    return normalizeHost(declared) === normalized;
  }
  return declared.some((item) => normalizeHost(item) === normalized);
}

/** Exact host[:port] match against manifest.network.allow. No wildcards in V1. */
export function hostAllowed(allow: readonly string[], host: string): boolean {
  const normalized = normalizeHost(host);
  return allow.some((h) => normalizeHost(h) === normalized);
}

/**
 * Literal local / private / special-purpose host check. A browser cannot
 * resolve DNS, so names that *resolve* to private addresses are left to the
 * browser's own Private Network Access protections; see WEB-VIEWER.md.
 * Input must come from `URL.hostname`, which canonicalizes numeric IPv4 forms
 * such as `2130706433` or `0x7f.1` to dotted quads first.
 */
export function isLocalOrPrivateHost(hostname: string): boolean {
  const host = normalizeHost(hostname).replace(/^\[/, "").replace(/\]$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isPrivateIpv4(host);
  if (host.includes(":")) return isPrivateIpv6(host);
  return false;
}

function isPrivateIpv4(address: string): boolean {
  const [a = 0, b = 0] = address.split(".").map(Number);
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

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    const rest = lower.slice("::ffff:".length);
    if (rest.includes(".")) return isPrivateIpv4(rest);
    // URL canonicalizes ::ffff:127.0.0.1 to ::ffff:7f00:1.
    const groups = rest.split(":");
    if (groups.length === 2) {
      const hi = parseInt(groups[0]!, 16);
      const lo = parseInt(groups[1]!, 16);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        return isPrivateIpv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
      }
    }
    return true;
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

/** Validate a network.fetch target. Mirrors the Node proxy's ensureProxyTargetAllowed. */
export function checkFetchTarget(manifest: CapsuleManifest, rawUrl: unknown): URL {
  if (typeof rawUrl !== "string") throw new CapabilityError("network.invalid_url", "url must be a string");
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new CapabilityError("network.invalid_url", "invalid url");
  }
  if (target.protocol !== "https:") throw new CapabilityError("network.blocked", "only https allowed");
  if (target.username || target.password) {
    throw new CapabilityError("network.blocked", "credentials in URLs are not allowed");
  }
  if (!hostAllowed(manifest.network.allow, target.host)) {
    throw new CapabilityError("network.blocked", "host not in network allowlist");
  }
  const declaration = declarationFor(manifest, "network.fetch");
  if (!declaration) throw new CapabilityError("network.blocked", "network.fetch not declared");
  if (!scopeCovers(declaration.scope, target.host)) {
    throw new CapabilityError("network.blocked", "host not in network.fetch scope");
  }
  if (isLocalOrPrivateHost(target.hostname)) {
    throw new CapabilityError("network.blocked", "local and private network hosts are blocked");
  }
  return target;
}

const FETCH_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

export function normalizeFetchMethod(raw: unknown): string {
  const method = String(raw ?? "GET").toUpperCase();
  if (!FETCH_METHODS.has(method)) {
    throw new CapabilityError("network.invalid_request", "unsupported method");
  }
  return method;
}

/** Same header policy as the Node proxy: no cookies, auth, host, sec-*, proxy-*. */
export function sanitizeRequestHeaders(input: unknown): Record<string, string> {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new CapabilityError("network.invalid_request", "headers must be an object");
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k)) {
      throw new CapabilityError("network.invalid_request", `invalid header name: ${k}`);
    }
    if (typeof v !== "string") {
      throw new CapabilityError("network.invalid_request", `header value must be a string: ${k}`);
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
    out[k] = v;
  }
  return out;
}

/**
 * `connect-src` value for the viewer page once a capsule runs: only the hosts
 * that are both allowlisted and inside the network.fetch scope.
 */
export function connectSrcFor(manifest: CapsuleManifest): string {
  const hosts = reachableHosts(manifest);
  if (hosts.length === 0) return "'none'";
  return hosts.map((h) => `https://${normalizeHost(h)}`).join(" ");
}
