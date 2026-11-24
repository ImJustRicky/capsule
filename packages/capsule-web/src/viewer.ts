import { CapsuleError, base64ToBytes, type CapsuleManifest } from "@capsule/core/browser";
import {
  ALWAYS_DENIED,
  CAPABILITY_ASK,
  CAPABILITY_CAN,
  cannotSentence,
  connectSrcFor,
  isCapabilityName,
  reachableHosts,
} from "./capabilities.js";
import { buildCapsuleDocument, dirnameOf, resolveArchiveRef } from "./document.js";
import { CapabilityHost, isCapsuleRequest, type CapsuleReply, type HostUi } from "./host.js";
import { loadCapsule, type LoadedCapsule } from "./load.js";

/**
 * Capsule browser viewer. One file, two modes:
 *   - hosted:   a static page; open a capsule by drop, file picker, or ?src=
 *   - embedded: inside a self-opening .capsule.html; the archive is in the
 *               #capsule-payload element and opens immediately.
 * Nothing is uploaded anywhere: parsing, verification, and execution all
 * happen in this tab.
 */

type Mode = "hosted" | "embedded";

const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const SANDBOX_FLAGS = "allow-scripts allow-forms";
const SVG_NS = "http://www.w3.org/2000/svg";

interface ViewerState {
  mode: Mode;
  loaded: LoadedCapsule | null;
  host: CapabilityHost | null;
  frame: HTMLIFrameElement | null;
  currentPage: string | null;
  sourceLabel: string;
  /** True once the viewer's connect-src has been narrowed for a running capsule. */
  networkLocked: boolean;
}

const state: ViewerState = {
  mode: "hosted",
  loaded: null,
  host: null,
  frame: null,
  currentPage: null,
  sourceLabel: "",
  networkLocked: false,
};

// ---------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`viewer: missing #${id}`);
  return el as T;
}

function show(id: string): void {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(".screen"))) {
    el.classList.toggle("hidden", el.id !== id);
  }
  document.body.classList.toggle("running", id === "run-screen");
  $(id).scrollTop = 0;
}

function visibleScreen(): string | undefined {
  return document.querySelector<HTMLElement>(".screen:not(.hidden)")?.id;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Monochrome 16px line icon from one or more path strings ("|"-separated). */
function icon(paths: string, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths.split("|")) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.4");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
  }
  return svg;
}

const ICONS = {
  "storage.local": "M3.5 2.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z|M5.5 8h5",
  "filesystem.import": "M8 13.5v-7M5 9.2l3-3 3 3|M3 2.5h10",
  "filesystem.export": "M8 2.5v7M5 6.8l3 3 3-3|M3 12.5h10",
  "clipboard.write": "M5.5 3.5h-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1|M6 2.5h4v2H6z",
  "network.fetch": "M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8Z|M1.8 8h12.4|M8 1.8c1.7 1.8 2.4 3.9 2.4 6.2S9.7 12.4 8 14.2C6.3 12.4 5.6 10.3 5.6 8S6.3 3.6 8 1.8Z",
  "dialog.open": "M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v5.5A1.5 1.5 0 0 1 12 11H7l-3 2.5V11a1.5 1.5 0 0 1-1.5-1.5Z",
  verified: "M8 1.25a6.75 6.75 0 1 0 0 13.5 6.75 6.75 0 0 0 0-13.5Z|M5.3 8.2l1.8 1.8 3.6-3.8",
  unsealed: "M8 1.25a6.75 6.75 0 1 0 0 13.5 6.75 6.75 0 0 0 0-13.5Z|M8 4.8v3.8|M8 11.1v.1",
  chevron: "M6 3.5l4.5 4.5L6 12.5",
} as const;

/** First letter of the first word, for the flat app icon. */
function initialOf(name: string): string {
  const letter = Array.from(name.trim()).find((c) => /\p{L}|\p{N}/u.test(c));
  return (letter ?? "•").toLocaleUpperCase();
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(message: string): void {
  const node = $("toast");
  node.textContent = message;
  node.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.add("hidden"), 6000);
}

// ---------------------------------------------------------------------
// Dialogs (serialized so overlapping capability requests queue up)
// ---------------------------------------------------------------------

let dialogQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = dialogQueue.then(task, task);
  dialogQueue = run.catch(() => undefined);
  return run;
}

function modal(dialogId: string, confirmId: string, cancelId: string, focusCancel: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = $<HTMLDialogElement>(dialogId);
    const ok = $(confirmId);
    const cancel = $(cancelId);
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      ok.removeEventListener("click", onOk);
      cancel.removeEventListener("click", onCancel);
      dlg.removeEventListener("cancel", onEsc);
      dlg.removeEventListener("close", onClose);
      if (dlg.open) dlg.close();
      resolve(value);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onEsc = (e: Event) => {
      e.preventDefault();
      finish(false);
    };
    const onClose = () => finish(false);
    ok.addEventListener("click", onOk);
    cancel.addEventListener("click", onCancel);
    dlg.addEventListener("cancel", onEsc);
    dlg.addEventListener("close", onClose);
    if (!dlg.open) dlg.showModal();
    (focusCancel ? cancel : ok).focus();
  });
}

const ui: HostUi = {
  promptPermission(capability, scope, reason) {
    return serialized(async () => {
      const name = state.loaded?.manifest.name ?? "This capsule";
      const ask = isCapabilityName(capability) ? CAPABILITY_ASK[capability] : capability;
      $("perm-title").textContent = `Allow ${name} to ${ask}${scope ? ` ${scope}` : ""}?`;
      $("perm-detail").textContent = reason ? `The author says: “${reason}”` : "";
      const allowed = await modal("permission-dialog", "perm-allow", "perm-deny", true);
      return allowed ? "granted" : "denied";
    });
  },
  requestGesture(message, actionLabel) {
    return serialized(async () => {
      $("gesture-title").textContent = message;
      $("gesture-detail").textContent = "";
      $("gesture-continue").textContent = actionLabel;
      return modal("gesture-dialog", "gesture-continue", "gesture-cancel", false);
    });
  },
  alert: (message) => window.alert(message),
  confirm: (message) => window.confirm(message),
  prompt: (message, defaultValue) => window.prompt(message, defaultValue),
  notify: toast,
};

// ---------------------------------------------------------------------
// Opening capsules
// ---------------------------------------------------------------------

async function openBytes(bytes: Uint8Array, sourceLabel: string): Promise<void> {
  show("loading-screen");
  $("loading-text").textContent = "Checking capsule…";
  try {
    const loaded = await loadCapsule(bytes);
    state.loaded = loaded;
    state.sourceLabel = sourceLabel;
    state.host = new CapabilityHost(loaded.manifest, loaded.integrity.actual, ui);
    state.host.record("open", { detail: sourceLabel });
    renderOpenScreen(loaded);
    show("open-screen");
    // Put keyboard focus on the main action without drawing a focus ring
    // for mouse and touch users.
    ($("btn-run") as HTMLElement & { focus(options?: { focusVisible?: boolean }): void }).focus({ focusVisible: false });
  } catch (err) {
    showError(err);
  }
}

async function openFile(file: File): Promise<void> {
  if (state.networkLocked) {
    toast("Reload the page to open another capsule.");
    return;
  }
  await openBytes(new Uint8Array(await file.arrayBuffer()), file.name);
}

async function openUrl(src: string): Promise<void> {
  show("loading-screen");
  $("loading-text").textContent = "Downloading capsule…";
  let url: URL;
  try {
    url = new URL(src, location.href);
  } catch {
    showError(new Error(`Not a valid link: ${src}`));
    return;
  }
  const sameOrigin = url.origin === location.origin;
  if (url.protocol !== "https:" && !sameOrigin) {
    showError(new Error("Capsules can only be opened from https:// links."));
    return;
  }
  try {
    const response = await fetch(url.toString(), {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`The server answered ${response.status} ${response.statusText}.`);
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(`The file is larger than ${formatBytes(MAX_DOWNLOAD_BYTES)}.`);
    }
    const label = sameOrigin ? decodeURIComponent(url.pathname.split("/").pop() ?? "capsule") : url.host;
    await openBytes(buffer, label);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showError(
      new Error(`Couldn’t download ${url.toString()}.\n${message}\nThe server must allow cross-origin requests (CORS).`),
    );
  }
}

/** Plain-language explanation for each family of error; the raw message stays as small print. */
function explainError(code: string | null, message: string): { title: string; body: string } {
  if (code === "integrity.mismatch") {
    return {
      title: "This capsule was changed after it was packed",
      body: "Its contents don’t match the fingerprint its author sealed it with, so it won’t be run. Ask the sender for a fresh copy.",
    };
  }
  if (code === "embed.missing") {
    return {
      title: "This page doesn’t contain a capsule",
      body: "It’s an ordinary web page. Open a .capsule file or a self-opening .capsule.html instead.",
    };
  }
  if (code?.startsWith("archive.") || code?.startsWith("path.") || code?.startsWith("embed.")) {
    return {
      title: "This file is damaged or isn’t a capsule",
      body: "It may have been cut off or altered on the way to you, or it was never a capsule. Nothing from it was run. Ask the sender for a fresh copy.",
    };
  }
  if (code?.startsWith("manifest.")) {
    return {
      title: "This capsule isn’t put together correctly",
      body: "Its description file has a problem, so it can’t be checked safely and won’t be run. The author needs to fix and re-pack it.",
    };
  }
  return { title: "This capsule can’t be opened", body: message };
}

function showError(err: unknown): void {
  const code = err instanceof CapsuleError ? err.code : null;
  const message = err instanceof Error ? err.message : String(err);
  const { title, body } = explainError(code, message);
  $("error-title").textContent = title;
  $("error-message").textContent = body;
  $("error-code").textContent = code ? `${code} · ${message}` : "";
  $("btn-error-back").classList.toggle("hidden", state.mode === "embedded");
  show("error-screen");
}

function openAnother(): void {
  if (state.networkLocked || location.search) {
    // A running capsule narrowed this page's network policy; a fresh page
    // load is the only way to reset it.
    location.assign(location.pathname);
    return;
  }
  state.loaded = null;
  state.host = null;
  showLanding();
}

// ---------------------------------------------------------------------
// Open Screen
// ---------------------------------------------------------------------

function renderOpenScreen(loaded: LoadedCapsule): void {
  const m = loaded.manifest;
  document.title = `${m.name} · Capsule`;
  $("cap-icon").textContent = initialOf(m.name);
  $("cap-name").textContent = m.name;
  $("cap-byline").textContent = `${m.author?.name ?? "Unknown author"} · v${m.version}`;
  $("cap-description").textContent = m.description;
  $("btn-run-label").textContent = `Run ${m.name}`;

  const status = $("cap-status");
  status.replaceChildren();
  if (loaded.integrity.declared) {
    status.className = "status ok";
    status.append(icon(ICONS.verified), document.createTextNode("Unchanged since it was packed"));
    status.title = loaded.integrity.actual;
  } else {
    status.className = "status unsealed";
    status.append(icon(ICONS.unsealed), document.createTextNode("Not sealed by its author, so changes can’t be detected"));
    status.title = loaded.integrity.actual;
  }

  renderPermissions(m);
  renderDetails(loaded);
  setDetailsOpen(false);

  const embedded = state.mode === "embedded";
  $("embedded-notice").classList.toggle("hidden", !embedded);
  if (embedded) {
    const link = $<HTMLAnchorElement>("trusted-viewer-link");
    link.href = __HOSTED_VIEWER_URL__;
    $("trusted-cli-command").textContent = `capsule inspect ${m.slug}.capsule.html`;
  }
  $("btn-another").classList.toggle("hidden", embedded);
}

function canPhrase(capability: CapsuleManifest["permissions"][number]["capability"], m: CapsuleManifest): string {
  if (capability === "network.fetch") {
    const hosts = reachableHosts(m);
    if (hosts.length === 0) return "Connect to the internet (but no sites are allowed)";
    if (hosts.length <= 2) return `Connect to ${hosts.join(" and ")}`;
    return `Connect to ${hosts.length} specific websites`;
  }
  return CAPABILITY_CAN[capability];
}

function renderPermissions(m: CapsuleManifest): void {
  const list = $("can-list");
  list.replaceChildren();
  const seen = new Set<string>();
  for (const p of m.permissions) {
    if (seen.has(p.capability)) continue;
    seen.add(p.capability);
    const li = el("li");
    li.append(icon(ICONS[p.capability]), document.createTextNode(canPhrase(p.capability, m)));
    list.appendChild(li);
  }
  $("perms-title").textContent = m.permissions.length ? "This capsule can" : "This capsule can’t reach anything";
  $("cant-text").textContent = cannotSentence(m);
}

function renderDetails(loaded: LoadedCapsule): void {
  const m = loaded.manifest;
  const list = $("details-list");
  list.replaceChildren();
  const row = (term: string, value: string, mono = false) => {
    const wrap = el("div");
    wrap.append(el("dt", undefined, term), el("dd", mono ? "mono" : undefined, value));
    list.appendChild(wrap);
  };
  for (const p of m.permissions) {
    const scope = p.capability === "network.fetch" ? ` (${reachableHosts(m).join(", ") || "no sites"})` : "";
    row(`${canPhrase(p.capability, m)}${p.capability === "network.fetch" ? "" : scope}`, `“${p.reason}”`);
  }
  row("Always blocked", ALWAYS_DENIED.join(" · "));
  if (m.privacy?.summary) row("Privacy, in the author’s words", m.privacy.summary);
  row("Opened from", state.sourceLabel || "unknown");
  row("Fingerprint", loaded.integrity.actual, true);
}

function setDetailsOpen(open: boolean): void {
  $("details").classList.toggle("hidden", !open);
  const button = $("btn-details");
  button.textContent = open ? "Hide details" : "Details";
  button.setAttribute("aria-expanded", String(open));
}

// ---------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------

/**
 * Narrow this page's own network policy before any capsule code exists.
 * The capsule frame inherits it (on top of its own connect-src 'none'), and
 * the viewer's network.fetch backend can now reach only allowlisted hosts.
 * CSP can only ever be tightened, so this lasts until the page reloads.
 */
function lockNetwork(manifest: CapsuleManifest): void {
  if (state.networkLocked) return;
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = `connect-src ${connectSrcFor(manifest)}`;
  document.head.appendChild(meta);
  state.networkLocked = true;
}

function runCapsule(): void {
  const loaded = state.loaded;
  if (!loaded || !state.host) return;
  lockNetwork(loaded.manifest);

  stopCapsule();
  const frame = document.createElement("iframe");
  frame.title = loaded.manifest.name;
  frame.setAttribute("sandbox", SANDBOX_FLAGS);
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("allow", "camera 'none'; microphone 'none'; geolocation 'none'; usb 'none'; payment 'none'");
  $("frame-host").appendChild(frame);
  state.frame = frame;

  $("runbar-title").textContent = loaded.manifest.name;
  show("run-screen");
  state.host.record("run.start");
  renderPage(loaded.manifest.entry);
}

function renderPage(path: string): void {
  const loaded = state.loaded;
  if (!loaded || !state.frame) return;
  state.currentPage = path;
  $("runbar-page").textContent = path === loaded.manifest.entry ? "" : path;
  state.frame.srcdoc = buildCapsuleDocument({
    archive: loaded.archive,
    entry: loaded.manifest.entry,
    pagePath: path,
    bridgeSource: __BRIDGE_SOURCE__,
    navShimSource: __NAV_SHIM_SOURCE__,
  });
}

function stopCapsule(): void {
  if (state.frame) {
    state.frame.remove();
    state.frame = null;
    state.host?.record("run.end");
  }
  state.currentPage = null;
}

function backToOpenScreen(): void {
  stopCapsule();
  show("open-screen");
}

function navigate(href: unknown): void {
  const loaded = state.loaded;
  if (!loaded || typeof href !== "string" || !state.currentPage) return;
  const target = resolveArchiveRef(loaded.archive, href, dirnameOf(state.currentPage), dirnameOf(loaded.manifest.entry));
  if (!target || !/\.html?$/i.test(target)) {
    state.host?.record("deny", { detail: `navigate.not_found: ${href}` });
    toast(`This capsule has no page called “${href}”.`);
    return;
  }
  state.host?.record("navigate", { detail: target });
  renderPage(target);
}

function wireBridge(): void {
  window.addEventListener("message", (event) => {
    const frame = state.frame;
    if (!frame || event.source !== frame.contentWindow) return;
    const data = event.data as { kind?: unknown; href?: unknown } | null;
    if (!data || typeof data !== "object") return;
    if (data.kind === "capsule-navigate") {
      navigate(data.href);
      return;
    }
    if (!isCapsuleRequest(data) || !state.host) return;
    const id = data.id;
    void state.host.handle(data).then((reply: CapsuleReply) => {
      // Drop replies for a frame that was stopped while the request was pending.
      if (state.frame !== frame) return;
      frame.contentWindow?.postMessage({ kind: "capsule-response", id, ...reply }, "*");
    });
  });
}

// ---------------------------------------------------------------------
// Inspect
// ---------------------------------------------------------------------

function openInspect(): void {
  const loaded = state.loaded;
  if (!loaded) return;
  $("inspect-title").textContent = `Inside ${loaded.manifest.name}`;

  const integrity = $("inspect-integrity");
  integrity.replaceChildren();
  const rows: Array<[string, string]> = [
    ["status", loaded.integrity.declared ? "unchanged since it was packed" : "not sealed by its author"],
    ["fingerprint", loaded.integrity.actual],
    ["sealed as", loaded.integrity.declared ?? "(none)"],
    ["archive size", formatBytes(loaded.archiveBytes)],
    ["opened from", state.sourceLabel || "(unknown)"],
  ];
  for (const [k, v] of rows) integrity.append(el("dt", undefined, k), el("dd", undefined, v));

  const files = $("inspect-files");
  files.replaceChildren();
  for (const entry of loaded.archive.entries
    .filter((e) => !e.isDirectory)
    .sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const li = el("li");
    li.append(el("span", "file-size", formatBytes(entry.uncompressedSize)), el("span", undefined, entry.path));
    files.appendChild(li);
  }

  const activity = $("inspect-activity");
  activity.replaceChildren();
  const receipts = state.host?.receipts ?? [];
  if (receipts.length === 0) activity.appendChild(el("li", undefined, "Nothing yet."));
  for (const r of receipts) {
    const li = el("li");
    const detail = [r.capability && `${r.capability}.${r.method}`, r.scope, r.detail].filter(Boolean).join("  ");
    li.append(
      el("span", "activity-time", new Date(r.ts).toLocaleTimeString()),
      el("span", `activity-event ${r.event}`, r.event),
      el("span", undefined, detail),
    );
    activity.appendChild(li);
  }

  $("inspect-manifest").textContent = JSON.stringify(loaded.manifest, null, 2);
  show("inspect-screen");
}

// ---------------------------------------------------------------------
// Landing
// ---------------------------------------------------------------------

interface ExampleListing {
  file: string;
  name: string;
  description?: string;
}

function showLanding(): void {
  document.title = "Capsule";
  show("landing");
  if (location.protocol === "http:" || location.protocol === "https:") void loadExamples();
}

let examplesLoaded = false;
async function loadExamples(): Promise<void> {
  if (examplesLoaded) return;
  examplesLoaded = true;
  try {
    const response = await fetch("examples/index.json", { credentials: "omit", cache: "no-store" });
    if (!response.ok) return;
    const listing = (await response.json()) as unknown;
    if (!Array.isArray(listing)) return;
    const list = $("example-list");
    for (const item of listing as ExampleListing[]) {
      if (!item || typeof item.file !== "string" || typeof item.name !== "string") continue;
      if (!/^[a-z0-9][a-z0-9.-]*\.capsule$/.test(item.file)) continue;
      const a = el("a", "example-link");
      a.href = `?src=examples/${encodeURIComponent(item.file)}`;
      const text = el("span", "example-text");
      text.appendChild(el("span", "example-name", item.name));
      if (typeof item.description === "string") text.appendChild(el("span", "example-desc", item.description));
      const chevron = el("span", "example-chevron");
      chevron.appendChild(icon(ICONS.chevron));
      a.append(el("span", "example-icon", initialOf(item.name)), text, chevron);
      const li = el("li");
      li.appendChild(a);
      list.appendChild(li);
    }
    if (list.childElementCount > 0) $("examples").classList.remove("hidden");
  } catch {
    // No examples next to this viewer; that's fine.
  }
}

function wireLanding(): void {
  const input = $<HTMLInputElement>("file-input");
  const zone = $("drop-zone");
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    if (file) void openFile(file);
  });
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });

  let depth = 0;
  const canDrop = () => state.mode === "hosted" && visibleScreen() !== "run-screen";
  window.addEventListener("dragenter", (e) => {
    if (!canDrop()) return;
    e.preventDefault();
    depth++;
    zone.classList.add("dragging");
  });
  window.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) zone.classList.remove("dragging");
  });
  window.addEventListener("dragover", (e) => {
    if (canDrop()) e.preventDefault();
  });
  window.addEventListener("drop", (e) => {
    if (!canDrop()) return;
    e.preventDefault();
    depth = 0;
    zone.classList.remove("dragging");
    const file = e.dataTransfer?.files?.[0];
    if (file) void openFile(file);
  });
}

// ---------------------------------------------------------------------
// Navigation + keys
// ---------------------------------------------------------------------

function wireNav(): void {
  $("btn-run").addEventListener("click", runCapsule);
  $("btn-inspect").addEventListener("click", openInspect);
  $("btn-details").addEventListener("click", () => setDetailsOpen($("details").classList.contains("hidden")));
  $("btn-another").addEventListener("click", openAnother);
  $("btn-error-back").addEventListener("click", openAnother);
  $("btn-inspect-back").addEventListener("click", () => show("open-screen"));
  $("btn-back").addEventListener("click", backToOpenScreen);

  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector("dialog[open]")) return;
    if (e.target instanceof HTMLElement && e.target.matches("input, textarea, select, [contenteditable]")) return;
    const id = visibleScreen();
    if (id === "open-screen") {
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        runCapsule();
      } else if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        openInspect();
      }
    } else if (e.key === "Escape" && (id === "run-screen" || id === "inspect-screen")) {
      e.preventDefault();
      backToOpenScreen();
    }
  });
}

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------

async function boot(): Promise<void> {
  wireNav();
  wireLanding();
  wireBridge();

  const payload = document.getElementById("capsule-payload");
  const encoded = (payload?.textContent ?? "").replace(/\s+/g, "");
  if (encoded) {
    state.mode = "embedded";
    try {
      await openBytes(base64ToBytes(encoded), "this file");
    } catch (err) {
      showError(err);
    }
    return;
  }

  const src = new URLSearchParams(location.search).get("src");
  if (src) {
    await openUrl(src);
    return;
  }
  showLanding();
}

void boot();
