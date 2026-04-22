(function () {
  "use strict";
  const STORAGE_KEY = "draft";
  const canvas = document.getElementById("poster");
  const ctx = canvas.getContext("2d");
  const form = document.getElementById("form");

  function readForm() {
    return {
      title: document.getElementById("title").value,
      subtitle: document.getElementById("subtitle").value,
      footer: document.getElementById("footer").value,
      bg: document.getElementById("bg").value,
      fg: document.getElementById("fg").value,
      accent: document.getElementById("accent").value,
    };
  }
  function writeForm(d) {
    if (!d) return;
    for (const k of ["title", "subtitle", "footer", "bg", "fg", "accent"]) {
      const el = document.getElementById(k);
      if (el && d[k] != null) el.value = d[k];
    }
  }

  function render() {
    const d = readForm();
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = d.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = d.accent; ctx.fillRect(60, 60, W - 120, 8);
    ctx.fillStyle = d.fg;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "bold 96px -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
    wrapText(d.title, 60, 140, W - 120, 104);
    ctx.font = "40px -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
    ctx.fillStyle = d.fg;
    wrapText(d.subtitle, 60, 420, W - 120, 52);
    ctx.fillStyle = d.accent; ctx.fillRect(60, H - 130, 40, 4);
    ctx.font = "22px -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
    ctx.fillStyle = d.fg;
    ctx.fillText(d.footer, 60, H - 100);
  }

  function wrapText(text, x, y, maxWidth, lineHeight) {
    const words = (text || "").split(/\s+/);
    let line = "";
    for (const word of words) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, y);
        y += lineHeight;
        line = word;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, y);
  }

  async function load() {
    try {
      const saved = await window.capsule.request("storage.local", "get", { key: STORAGE_KEY });
      writeForm(saved);
    } catch (err) {
      console.warn("storage.local unavailable:", err.code);
    }
    render();
  }

  async function save() {
    try {
      await window.capsule.request("storage.local", "set", { key: STORAGE_KEY, value: readForm() });
    } catch (err) {
      console.warn("save failed:", err.code);
    }
  }

  form.addEventListener("input", () => { render(); save(); });

  document.getElementById("export").addEventListener("click", async () => {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const buf = new Uint8Array(await blob.arrayBuffer());
    const b64 = btoa(String.fromCharCode(...buf));
    try {
      await window.capsule.request("filesystem.export", "save", {
        bytes_b64: b64,
        suggested_name: "poster.png",
        type: "image/png",
      });
    } catch (err) {
      alert("Could not save: " + (err.message || err.code));
    }
  });

  load();
})();
