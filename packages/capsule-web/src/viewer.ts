import { CapsuleError, base64ToBytes, type CapsuleManifest } from "@capsule/core/browser";
import {
  ALWAYS_DENIED,
  CAPABILITY_LABELS,
  CAPABILITY_NAMES,
  CAPABILITY_SHORT,
  connectSrcFor,
  isCapabilityName,
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
}

function visibleScreen(): string | undefined {
  return document.querySelector<HTMLElement>(".screen:not(.hidden)")?.id;
}

function svgIcon(inner: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("aria-hidden", "true");
  for (const d of inner.split("|")) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.9");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("fill", "none");
    svg.appendChild(path);
  }
  return svg;
}
const ICON_CHECK = "M5 10 L9 14 L15 6";
const ICON_X = "M6 6 L14 14|M14 6 L6 14";
const ICON_DOT = "M10 9.5 L10 10.5";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(message: string): void {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 6000);
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

function modal(
  dialogId: string,
  confirmId: string,
  cancelId: string,
  focusCancel: boolean,
): Promise<boolean> {
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
      const label = isCapabilityName(capability) ? CAPABILITY_LABELS[capability] : capability;
      const short = isCapabilityName(capability) ? CAPABILITY_SHORT[capability] : capability;
      $("perm-title").textContent = label;
      $("perm-detail").textContent =
        `${state.loaded?.manifest.name ?? "This capsule"} wants to ${short}${scope ? ` (${scope})` : ""}.` +
        (reason ? `\n\nReason given by the author: ${reason}` : "");
      const allowed = await modal("permission-dialog", "perm-allow", "perm-deny", true);
      return allowed ? "granted" : "denied";
    });
  },
  requestGesture(message, actionLabel) {
    return serialized(async () => {
      $("gesture-title").textContent = actionLabel.replace(/…$/, "");
      $("gesture-detail").textContent = message;
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
    $("btn-run").focus();
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
    const bytes = await readLimited(response, MAX_DOWNLOAD_BYTES);
    const label = sameOrigin ? decodeURIComponent(url.pathname.split("/").pop() ?? "capsule") : url.host;
    await openBytes(bytes, label);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showError(
      new Error(
        `Couldn’t download ${url.toString()}.\n${message}\nThe server must allow cross-origin requests (CORS).`,
      ),
    );
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) throw new Error(`File is larger than ${formatBytes(maxBytes)}.`);
  return buffer;
}

function showError(err: unknown): void {
  const code = err instanceof CapsuleError ? err.code : null;
  const message = err instanceof Error ? err.message : String(err);
  $("error-title").textContent =
    code === "integrity.mismatch"
      ? "This capsule was modified after it was packed"
      : "This capsule can’t be opened";
  $("error-message").textContent = message;
  $("error-code").textContent = code ? `error: ${code}` : "";
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
  $("cap-name").textContent = m.name;
  $("cap-description").textContent = m.description;
  $("cap-version").textContent = `v${m.version}`;
  $("cap-author").textContent = m.author?.name ? `by ${m.author.name}` : "unknown author";

  const status = $("cap-status");
  status.replaceChildren();
  status.className = "chip";
  const dot = document.createElement("span");
  dot.className = "chip-dot";
  status.appendChild(dot);
  if (loaded.integrity.declared) {
    status.classList.add("chip-ok");
    status.appendChild(document.createTextNode("integrity verified"));
    status.title = `content hash ${loaded.integrity.actual}`;
  } else {
    status.classList.add("chip-unsigned");
    status.appendChild(document.createTextNode("no declared hash"));
    status.title = `computed ${loaded.integrity.actual}`;
  }
  $("cap-source").textContent = state.sourceLabel ? `from ${state.sourceLabel}` : "";
  $("cap-source").classList.toggle("hidden", !state.sourceLabel);

  $("runtime-badge").textContent = state.mode === "embedded" ? "Self-opening file" : "Browser runtime";
  const notice = $("embedded-notice");
  notice.classList.toggle("hidden", state.mode !== "embedded");
  if (state.mode === "embedded") {
    const link = $<HTMLAnchorElement>("trusted-viewer-link");
    link.href = __HOSTED_VIEWER_URL__;
    link.textContent = __HOSTED_VIEWER_URL__.replace(/^https:\/\//, "").replace(/\/$/, "");
    $("trusted-cli-command").textContent = `capsule inspect ${m.slug}.capsule.html`;
  }
  $("btn-another").classList.toggle("hidden", state.mode === "embedded");

  renderGranted(m);
  renderDenied(m);
}

function renderGranted(m: CapsuleManifest): void {
  const list = $("can-list");
  list.replaceChildren();
  if (m.permissions.length === 0) {
    list.appendChild(
      grantItem("Nothing. This capsule asks for no capabilities.", "It can only draw inside its own window.", null, true),
    );
    $("granted-count").textContent = "0 capabilities requested";
    return;
  }
  $("granted-count").textContent =
    `${m.permissions.length} ${m.permissions.length === 1 ? "capability" : "capabilities"} requested`;
  for (const p of m.permissions) {
    const scope = Array.isArray(p.scope) ? p.scope.join(" · ") : p.scope;
    list.appendChild(grantItem(CAPABILITY_LABELS[p.capability] ?? p.capability, p.reason, scope, false));
  }
}

function grantItem(title: string, reason: string, scope: string | null, empty: boolean): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "grant-item" + (empty ? " empty" : "");
  const icon = document.createElement("span");
  icon.className = "icon-wrap";
  icon.appendChild(svgIcon(empty ? ICON_DOT : ICON_CHECK));
  const body = document.createElement("div");
  const label = document.createElement("span");
  label.className = "grant-label";
  label.textContent = title;
  body.appendChild(label);
  if (reason) {
    const r = document.createElement("span");
    r.className = "grant-reason";
    r.textContent = reason;
    body.appendChild(r);
  }
  const scopeEl = document.createElement("span");
  if (scope) {
    scopeEl.className = "grant-scope";
    scopeEl.textContent = scope;
  } else {
    scopeEl.setAttribute("aria-hidden", "true");
  }
  li.append(icon, body, scopeEl);
  return li;
}

function renderDenied(m: CapsuleManifest): void {
  const list = $("cannot-list");
  list.replaceChildren();
  const requested = new Set(m.permissions.map((p) => p.capability));
  const items = [
    ...CAPABILITY_NAMES.filter((c) => !requested.has(c)).map((c) => CAPABILITY_SHORT[c]),
    ...ALWAYS_DENIED,
  ];
  for (const label of items) {
    const li = document.createElement("li");
    li.className = "denied-item";
    const icon = document.createElement("span");
    icon.className = "icon-wrap";
    icon.appendChild(svgIcon(ICON_X));
    const text = document.createElement("span");
    text.textContent = label.charAt(0).toUpperCase() + label.slice(1);
    li.append(icon, text);
    list.appendChild(li);
  }
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
  $("btn-another").classList.toggle("hidden", state.mode === "embedded");

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

function navigate(href: unknown): void {
  const loaded = state.loaded;
  if (!loaded || typeof href !== "string" || !state.currentPage) return;
  const target = resolveArchiveRef(
    loaded.archive,
    href,
    dirnameOf(state.currentPage),
    dirnameOf(loaded.manifest.entry),
  );
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
  const integrity = $("inspect-integrity");
  integrity.replaceChildren();
  const rows: Array<[string, string]> = [
    ["status", loaded.integrity.declared ? "declared hash matches content" : "no declared hash"],
    ["computed", loaded.integrity.actual],
    ["declared", loaded.integrity.declared ?? "(none)"],
    ["archive", formatBytes(loaded.archiveBytes)],
    ["opened from", state.sourceLabel || "(unknown)"],
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    integrity.append(dt, dd);
  }

  const files = $("inspect-files");
  files.replaceChildren();
  for (const entry of loaded.archive.entries
    .filter((e) => !e.isDirectory)
    .sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const li = document.createElement("li");
    const size = document.createElement("span");
    size.className = "file-size";
    size.textContent = formatBytes(entry.uncompressedSize);
    const name = document.createElement("span");
    name.textContent = entry.path;
    li.append(size, name);
    files.appendChild(li);
  }

  const activity = $("inspect-activity");
  activity.replaceChildren();
  const receipts = state.host?.receipts ?? [];
  if (receipts.length === 0) {
    const li = document.createElement("li");
    li.textContent = "(nothing yet)";
    activity.appendChild(li);
  }
  for (const r of receipts) {
    const li = document.createElement("li");
    const time = document.createElement("span");
    time.className = "activity-time";
    time.textContent = new Date(r.ts).toLocaleTimeString();
    const event = document.createElement("span");
    event.className = `activity-event ${r.event}`;
    event.textContent = r.event;
    const detail = document.createElement("span");
    detail.textContent = [r.capability && `${r.capability}.${r.method}`, r.scope, r.detail]
      .filter(Boolean)
      .join("  ");
    li.append(time, event, detail);
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
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.className = "example-link";
      a.href = `?src=examples/${encodeURIComponent(item.file)}`;
      const name = document.createElement("span");
      name.className = "example-name";
      name.textContent = item.name;
      a.appendChild(name);
      if (typeof item.description === "string") {
        const desc = document.createElement("span");
        desc.className = "example-desc";
        desc.textContent = item.description;
        a.appendChild(desc);
      }
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
  $("btn-another").addEventListener("click", openAnother);
  $("btn-error-back").addEventListener("click", openAnother);
  $("btn-inspect-back").addEventListener("click", () => show("open-screen"));
  $("btn-back").addEventListener("click", () => {
    stopCapsule();
    show("open-screen");
  });

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
      stopCapsule();
      show("open-screen");
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
