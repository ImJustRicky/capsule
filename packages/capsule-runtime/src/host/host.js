/* Capsule host runtime.
 *
 * Runs in the TOP page (never the capsule iframe). Responsibilities:
 *   1. Render the Open Screen from the manifest.
 *   2. Receive bridge requests from the capsule iframe.
 *   3. Enforce: declared → scoped → user-granted → dispatch → receipt.
 *   4. Implement each V1 capability (storage.local, dialog.open,
 *      filesystem.import/export, clipboard.write) locally, and proxy
 *      network.fetch through the Node server for allowlisted hosts.
 */
(function () {
  "use strict";

  const state = window.__CAPSULE__;
  if (!state || !state.manifest) {
    document.body.textContent = "runtime: missing session state";
    return;
  }
  const manifest = state.manifest;
  const token = state.token;

  const CAP_LABELS = {
    "storage.local": "Save its own settings",
    "filesystem.import": "Open files you pick",
    "filesystem.export": "Save files you pick",
    "clipboard.write": "Copy to clipboard",
    "network.fetch": "Contact specific hosts",
    "dialog.open": "Show host-mediated prompts",
  };
  const CAP_SHORT = {
    "storage.local": "save its own settings",
    "filesystem.import": "open files you pick",
    "filesystem.export": "save files you pick",
    "clipboard.write": "write to clipboard",
    "network.fetch": "contact specific hosts",
    "dialog.open": "show host prompts",
  };
  const ALL_CAPS = Object.keys(CAP_LABELS);
  const ALWAYS_DENIED = [
    "Run shell commands",
    "Read your files",
    "Read your clipboard",
    "Update itself silently",
    "Use camera, microphone, or location",
    "Scan your local network",
  ];

  const ICON_CHECK = svg(
    '<path d="M5 10 L9 14 L15 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  );
  const ICON_X = svg(
    '<path d="M6 6 L14 14 M14 6 L6 14" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" fill="none"/>',
  );
  const ICON_DOT = svg('<circle cx="10" cy="10" r="2.5" fill="currentColor"/>');

  // Session grants: Map<"capability\0scopeKey", "granted"|"denied">.
  // Remembered for the duration of this Run only.
  const sessionDecisions = new Map();

  renderHero();
  renderGranted();
  renderDenied();
  wireNav();
  wireKeys();
  wireBridge();

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------

  function renderHero() {
    $("#cap-name").textContent = manifest.name;
    $("#cap-description").textContent = manifest.description || "";
    $("#cap-version").textContent = `v${manifest.version}`;
    $("#cap-author").textContent = manifest.author?.name
      ? `by ${manifest.author.name}`
      : "unknown author";

    const status = $("#cap-status");
    status.textContent = "";
    const dot = document.createElement("span");
    dot.className = "chip-dot";
    if (manifest.integrity) {
      status.classList.add("chip-ok");
      status.appendChild(dot);
      status.appendChild(document.createTextNode("integrity verified"));
    } else {
      status.classList.add("chip-unsigned");
      status.appendChild(dot);
      status.appendChild(document.createTextNode("unsigned"));
    }
  }

  function renderGranted() {
    const list = $("#can-list");
    const countEl = $("#granted-count");
    const perms = manifest.permissions || [];
    if (perms.length === 0) {
      list.appendChild(
        makeGrantItem({
          title: "Nothing — this is a read-only document",
          reason: "No capabilities were requested in the manifest.",
          scope: null,
          empty: true,
        }),
      );
      countEl.textContent = "0 capabilities requested";
      return;
    }
    countEl.textContent = `${perms.length} ${perms.length === 1 ? "capability" : "capabilities"} requested`;
    for (const p of perms) {
      const label = CAP_LABELS[p.capability] ?? p.capability;
      const scope = Array.isArray(p.scope) ? p.scope.join(" · ") : p.scope;
      list.appendChild(makeGrantItem({ title: label, reason: p.reason, scope, empty: false }));
    }
  }

  function renderDenied() {
    const list = $("#cannot-list");
    const requested = new Set((manifest.permissions || []).map((p) => p.capability));
    const items = [];
    for (const cap of ALL_CAPS) if (!requested.has(cap)) items.push(CAP_SHORT[cap]);
    for (const label of ALWAYS_DENIED) items.push(label);
    for (const label of items) {
      const li = document.createElement("li");
      li.className = "denied-item";
      const wrap = document.createElement("span");
      wrap.className = "icon-wrap";
      wrap.innerHTML = ICON_X;
      li.appendChild(wrap);
      const text = document.createElement("span");
      text.textContent = label;
      li.appendChild(text);
      list.appendChild(li);
    }
  }

  function makeGrantItem({ title, reason, scope, empty }) {
    const li = document.createElement("li");
    li.className = "grant-item" + (empty ? " empty" : "");
    const iconWrap = document.createElement("span");
    iconWrap.className = "icon-wrap";
    iconWrap.innerHTML = empty ? ICON_DOT : ICON_CHECK;
    li.appendChild(iconWrap);
    const body = document.createElement("div");
    const label = document.createElement("span");
    label.className = "grant-label";
    label.textContent = title;
    body.appendChild(label);
    if (reason) {
      const rEl = document.createElement("span");
      rEl.className = "grant-reason";
      rEl.textContent = reason;
      body.appendChild(rEl);
    }
    li.appendChild(body);
    if (scope) {
      const sEl = document.createElement("span");
      sEl.className = "grant-scope";
      sEl.textContent = scope;
      li.appendChild(sEl);
    } else {
      const spacer = document.createElement("span");
      spacer.setAttribute("aria-hidden", "true");
      li.appendChild(spacer);
    }
    return li;
  }

  // ---------------------------------------------------------------
  // Navigation + keys
  // ---------------------------------------------------------------

  function wireNav() {
    $("#btn-inspect").addEventListener("click", openInspect);
    $("#btn-inspect-back").addEventListener("click", () => show("open-screen"));
    $("#btn-back").addEventListener("click", () => {
      $("#capsule-frame").src = "about:blank";
      show("open-screen");
    });
    $("#btn-run").addEventListener("click", runCapsule);
  }

  function wireKeys() {
    window.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.matches("input, textarea")) return;
      const visible = document.querySelector(".screen:not(.hidden)");
      const id = visible?.id;
      if (id === "open-screen") {
        if (e.key === "r" || e.key === "R") {
          e.preventDefault();
          runCapsule();
        } else if (e.key === "i" || e.key === "I") {
          e.preventDefault();
          openInspect();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (id === "run-screen") $("#capsule-frame").src = "about:blank";
        show("open-screen");
      }
    });
  }

  function runCapsule() {
    show("run-screen");
    $("#runbar-title").textContent = manifest.name;
    $("#runbar-status").textContent = "sandbox active";
    $("#capsule-frame").src = `/s/${token}/capsule/`;
  }

  function openInspect() {
    show("inspect-screen");
    $("#inspect-body").textContent = JSON.stringify(manifest, null, 2);
  }

  // ---------------------------------------------------------------
  // Bridge mediator
  // ---------------------------------------------------------------

  function wireBridge() {
    window.addEventListener("message", async (event) => {
      const frame = $("#capsule-frame");
      if (event.source !== frame.contentWindow) return;
      const req = event.data;
      if (!req || req.kind !== "capsule-request" || typeof req.id !== "string") return;
      await mediate(req, frame);
    });
  }

  async function mediate(req, frame) {
    const { id, capability, method, args } = req;
    const declaration = (manifest.permissions || []).find((p) => p.capability === capability);

    // 1. Declared?
    if (!declaration) {
      return fail(frame, id, "capability.not_declared", `${capability} is not declared in the manifest`, {
        capability,
        method,
      });
    }

    // 2. Scope covered?
    const requestedScope = extractScope(capability, method, args);
    if (!scopeCovers(declaration.scope, requestedScope)) {
      return fail(frame, id, "capability.scope_violation",
        `${capability} scope does not cover ${JSON.stringify(requestedScope)}`,
        { capability, method, scope: requestedScope },
      );
    }

    // 3. User grant?
    const key = `${capability}\0${JSON.stringify(requestedScope ?? null)}`;
    let decision = sessionDecisions.get(key);
    if (!decision) {
      decision = await promptUser(capability, requestedScope, declaration.reason, method);
      sessionDecisions.set(key, decision);
    }
    if (decision !== "granted") {
      return fail(frame, id, "capability.denied", "user denied this capability", {
        capability,
        method,
        scope: requestedScope,
      });
    }

    // 4. Dispatch.
    try {
      const value = await dispatch(capability, method, args);
      await receipt({ event: "grant", capability, method, scope: requestedScope });
      reply(frame, id, { ok: true, value });
    } catch (err) {
      await receipt({
        event: "deny",
        capability,
        method,
        scope: requestedScope,
        detail: err?.message ?? String(err),
      });
      reply(frame, id, {
        ok: false,
        error: err?.code ?? "capability.error",
        message: err?.message ?? "capability handler failed",
      });
    }
  }

  async function fail(frame, id, code, message, detail) {
    await receipt({
      event: "deny",
      capability: detail.capability,
      method: detail.method,
      ...(detail.scope !== undefined ? { scope: detail.scope } : {}),
      detail: code,
    });
    reply(frame, id, { ok: false, error: code, message });
  }

  function reply(frame, id, payload) {
    frame.contentWindow?.postMessage(
      { kind: "capsule-response", id, ...payload },
      "*",
    );
  }

  function extractScope(capability, method, args) {
    // The scope field differs per-capability. Keep this explicit so declaring
    // a blanket `"*"` scope is always a conscious choice by the author.
    if (capability === "network.fetch") {
      try {
        if (args?.url) return new URL(args.url).host;
      } catch {
        return null;
      }
    }
    return null;
  }

  function scopeCovers(declared, requested) {
    if (requested === null) return true;
    if (Array.isArray(declared)) return declared.includes(requested);
    if (declared === "*" || declared === "any") return true;
    return declared === requested;
  }

  async function receipt(record) {
    try {
      await fetch(`/s/${token}/receipt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(record),
      });
    } catch {
      // Receipts are best-effort; failing to write one must not break the flow.
    }
  }

  // ---------------------------------------------------------------
  // Permission prompt
  // ---------------------------------------------------------------

  function promptUser(capability, scope, reason, method) {
    return new Promise((resolve) => {
      const dlg = $("#permission-dialog");
      const label = CAP_LABELS[capability] ?? capability;
      $("#perm-title").textContent = label;
      const scopeText = scope ? ` (${scope})` : "";
      $("#perm-detail").textContent =
        `This capsule wants to ${CAP_SHORT[capability] ?? capability}${scopeText}.` +
        (reason ? `\n\nReason: ${reason}` : "");
      const allow = $("#perm-allow");
      const deny = $("#perm-deny");

      const onAllow = () => {
        cleanup();
        resolve("granted");
      };
      const onDeny = () => {
        cleanup();
        resolve("denied");
      };
      const onEsc = (e) => {
        if (e.key === "Escape") onDeny();
      };
      function cleanup() {
        allow.removeEventListener("click", onAllow);
        deny.removeEventListener("click", onDeny);
        window.removeEventListener("keydown", onEsc, true);
        if (dlg.open) dlg.close();
      }
      allow.addEventListener("click", onAllow);
      deny.addEventListener("click", onDeny);
      window.addEventListener("keydown", onEsc, true);
      if (!dlg.open) dlg.showModal();
      void method; // keep signature flexible
    });
  }

  // ---------------------------------------------------------------
  // Capability dispatch
  // ---------------------------------------------------------------

  async function dispatch(capability, method, args) {
    switch (capability) {
      case "storage.local":
        return storageLocal(method, args);
      case "dialog.open":
        return dialogOpen(method, args);
      case "clipboard.write":
        return clipboardWrite(method, args);
      case "filesystem.import":
        return filesystemImport(method, args);
      case "filesystem.export":
        return filesystemExport(method, args);
      case "network.fetch":
        return networkFetch(method, args);
      default:
        throw capErr("capability.unknown", `unknown capability ${capability}`);
    }
  }

  function capErr(code, msg) {
    const e = new Error(msg);
    e.code = code;
    return e;
  }

  // -- storage.local -----------------------------------------------

  const storageKey = manifest.slug + "@" + (manifest.integrity?.content_hash ?? "unsigned");

  function openStoreDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("capsule:storage", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) {
          db.createObjectStore("kv");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbTx(mode, fn) {
    return openStoreDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction("kv", mode);
          const store = tx.objectStore("kv");
          const result = fn(store);
          tx.oncomplete = () => resolve(result && result.then ? result : result);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        }),
    );
  }

  async function storageLocal(method, args) {
    const key = (k) => `${storageKey}\0${String(k)}`;
    switch (method) {
      case "get": {
        return idbTx("readonly", (store) => {
          return new Promise((resolve, reject) => {
            const r = store.get(key(args?.key));
            r.onsuccess = () => resolve(r.result ?? null);
            r.onerror = () => reject(r.error);
          });
        });
      }
      case "set": {
        return idbTx("readwrite", (store) => {
          store.put(args?.value ?? null, key(args?.key));
          return true;
        });
      }
      case "delete": {
        return idbTx("readwrite", (store) => {
          store.delete(key(args?.key));
          return true;
        });
      }
      case "keys": {
        return idbTx("readonly", (store) => {
          return new Promise((resolve, reject) => {
            const r = store.getAllKeys();
            r.onsuccess = () => {
              const prefix = `${storageKey}\0`;
              const keys = (r.result || [])
                .filter((k) => typeof k === "string" && k.startsWith(prefix))
                .map((k) => k.slice(prefix.length));
              resolve(keys);
            };
            r.onerror = () => reject(r.error);
          });
        });
      }
      default:
        throw capErr("method.unknown", `storage.local.${method} is not supported`);
    }
  }

  // -- dialog.open -------------------------------------------------

  function dialogOpen(method, args) {
    const msg = String(args?.message ?? "");
    switch (method) {
      case "alert": {
        window.alert(`${manifest.name}\n\n${msg}`);
        return true;
      }
      case "confirm": {
        return window.confirm(`${manifest.name}\n\n${msg}`);
      }
      case "prompt": {
        const def = args?.default ? String(args.default) : "";
        return window.prompt(`${manifest.name}\n\n${msg}`, def);
      }
      default:
        throw capErr("method.unknown", `dialog.open.${method} is not supported`);
    }
  }

  // -- clipboard.write ---------------------------------------------

  async function clipboardWrite(method, args) {
    if (method !== "text") throw capErr("method.unknown", `clipboard.write.${method} is not supported`);
    const text = String(args?.text ?? "");
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      throw capErr("capability.unavailable", "clipboard API not available in this browser");
    }
    await navigator.clipboard.writeText(text);
    return true;
  }

  // -- filesystem.import / export ----------------------------------

  function filesystemImport(method, args) {
    if (method !== "pick") throw capErr("method.unknown", `filesystem.import.${method} is not supported`);
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      if (args?.accept) input.accept = String(args.accept);
      if (args?.multiple) input.multiple = true;
      input.style.display = "none";
      document.body.appendChild(input);
      input.addEventListener(
        "change",
        async () => {
          try {
            const files = Array.from(input.files || []);
            const out = await Promise.all(
              files.map(async (f) => ({
                name: f.name,
                type: f.type,
                size: f.size,
                bytes_b64: await toBase64(await f.arrayBuffer()),
              })),
            );
            resolve(args?.multiple ? out : (out[0] ?? null));
          } catch (err) {
            reject(err);
          } finally {
            input.remove();
          }
        },
        { once: true },
      );
      input.addEventListener(
        "cancel",
        () => {
          input.remove();
          resolve(null);
        },
        { once: true },
      );
      input.click();
    });
  }

  async function filesystemExport(method, args) {
    if (method !== "save") throw capErr("method.unknown", `filesystem.export.${method} is not supported`);
    const bytes = fromBase64(String(args?.bytes_b64 ?? ""));
    const name = String(args?.suggested_name ?? "download");
    const type = String(args?.type ?? "application/octet-stream");
    const blob = new Blob([bytes], { type });

    // Try File System Access API first; fall back to anchor download.
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: name });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return { saved: true, name: handle.name ?? name };
      } catch (err) {
        if (err && err.name === "AbortError") return { saved: false };
        throw err;
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { saved: true, name };
  }

  // -- network.fetch (proxied through Node) -------------------------

  async function networkFetch(method, args) {
    if (method !== "request") throw capErr("method.unknown", `network.fetch.${method} is not supported`);
    const r = await fetch(`/s/${token}/proxy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: args?.url,
        method: args?.method ?? "GET",
        headers: args?.headers ?? {},
        body: args?.body,
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw capErr("network.error", `proxy rejected: ${r.status} ${detail}`.trim());
    }
    return r.json();
  }

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------

  function toBase64(buf) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        const comma = result.indexOf(",");
        resolve(result.slice(comma + 1));
      };
      reader.readAsDataURL(new Blob([buf]));
    });
  }

  function fromBase64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function show(id) {
    for (const el of document.querySelectorAll(".screen")) el.classList.add("hidden");
    $(`#${id}`).classList.remove("hidden");
  }

  function svg(inner) {
    return `<svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true">${inner}</svg>`;
  }

  function $(sel) {
    return document.querySelector(sel);
  }
})();
