/* Capsule host runtime — Open Screen renderer + bridge relay. */
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
    "storage.local": {
      title: "Save its own settings",
      short: "save its own settings",
    },
    "filesystem.import": {
      title: "Open files you pick",
      short: "open files you pick",
    },
    "filesystem.export": {
      title: "Save files you pick",
      short: "save files you pick",
    },
    "clipboard.write": {
      title: "Copy to clipboard on your action",
      short: "write to clipboard",
    },
    "network.fetch": {
      title: "Contact specific hosts",
      short: "contact specific hosts",
    },
    "dialog.open": {
      title: "Show host-mediated prompts",
      short: "show host prompts",
    },
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
  const ICON_DOT = svg(
    '<circle cx="10" cy="10" r="2.5" fill="currentColor"/>',
  );

  renderHero();
  renderGranted();
  renderDenied();
  wireNav();
  wireKeys();
  wireBridge();

  function renderHero() {
    $("#cap-name").textContent = manifest.name;
    $("#cap-description").textContent = manifest.description || "";

    $("#cap-version").textContent = `v${manifest.version}`;

    const authorEl = $("#cap-author");
    if (manifest.author?.name) {
      authorEl.textContent = `by ${manifest.author.name}`;
    } else {
      authorEl.textContent = "unknown author";
    }

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
      const label = CAP_LABELS[p.capability]?.title ?? p.capability;
      const scope = Array.isArray(p.scope) ? p.scope.join(" · ") : p.scope;
      list.appendChild(
        makeGrantItem({
          title: label,
          reason: p.reason,
          scope,
          empty: false,
        }),
      );
    }
  }

  function renderDenied() {
    const list = $("#cannot-list");
    const requested = new Set((manifest.permissions || []).map((p) => p.capability));

    const items = [];
    for (const cap of ALL_CAPS) {
      if (!requested.has(cap)) {
        items.push(CAP_LABELS[cap].short);
      }
    }
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
      // Keep grid columns aligned with an invisible placeholder.
      const spacer = document.createElement("span");
      spacer.setAttribute("aria-hidden", "true");
      li.appendChild(spacer);
    }

    return li;
  }

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
    $("#runbar-status").textContent = "deny-all sandbox";
    $("#capsule-frame").src = `/s/${token}/capsule/`;
  }

  function openInspect() {
    show("inspect-screen");
    $("#inspect-body").textContent = JSON.stringify(manifest, null, 2);
  }

  function wireBridge() {
    window.addEventListener("message", (event) => {
      const frame = $("#capsule-frame");
      if (event.source !== frame.contentWindow) return;
      const data = event.data;
      if (!data || data.kind !== "capsule-request") return;

      // V1 Milestone 4: every capability denied. Log as a provisional receipt.
      console.info(
        `capsule → host request denied: ${data.capability}.${data.method} (id=${data.id})`,
      );
      frame.contentWindow?.postMessage(
        {
          kind: "capsule-response",
          id: data.id,
          ok: false,
          error: "capability.denied",
          message: `${data.capability} is not granted in this runtime build`,
        },
        "*",
      );
    });
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
