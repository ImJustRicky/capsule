const STORAGE_KEY = "draft";
const SAMPLE = `# Pocket Notes

A tiny markdown notepad that lives in **one file**.

## What this demonstrates

- Real interactivity inside the Capsule sandbox
- Local storage **scoped to this capsule** — no other capsule can read it
- Zero network access (the Open Screen showed you that)

> Quote blocks render too. So do \`inline code\` and code fences:

\`\`\`js
function hello(name) {
  return \`hi, \${name}\`;
}
\`\`\`

### Try it

1. Edit anything on the left
2. Watch the preview update on the right
3. Close the window — your draft is still here next time
`;

const editor = document.getElementById("editor");
const preview = document.getElementById("preview");
const status = document.getElementById("status");
const counts = document.getElementById("counts");
const sampleBtn = document.getElementById("sample");
const clearBtn = document.getElementById("clear");

let saveTimer = null;
const bridge = window.capsule;

init();

async function init() {
  const initial = await loadDraft();
  editor.value = initial ?? "";
  render();
  editor.addEventListener("input", onInput);
  sampleBtn.addEventListener("click", () => {
    editor.value = SAMPLE;
    onInput();
    editor.focus();
  });
  clearBtn.addEventListener("click", () => {
    if (!editor.value || confirm("Clear the current draft?")) {
      editor.value = "";
      onInput();
      editor.focus();
    }
  });
  editor.focus();
}

function onInput() {
  render();
  markDirty();
  scheduleSave();
}

function render() {
  const md = editor.value;
  if (!md.trim()) {
    preview.innerHTML = `<p class="empty">Your preview will appear here.</p>`;
    counts.textContent = "0 words";
    return;
  }
  preview.innerHTML = renderMarkdown(md);
  const words = md.trim().split(/\s+/).filter(Boolean).length;
  counts.textContent = `${words} ${words === 1 ? "word" : "words"}`;
}

function markDirty() {
  status.textContent = "editing…";
  status.classList.add("dirty");
}

function markSaved() {
  status.textContent = "saved";
  status.classList.remove("dirty");
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 350);
}

async function loadDraft() {
  if (!bridge) return null;
  try {
    return await bridge.request("storage.local", "get", { key: STORAGE_KEY });
  } catch {
    return null;
  }
}

async function saveDraft() {
  if (!bridge) {
    markSaved();
    return;
  }
  try {
    await bridge.request("storage.local", "set", {
      key: STORAGE_KEY,
      value: editor.value,
    });
    markSaved();
  } catch {
    status.textContent = "save failed";
  }
}

// ---- Tiny markdown renderer (no deps, sandbox-safe) ----

function renderMarkdown(src) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++;
      out.push(
        `<pre><code${lang ? ` class="lang-${escapeHtml(lang)}"` : ""}>${escapeHtml(
          code.join("\n"),
        )}</code></pre>`,
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*---\s*$/.test(line)) {
      out.push("<hr />");
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const block = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        block.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${inline(block.join(" "))}</blockquote>`);
      continue;
    }

    const ulMatch = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ulMatch) {
      const items = [];
      while (i < lines.length) {
        const m = /^\s*[-*]\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        items.push(`<li>${inline(m[1])}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    const olMatch = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (olMatch) {
      const items = [];
      while (i < lines.length) {
        const m = /^\s*\d+\.\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        items.push(`<li>${inline(m[1])}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const para = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,3}\s|\s*[-*]\s|\s*\d+\.\s|>\s|---|```)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}

function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|\W)_([^_]+)_(?=\W|$)/g, "$1<em>$2</em>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, href) => {
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return s;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
