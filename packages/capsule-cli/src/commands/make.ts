import { promises as fs } from "node:fs";
import path from "node:path";
import { packArchive, type CapsuleManifest, type PackFile } from "@capsule/core";

type TemplateName = "blank" | "checklist" | "calculator";

interface TemplateDefinition {
  name: TemplateName;
  label: string;
  description: string;
  permissions: CapsuleManifest["permissions"];
  privacy: NonNullable<CapsuleManifest["privacy"]>;
  files: Record<string, string>;
}

interface MakeArgs {
  source: string | undefined;
  out: string | undefined;
  name: string | undefined;
  description: string | undefined;
  slug: string | undefined;
  version: string;
  versionProvided: boolean;
  template: TemplateName | undefined;
  force: boolean;
  noPack: boolean;
  listTemplates: boolean;
  help: boolean;
  error: string | null;
}

const TEMPLATE_NAMES = ["blank", "checklist", "calculator"] as const;
const DEFAULT_VERSION = "0.1.0";
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const USAGE = `usage: capsule make <folder|slug> [options]

Create a new capsule from a template, or package an existing web folder.

Examples:
  capsule make my-checklist --template checklist
  capsule make ./site --name "Field Guide"
  capsule make ./dist --out field-guide.capsule
  capsule make --list-templates

Options:
  --template <name>        blank, checklist, calculator
  --name <text>            display name shown on the Open Screen
  --description <text>     short purpose shown before running
  --slug <slug>            stable lowercase id
  --version <version>      author version (default: 0.1.0)
  -o, --out <file>         output path; must end in .capsule
  --force                  overwrite an existing output .capsule
  --no-pack                create the project folder but do not package it
  --list-templates         show starter templates
`;

export async function make(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (args.error) {
    process.stderr.write(`${args.error}\n\n${USAGE}`);
    return 2;
  }
  if (args.listTemplates) {
    printTemplates();
    return 0;
  }
  if (!args.source) {
    process.stderr.write(USAGE);
    return 2;
  }
  if (args.noPack && args.out) {
    process.stderr.write("--out cannot be used with --no-pack\n");
    return 2;
  }

  const absSource = path.resolve(args.source);
  const stat = await fs.stat(absSource).catch(() => null);

  if (!stat) {
    return makeFromTemplate(absSource, args);
  }
  if (stat.isDirectory()) {
    return makeFromDirectory(absSource, args);
  }
  if (stat.isFile()) {
    return makeFromFile(absSource, args);
  }

  process.stderr.write(`not a file or directory: ${args.source}\n`);
  return 1;
}

async function makeFromTemplate(projectDir: string, args: MakeArgs): Promise<number> {
  const slug = args.slug ?? slugify(path.basename(projectDir));
  if (!SLUG_RE.test(slug)) {
    process.stderr.write(
      `invalid slug: ${slug}\nUse lowercase letters, numbers, and hyphens, like my-capsule.\n`,
    );
    return 1;
  }

  const exists = await fs.stat(projectDir).catch(() => null);
  if (exists) {
    process.stderr.write(`directory already exists: ${projectDir}\n`);
    return 1;
  }
  const outputError = await preflightTemplateOutput(args, slug);
  if (outputError) {
    process.stderr.write(outputError);
    return 1;
  }

  const template = templateFor(args.template ?? "blank");
  const manifest = manifestFor({
    slug,
    name: args.name ?? titleFromSlug(slug),
    description: args.description ?? template.description,
    version: args.version,
    permissions: template.permissions,
    privacy: template.privacy,
  });
  await writeProject(projectDir, manifest, template.files);

  process.stdout.write(`created ${prettyPath(projectDir)}/ from ${template.name} template\n`);
  if (args.noPack) {
    process.stdout.write(`next: edit ${prettyPath(path.join(projectDir, "content", "index.html"))}\n`);
    return 0;
  }

  const files = await collectProjectFiles(projectDir);
  return writeCapsule(files, args, { sourceLabel: prettyPath(projectDir), createdProject: true });
}

async function preflightTemplateOutput(args: MakeArgs, slug: string): Promise<string | null> {
  if (args.noPack) return null;
  const outPath = path.resolve(args.out ?? `${slug}.capsule`);
  if (!outPath.toLowerCase().endsWith(".capsule")) {
    return "output path must use the standard .capsule extension\n";
  }
  if (!args.force && (await fs.stat(outPath).catch(() => null))) {
    return (
      `output already exists: ${prettyPath(outPath)}\n` +
      "Use --force to overwrite it, or pass -o <new-name.capsule>.\n"
    );
  }
  return null;
}

async function makeFromDirectory(sourceDir: string, args: MakeArgs): Promise<number> {
  if (args.template) {
    process.stderr.write(
      "templates are for new capsules. Omit --template when packaging an existing folder.\n",
    );
    return 2;
  }
  if (args.noPack) {
    process.stderr.write("--no-pack only applies when creating a new template project.\n");
    return 2;
  }

  const manifestPath = path.join(sourceDir, "capsule.json");
  const hasManifest = !!(await fs.stat(manifestPath).catch(() => null));
  let files: PackFile[];

  if (hasManifest) {
    files = await collectProjectFiles(sourceDir);
    files = applyManifestOverrides(files, args);
  } else {
    const standardEntry = await firstExisting(sourceDir, [
      "content/index.html",
      "content/index.htm",
    ]);
    const rootEntry = await firstExisting(sourceDir, ["index.html", "index.htm"]);

    if (standardEntry) {
      files = await collectProjectFiles(sourceDir);
      files.push({
        path: "capsule.json",
        bytes: encodeManifest(
          inferredManifest(sourceDir, args, standardEntry.split(path.sep).join("/")),
        ),
      });
    } else if (rootEntry) {
      files = await collectProjectFiles(sourceDir, "content");
      const entryName = path.basename(rootEntry);
      files.push({
        path: "capsule.json",
        bytes: encodeManifest(inferredManifest(sourceDir, args, `content/${entryName}`)),
      });
    } else {
      process.stderr.write(
        `could not find index.html in ${prettyPath(sourceDir)}\n` +
          "Add an index.html file, use an existing capsule project with capsule.json, or start with:\n" +
          "  capsule make my-capsule --template blank\n",
      );
      return 1;
    }
  }

  return writeCapsule(files, args, { sourceLabel: prettyPath(sourceDir) });
}

async function makeFromFile(sourceFile: string, args: MakeArgs): Promise<number> {
  if (args.template) {
    process.stderr.write("templates are for new capsules. Omit --template when packaging a file.\n");
    return 2;
  }
  if (args.noPack) {
    process.stderr.write("--no-pack only applies when creating a new template project.\n");
    return 2;
  }
  if (!/\.html?$/i.test(sourceFile)) {
    process.stderr.write("single-file make currently expects an .html file\n");
    return 1;
  }

  const bytes = await fs.readFile(sourceFile);
  const entryName = path.basename(sourceFile).toLowerCase().endsWith(".htm")
    ? "index.htm"
    : "index.html";
  const sourceDir = path.dirname(sourceFile);
  const files: PackFile[] = [
    { path: `content/${entryName}`, bytes: new Uint8Array(bytes) },
    {
      path: "capsule.json",
      bytes: encodeManifest(
        inferredManifest(
          sourceDir,
          args,
          `content/${entryName}`,
          path.basename(sourceFile, path.extname(sourceFile)),
        ),
      ),
    },
  ];
  return writeCapsule(files, args, { sourceLabel: prettyPath(sourceFile) });
}

async function writeCapsule(
  files: PackFile[],
  args: MakeArgs,
  context: { sourceLabel: string; createdProject?: boolean },
): Promise<number> {
  const result = await packArchive(files);
  const outPath = path.resolve(args.out ?? `${result.manifest.slug}.capsule`);
  if (!outPath.toLowerCase().endsWith(".capsule")) {
    process.stderr.write("output path must use the standard .capsule extension\n");
    return 1;
  }
  if (!args.force && (await fs.stat(outPath).catch(() => null))) {
    process.stderr.write(
      `output already exists: ${prettyPath(outPath)}\n` +
        "Use --force to overwrite it, or pass -o <new-name.capsule>.\n",
    );
    return 1;
  }

  await fs.writeFile(outPath, result.bytes);

  process.stdout.write(
    [
      `made ${prettyPath(outPath)}`,
      `  name:         ${result.manifest.name}`,
      `  source:       ${context.sourceLabel}`,
      `  entry:        ${result.manifest.entry}`,
      `  capabilities: ${formatPermissionCount(result.manifest.permissions.length)}`,
      `  content_hash: ${result.contentHash}`,
      `  size:         ${formatBytes(result.bytes.byteLength)}`,
      "next:",
      `  capsule inspect ${shellPath(outPath)}`,
      `  capsule run ${shellPath(outPath)}`,
      "",
    ].join("\n"),
  );

  if (context.createdProject) {
    process.stdout.write(`project folder: ${context.sourceLabel}/\n`);
  }
  return 0;
}

function parseArgs(argv: string[]): MakeArgs {
  const out: MakeArgs = {
    source: undefined,
    out: undefined,
    name: undefined,
    description: undefined,
    slug: undefined,
    version: DEFAULT_VERSION,
    versionProvided: false,
    template: undefined,
    force: false,
    noPack: false,
    listTemplates: false,
    help: false,
    error: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") {
      out.help = true;
    } else if (a === "--list-templates") {
      out.listTemplates = true;
    } else if (a === "--force") {
      out.force = true;
    } else if (a === "--no-pack") {
      out.noPack = true;
    } else if (a === "-o" || a === "--out") {
      out.out = valueAfter(argv, ++i, a, out);
    } else if (a === "--name") {
      out.name = valueAfter(argv, ++i, a, out);
    } else if (a === "--description") {
      out.description = valueAfter(argv, ++i, a, out);
    } else if (a === "--slug") {
      out.slug = valueAfter(argv, ++i, a, out);
    } else if (a === "--version") {
      out.version = valueAfter(argv, ++i, a, out) ?? DEFAULT_VERSION;
      out.versionProvided = true;
    } else if (a === "--template") {
      const template = valueAfter(argv, ++i, a, out);
      if (template && isTemplateName(template)) out.template = template;
      else if (template) out.error = `unknown template: ${template}`;
    } else if (a.startsWith("-")) {
      out.error = `unknown option: ${a}`;
    } else if (!out.source) {
      out.source = a;
    } else {
      out.error = `unexpected argument: ${a}`;
    }
    if (out.error) break;
  }
  return out;
}

function valueAfter(
  argv: string[],
  index: number,
  flag: string,
  args: MakeArgs,
): string | undefined {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    args.error = `${flag} requires a value`;
    return undefined;
  }
  return value;
}

function isTemplateName(value: string): value is TemplateName {
  return (TEMPLATE_NAMES as readonly string[]).includes(value);
}

async function collectProjectFiles(root: string, prefix = ""): Promise<PackFile[]> {
  const result: PackFile[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const entries = await fs.readdir(cur, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (shouldSkipDir(e.name) && e.isDirectory()) continue;
      if (shouldSkipFile(e.name) && e.isFile()) continue;
      const full = path.join(cur, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      const rel = path.relative(root, full).split(path.sep).join("/");
      const archivePath = prefix ? `${prefix}/${rel}` : rel;
      const bytes = await fs.readFile(full);
      result.push({ path: archivePath, bytes: new Uint8Array(bytes) });
    }
  }
  return result;
}

function shouldSkipDir(name: string): boolean {
  return name === ".git" || name === "node_modules";
}

function shouldSkipFile(name: string): boolean {
  return name === ".DS_Store" || name.toLowerCase().endsWith(".capsule");
}

async function firstExisting(root: string, rels: string[]): Promise<string | null> {
  for (const rel of rels) {
    const full = path.join(root, rel);
    const stat = await fs.stat(full).catch(() => null);
    if (stat?.isFile()) return rel;
  }
  return null;
}

function applyManifestOverrides(files: PackFile[], args: MakeArgs): PackFile[] {
  if (!args.name && !args.description && !args.slug && !args.versionProvided) return files;
  return files.map((file) => {
    if (file.path !== "capsule.json") return file;
    const raw = JSON.parse(new TextDecoder().decode(file.bytes)) as Record<string, unknown>;
    if (args.name) raw.name = args.name;
    if (args.description) raw.description = args.description;
    if (args.slug) raw.slug = args.slug;
    if (args.versionProvided) raw.version = args.version;
    return { path: file.path, bytes: new TextEncoder().encode(JSON.stringify(raw, null, 2) + "\n") };
  });
}

function inferredManifest(
  sourceDir: string,
  args: MakeArgs,
  entry: string,
  slugSeed = path.basename(sourceDir),
): CapsuleManifest {
  const slug = args.slug ?? slugify(args.name ?? slugSeed);
  return manifestFor({
    slug,
    name: args.name ?? titleFromSlug(slug),
    description: args.description ?? `Packaged from ${path.basename(sourceDir)}.`,
    version: args.version,
    permissions: [],
    privacy: {
      summary: "No capabilities requested. Does not contact the network.",
      data_stored: [],
      data_shared: [],
    },
    entry,
  });
}

function manifestFor(opts: {
  slug: string;
  name: string;
  description: string;
  version: string;
  permissions: CapsuleManifest["permissions"];
  privacy: NonNullable<CapsuleManifest["privacy"]>;
  entry?: string;
}): CapsuleManifest {
  return {
    capsule_version: "1.0",
    name: opts.name,
    slug: opts.slug,
    version: opts.version,
    description: opts.description,
    entry: opts.entry ?? "content/index.html",
    permissions: opts.permissions,
    network: { default: "deny", allow: [] },
    privacy: opts.privacy,
  };
}

async function writeProject(
  projectDir: string,
  manifest: CapsuleManifest,
  files: Record<string, string>,
): Promise<void> {
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(path.join(projectDir, "capsule.json"), JSON.stringify(manifest, null, 2) + "\n");
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(projectDir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
  }
}

function encodeManifest(manifest: CapsuleManifest): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(manifest, null, 2) + "\n");
}

function templateFor(name: TemplateName): TemplateDefinition {
  return TEMPLATES[name];
}

function printTemplates(): void {
  process.stdout.write("Templates:\n");
  for (const name of TEMPLATE_NAMES) {
    const t = templateFor(name);
    process.stdout.write(`  ${t.name.padEnd(10)} ${t.label} - ${t.description}\n`);
  }
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  if (SLUG_RE.test(slug)) return slug;
  return "my-capsule";
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function formatPermissionCount(count: number): string {
  if (count === 0) return "none";
  if (count === 1) return "1 requested";
  return `${count} requested`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function prettyPath(filePath: string): string {
  const rel = path.relative(process.cwd(), filePath);
  if (!rel || rel === "") return ".";
  return rel.startsWith("..") ? filePath : rel;
}

function shellPath(filePath: string): string {
  const p = prettyPath(filePath);
  return /\s/.test(p) ? JSON.stringify(p) : p;
}

const BASE_STYLE = `:root {
  --bg: #f7f6f2;
  --panel: #ffffff;
  --fg: #171914;
  --muted: #66705f;
  --accent: #16796f;
  --line: rgba(23, 25, 20, 0.1);
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--fg); font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
main { width: min(720px, calc(100% - 32px)); margin: 0 auto; padding: 36px 0; }
.panel { background: var(--panel); border-radius: 8px; padding: 20px; box-shadow: 0 1px 2px rgba(0,0,0,0.06), 0 16px 48px -28px rgba(0,0,0,0.28), 0 0 0 1px var(--line); }
h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: 0; text-wrap: balance; }
p { color: var(--muted); margin: 0 0 18px; text-wrap: pretty; }
button, input { font: inherit; }
button { min-height: 40px; border: 0; border-radius: 8px; padding: 9px 14px; background: var(--accent); color: white; font-weight: 600; cursor: pointer; transition-property: transform, background-color; transition-duration: 150ms; transition-timing-function: cubic-bezier(0.2, 0, 0, 1); }
button:active { transform: scale(0.96); }
`;

const TEMPLATES: Record<TemplateName, TemplateDefinition> = {
  blank: {
    name: "blank",
    label: "Blank app",
    description: "A clean offline starter with no requested capabilities.",
    permissions: [],
    privacy: {
      summary: "No capabilities requested. Does not contact the network.",
      data_stored: [],
      data_shared: [],
    },
    files: {
      "content/index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Capsule</title>
    <link rel="stylesheet" href="style.css" />
    <script src="app.js" defer></script>
  </head>
  <body>
    <main>
      <section class="panel">
        <h1>Hello, capsule.</h1>
        <p>Edit the files in content/ and run capsule make again.</p>
        <button id="count" type="button">Count 0</button>
      </section>
    </main>
  </body>
</html>
`,
      "content/style.css": BASE_STYLE,
      "content/app.js": `let count = 0;
document.getElementById("count").addEventListener("click", (event) => {
  count += 1;
  event.currentTarget.textContent = \`Count \${count}\`;
});
`,
      "source/README.md": "# Capsule source\n\nBuilt with `capsule make --template blank`.\n",
    },
  },
  checklist: {
    name: "checklist",
    label: "Saved checklist",
    description: "A local checklist that remembers items in capsule-private storage.",
    permissions: [
      {
        capability: "storage.local",
        scope: "capsule",
        reason: "Remember checklist items between sessions.",
      },
    ],
    privacy: {
      summary: "Stores checklist items locally, scoped to this capsule only. Does not contact the network.",
      data_stored: ["checklist items"],
      data_shared: [],
    },
    files: {
      "content/index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Checklist</title>
    <link rel="stylesheet" href="style.css" />
    <script src="app.js" defer></script>
  </head>
  <body>
    <main>
      <section class="panel">
        <header>
          <h1>Checklist</h1>
          <span id="count">0 / 0</span>
        </header>
        <form id="add-form">
          <input id="new-item" type="text" placeholder="Add an item" autocomplete="off" maxlength="200" />
          <button type="submit">Add</button>
        </form>
        <ul id="items"></ul>
        <button id="clear" class="quiet" type="button">Clear all</button>
      </section>
    </main>
  </body>
</html>
`,
      "content/style.css": `${BASE_STYLE}
header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
#count { color: var(--muted); font-variant-numeric: tabular-nums; }
form { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-bottom: 14px; }
input { min-height: 40px; width: 100%; border: 0; border-radius: 8px; padding: 9px 12px; background: #f1f0eb; color: var(--fg); box-shadow: 0 0 0 1px var(--line); }
input:focus { outline: none; box-shadow: 0 0 0 2px rgba(22, 121, 111, 0.22), 0 0 0 1px var(--accent); }
ul { list-style: none; padding: 0; margin: 0 0 14px; display: grid; gap: 6px; }
li { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px; min-height: 44px; padding: 8px 10px; border-radius: 8px; background: #f7f6f2; box-shadow: 0 0 0 1px var(--line); }
li.done span { color: var(--muted); text-decoration: line-through; }
input[type="checkbox"] { width: 18px; min-height: 18px; accent-color: var(--accent); box-shadow: none; }
.delete, .quiet { background: transparent; color: var(--muted); box-shadow: 0 0 0 1px var(--line); }
.delete { min-height: 32px; padding: 5px 9px; font-size: 13px; }
`,
      "content/app.js": `const STORAGE_KEY = "items";
const form = document.getElementById("add-form");
const input = document.getElementById("new-item");
const list = document.getElementById("items");
const count = document.getElementById("count");
let items = [];

async function load() {
  try {
    const saved = await window.capsule.request("storage.local", "get", { key: STORAGE_KEY });
    if (Array.isArray(saved)) items = saved;
  } catch {
    items = [];
  }
  render();
}

async function save() {
  await window.capsule.request("storage.local", "set", { key: STORAGE_KEY, value: items });
}

function render() {
  list.replaceChildren();
  for (const item of items) {
    const row = document.createElement("li");
    if (item.done) row.classList.add("done");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.done;
    checkbox.addEventListener("change", () => {
      item.done = checkbox.checked;
      render();
      save();
    });
    const text = document.createElement("span");
    text.textContent = item.text;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      items = items.filter((x) => x.id !== item.id);
      render();
      save();
    });
    row.append(checkbox, text, del);
    list.append(row);
  }
  const done = items.filter((item) => item.done).length;
  count.textContent = \`\${done} / \${items.length}\`;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  items.push({ id: crypto.randomUUID(), text, done: false });
  input.value = "";
  render();
  save();
});

document.getElementById("clear").addEventListener("click", () => {
  items = [];
  render();
  save();
});

load();
`,
      "source/README.md": "# Checklist capsule\n\nUses `storage.local` to save checklist items inside capsule-private storage.\n",
    },
  },
  calculator: {
    name: "calculator",
    label: "Offline calculator",
    description: "A small calculator template with no requested capabilities.",
    permissions: [],
    privacy: {
      summary: "Does not store data and does not contact the network.",
      data_stored: [],
      data_shared: [],
    },
    files: {
      "content/index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Calculator</title>
    <link rel="stylesheet" href="style.css" />
    <script src="app.js" defer></script>
  </head>
  <body>
    <main>
      <section class="panel">
        <h1>Calculator</h1>
        <p>Runs entirely inside this capsule.</p>
        <label>Amount <input id="amount" type="number" min="0" step="100" value="250000" /></label>
        <label>Rate <input id="rate" type="number" min="0" step="0.1" value="6.5" /></label>
        <label>Years <input id="years" type="number" min="1" step="1" value="30" /></label>
        <output id="payment">$0</output>
      </section>
    </main>
  </body>
</html>
`,
      "content/style.css": `${BASE_STYLE}
label { display: grid; gap: 6px; margin-top: 12px; color: var(--muted); font-weight: 600; }
input { min-height: 40px; border: 0; border-radius: 8px; padding: 9px 12px; background: #f1f0eb; color: var(--fg); box-shadow: 0 0 0 1px var(--line); font-variant-numeric: tabular-nums; }
output { display: block; margin-top: 18px; padding: 16px; border-radius: 8px; background: #edf7f3; color: var(--accent); font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; }
`,
      "content/app.js": `const amount = document.getElementById("amount");
const rate = document.getElementById("rate");
const years = document.getElementById("years");
const payment = document.getElementById("payment");
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function calculate() {
  const principal = Number(amount.value);
  const monthlyRate = Number(rate.value) / 100 / 12;
  const months = Number(years.value) * 12;
  const value = monthlyRate === 0
    ? principal / months
    : principal * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
  payment.textContent = money.format(Number.isFinite(value) ? value : 0);
}

for (const input of [amount, rate, years]) input.addEventListener("input", calculate);
calculate();
`,
      "source/README.md": "# Calculator capsule\n\nA no-permission starter for offline calculators and estimators.\n",
    },
  },
};
