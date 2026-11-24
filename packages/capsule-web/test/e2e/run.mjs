// End-to-end tests for the browser viewer (and the Node runtime CSP fix),
// driven by Playwright + Chromium. Plain Node script, no test runner:
//
//   pnpm --filter @capsule/web build && pnpm --filter @capsule/web test:e2e
//
// Playwright is resolved from the environment (NODE_PATH) rather than being a
// dependency, so the repo does not pin a browser build. Set CAPSULE_CHROMIUM
// to use a specific Chromium binary.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packArchive } from "@capsule/core";
import { buildSelfOpeningHtml } from "../../dist/node.js";

const require = createRequire(import.meta.url);
const { chromium } = loadPlaywright();
const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(pkgRoot, "..", "..");

function loadPlaywright() {
  for (const id of ["playwright", "@playwright/test"]) {
    try {
      return require(id);
    } catch {
      // try next
    }
  }
  throw new Error("Playwright is not installed. Install it globally and set NODE_PATH=$(npm root -g).");
}

// ---------------------------------------------------------------------
// Fixtures: built site, probe capsule, tampered capsule, static server
// ---------------------------------------------------------------------

const work = await fs.mkdtemp(path.join(os.tmpdir(), "capsule-e2e-"));
const site = path.join(work, "site");
execFileSync(process.execPath, [path.join(pkgRoot, "scripts", "build-site.mjs"), site], { stdio: "inherit" });

const hits = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/ping") {
    hits.push(url.search);
    res.writeHead(200, { "access-control-allow-origin": "*", "content-type": "image/gif" });
    res.end(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
    return;
  }
  const file = path.join(site, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  if (!file.startsWith(site)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await fs.readFile(file);
    const type = file.endsWith(".html") ? "text/html" : file.endsWith(".json") ? "application/json" : "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/`;
const PING = `${base}ping`;

const enc = (s) => new TextEncoder().encode(s);
const DOT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

async function packFixture(files) {
  const { bytes } = await packArchive(files.map(([p, c]) => ({ path: p, bytes: typeof c === "string" ? enc(c) : new Uint8Array(c) })));
  return bytes;
}

const probeManifest = {
  capsule_version: "1.0",
  name: "Sandbox Probe",
  slug: "sandbox-probe",
  version: "1.0.0",
  description: "Tries every escape hatch and reports what happened.",
  entry: "content/index.html",
  permissions: [{ capability: "network.fetch", scope: [`127.0.0.1:${port}`], reason: "Probe the private-network block." }],
  network: { default: "deny", allow: [`127.0.0.1:${port}`] },
};
const probeApp = `
(async () => {
  const out = {};
  out.deferRanAfterParse = document.getElementById("out") !== null;
  out.inline = window.__inlineRan === true;
  out.origin = String(self.origin);
  try { localStorage.getItem("x"); out.localStorage = "allowed"; } catch { out.localStorage = "blocked"; }
  try { void parent.document.title; out.parentDom = "allowed"; } catch { out.parentDom = "blocked"; }
  try { eval("1"); out.eval = "allowed"; } catch { out.eval = "blocked"; }
  try { await fetch(${JSON.stringify(PING)} + "?from=fetch"); out.fetch = "allowed"; } catch { out.fetch = "blocked"; }
  out.img = await new Promise((r) => { const i = new Image(); i.onload = () => r("allowed"); i.onerror = () => r("blocked"); i.src = ${JSON.stringify(PING)} + "?from=img"; });
  try { out.popup = window.open("https://example.com") ? "allowed" : "blocked"; } catch { out.popup = "blocked"; }
  out.capsuleApi = typeof (window.capsule && window.capsule.request);
  try { await window.capsule.request("clipboard.write", "text", { text: "x" }); out.undeclared = "allowed"; } catch (e) { out.undeclared = e.code; }
  try { await window.capsule.request("network.fetch", "request", { url: ${JSON.stringify(`https://127.0.0.1:${port}/ping?from=bridge`)} }); out.privateFetch = "allowed"; } catch (e) { out.privateFetch = e.code; }
  out.logoWidth = document.getElementById("logo").naturalWidth;
  out.bgInlined = getComputedStyle(document.getElementById("bg")).backgroundImage.startsWith('url("data:image/png');
  out.h1Color = getComputedStyle(document.getElementById("title")).color;
  document.getElementById("out").textContent = JSON.stringify(out);
  document.body.dataset.done = "1";
})();
`;
const probeBytes = await packFixture([
  ["capsule.json", JSON.stringify(probeManifest)],
  [
    "content/index.html",
    `<!doctype html><html><head><title>Probe</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head>
<body><h1 id="title">Probe</h1><img id="logo" src="../assets/dot.png" alt=""><div id="bg"></div>
<a id="next" href="page2.html">next</a><pre id="out"></pre><script>window.__inlineRan = true;</script></body></html>`,
  ],
  ["content/page2.html", `<!doctype html><title>Two</title><h1 id="p2">Page two</h1><a id="back" href="index.html">back</a>`],
  ["content/style.css", `#bg{width:4px;height:4px;background-image:url("../assets/dot.png")} h1{color:rgb(1, 2, 3)}`],
  ["content/app.js", probeApp],
  ["assets/dot.png", DOT_PNG],
]);
await fs.mkdir(path.join(site, "fixtures"), { recursive: true });
await fs.writeFile(path.join(site, "fixtures", "probe.capsule"), probeBytes);

// Tampered: valid archive whose declared hash no longer matches its content.
const tamperedManifest = { ...probeManifest, slug: "tampered", permissions: [], network: { default: "deny", allow: [] } };
const goodTampered = await packFixture([
  ["capsule.json", JSON.stringify(tamperedManifest)],
  ["content/index.html", "<!doctype html><p>original</p>"],
]);
const { readArchiveFromBuffer } = await import("@capsule/core");
const declared = JSON.parse(new TextDecoder().decode((await readArchiveFromBuffer(goodTampered)).byPath.get("capsule.json").bytes));
const { bytes: tamperedBytes } = await packArchive(
  [
    { path: "capsule.json", bytes: enc(JSON.stringify(declared)) },
    { path: "content/index.html", bytes: enc("<!doctype html><p>EVIL</p>") },
  ],
  { stampIntegrity: false },
);
await fs.writeFile(path.join(site, "fixtures", "tampered.capsule"), tamperedBytes);

// Self-opening checklist for file:// tests.
const selfOpening = path.join(work, "offline-checklist.capsule.html");
await fs.copyFile(path.join(site, "examples", "offline-checklist.capsule.html"), selfOpening);

// ---------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------

const launchOptions = process.env.CAPSULE_CHROMIUM ? { executablePath: process.env.CAPSULE_CHROMIUM } : {};
const browser = await chromium.launch(launchOptions);
const results = [];

async function test(name, fn) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await fn(page, context);
    assert.deepEqual(errors, [], "viewer threw uncaught errors");
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✗ ${name}\n    ${String(err?.stack ?? err).split("\n").slice(0, 6).join("\n    ")}`);
  } finally {
    await context.close();
  }
}

async function openScreen(page) {
  await page.waitForSelector("#open-screen:not(.hidden), #error-screen:not(.hidden)", { timeout: 15_000 });
  const error = await page.$("#error-screen:not(.hidden)");
  if (error) throw new Error(`viewer error: ${await page.textContent("#error-message")} (${await page.textContent("#error-code")})`);
}

async function run(page) {
  await page.click("#btn-run");
  await page.waitForSelector("#run-screen:not(.hidden) iframe");
  const frameHandle = await page.$("#frame-host iframe");
  let frame = await frameHandle.contentFrame();
  for (let i = 0; i < 50 && !(await frame.$("body")); i++) await page.waitForTimeout(50);
  frame = await frameHandle.contentFrame();
  return frame;
}

async function allowNextPrompt(page) {
  await page.waitForSelector("#permission-dialog[open]", { timeout: 10_000 });
  const detail = `${await page.textContent("#perm-title")} ${await page.textContent("#perm-detail")}`;
  await page.click("#perm-allow");
  return detail;
}

console.log("\ncapsule browser viewer e2e");

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

await test("landing page lists the packed examples", async (page) => {
  await page.goto(base);
  await page.waitForSelector("#examples:not(.hidden) .example-link");
  const names = await page.$$eval(".example-name", (els) => els.map((e) => e.textContent));
  assert.ok(names.includes("Pocket Notes"), `examples: ${names}`);
  assert.ok(names.length >= 4);
});

await test("mortgage calculator: opens via ?src, verifies, runs with no capabilities", async (page) => {
  await page.goto(`${base}?src=examples/mortgage-calculator.capsule`);
  await openScreen(page);
  assert.equal(await page.textContent("#cap-name"), "Mortgage Calculator");
  assert.match(await page.textContent("#cap-status"), /Unchanged since it was packed/);
  assert.equal(await page.$$eval("#can-list li", (els) => els.length), 0);
  assert.match(await page.textContent("#perms-title"), /can’t reach anything/);
  assert.equal(await page.textContent("#btn-run-label"), "Run Mortgage Calculator");
  const frame = await run(page);
  await frame.waitForFunction(() => /\$\d/.test(document.body.innerText), null, { timeout: 5000 });
});

await test("offline checklist: storage.local prompt, persistence across reloads", async (page) => {
  await page.goto(`${base}?src=examples/offline-checklist.capsule`);
  await openScreen(page);
  let frame = await run(page);
  await frame.waitForSelector("input[type=text], input:not([type])");
  const detail = await allowNextPrompt(page);
  assert.match(detail, /^Allow Offline Checklist to save data on this device\? The author says: “/);
  const input = await frame.$("input[type=text], input:not([type])");
  await input.fill("Buy milk");
  await input.press("Enter");
  await frame.waitForFunction(() => document.body.innerText.includes("Buy milk"));
  await page.waitForTimeout(300);

  await page.reload();
  await openScreen(page);
  frame = await run(page);
  await allowNextPrompt(page);
  await frame.waitForFunction(() => document.body.innerText.includes("Buy milk"), null, { timeout: 5000 });
});

await test("pocket notes: markdown renders inside the sandbox", async (page) => {
  await page.goto(`${base}?src=examples/pocket-notes.capsule`);
  await openScreen(page);
  const frame = await run(page);
  await allowNextPrompt(page);
  // The app wires its input listener only after the storage read resolves
  // and its first render shows the empty-state placeholder.
  await frame.waitForSelector("#preview .empty");
  await frame.fill("#editor", "# Hello capsule\n\nsome **bold** text");
  await frame.waitForFunction(() => document.querySelector("#preview h1")?.textContent?.includes("Hello capsule"));
  assert.equal(await frame.textContent("#preview strong"), "bold");
});

await test("poster maker: canvas app runs; Inspect shows files and activity", async (page) => {
  await page.goto(`${base}?src=examples/poster-maker.capsule`);
  await openScreen(page);
  assert.deepEqual(await page.$$eval("#can-list li", (els) => els.map((e) => e.textContent)), [
    "Save its own data on this device",
    "Save files where you choose",
  ]);
  assert.match(await page.textContent("#cant-text"), /can’t use the internet, see your files, read your clipboard/);
  // Details expands in place with the author's reasons and the fingerprint.
  await page.click("#btn-details");
  assert.equal(await page.getAttribute("#btn-details", "aria-expanded"), "true");
  assert.match(await page.textContent("#details-list"), /Remember your draft between sessions/);
  assert.match(await page.textContent("#details-list"), /Fingerprint\s*sha256:[0-9a-f]{64}/);
  const frame = await run(page);
  await allowNextPrompt(page);
  await frame.waitForSelector("canvas");
  await page.click("#btn-back");
  await page.click("#btn-inspect");
  const files = await page.textContent("#inspect-files");
  assert.match(files, /content\/app\.js/);
  const activity = await page.textContent("#inspect-activity");
  assert.match(activity, /run\.start/);
  assert.match(activity, /storage\.local/);
});

await test("sandbox probe: every escape hatch is closed", async (page) => {
  hits.length = 0;
  await page.goto(`${base}?src=fixtures/probe.capsule`);
  await openScreen(page);
  const frame = await run(page);
  const detail = await allowNextPrompt(page); // network.fetch prompt (declared + in scope)
  assert.match(detail, new RegExp(`connect to 127\\.0\\.0\\.1:${port}\\?`));
  await frame.waitForSelector("body[data-done='1']", { timeout: 10_000 });
  const out = JSON.parse(await frame.textContent("#out"));
  assert.deepEqual(out, {
    deferRanAfterParse: true,
    inline: true,
    origin: "null",
    localStorage: "blocked",
    parentDom: "blocked",
    eval: "blocked",
    fetch: "blocked",
    img: "blocked",
    popup: "blocked",
    capsuleApi: "function",
    undeclared: "capability.not_declared",
    privateFetch: "network.blocked",
    logoWidth: 1,
    bgInlined: true,
    h1Color: "rgb(1, 2, 3)",
  });
  assert.deepEqual(hits, [], "the capsule reached the network");

  // The viewer itself is now locked to the capsule's (public) allowlist: none.
  const viewerFetch = await page.evaluate((u) => fetch(u).then(() => "allowed", () => "blocked"), `${PING}?from=viewer`);
  assert.equal(viewerFetch, "blocked");
  assert.deepEqual(hits, []);
});

await test("relative links navigate between capsule pages", async (page) => {
  await page.goto(`${base}?src=fixtures/probe.capsule`);
  await openScreen(page);
  const frame = await run(page);
  await allowNextPrompt(page);
  await frame.waitForSelector("body[data-done='1']");
  await frame.click("#next");
  await page.waitForFunction(() => document.querySelector("#runbar-page")?.textContent === "content/page2.html");
  const frame2 = await (await page.$("#frame-host iframe")).contentFrame();
  await frame2.waitForSelector("#p2");
  assert.equal(await frame2.textContent("#p2"), "Page two");
});

await test("tampered capsule is refused before anything runs", async (page) => {
  await page.goto(`${base}?src=fixtures/tampered.capsule`);
  await page.waitForSelector("#error-screen:not(.hidden)");
  assert.match(await page.textContent("#error-code"), /integrity\.mismatch/);
  assert.match(await page.textContent("#error-title"), /changed after it was packed/);
  assert.match(await page.textContent("#error-message"), /won’t be run/);
  assert.equal(await page.$("iframe"), null);
});

await test("drag-free file picker path opens a .capsule.html wrapper", async (page) => {
  await page.goto(base);
  await page.setInputFiles("#file-input", selfOpening);
  await openScreen(page);
  assert.equal(await page.textContent("#cap-name"), "Offline Checklist");
  await page.click("#btn-details");
  assert.match(await page.textContent("#details-list"), /Opened from\s*offline-checklist\.capsule\.html/);
});

await test("self-opening .capsule.html works from file:// and says where to verify it", async (page) => {
  await page.goto(`file://${selfOpening}`);
  await openScreen(page);
  assert.ok(await page.$("#embedded-notice:not(.hidden)"));
  assert.match(await page.textContent("#trusted-cli-command"), /capsule inspect offline-checklist\.capsule\.html/);
  assert.ok(await page.$("#btn-another.hidden"));
  const frame = await run(page);
  await allowNextPrompt(page);
  const input = await frame.waitForSelector("input[type=text], input:not([type])");
  await input.fill("From a file");
  await input.press("Enter");
  await frame.waitForFunction(() => document.body.innerText.includes("From a file"));
});

await test("an AI-style single-file app with inline scripts runs (CLI make --html)", async (page) => {
  const appPath = path.join(work, "ai.html");
  await fs.writeFile(
    appPath,
    `<!doctype html><title>Inline App</title><button id="b" onclick="this.textContent='clicked'">go</button><p id="p">static</p><script>document.getElementById('p').textContent='inline ran'</script>`,
  );
  execFileSync(process.execPath, [path.join(repoRoot, "packages", "capsule-cli", "bin", "capsule.mjs"), "make", appPath, "--html", "--force", "-o", path.join(work, "inline-app.capsule")], { cwd: work });
  await page.goto(`file://${path.join(work, "inline-app.capsule.html")}`);
  await openScreen(page);
  const frame = await run(page);
  await frame.waitForFunction(() => document.getElementById("p")?.textContent === "inline ran");
  await frame.click("#b");
  assert.equal(await frame.textContent("#b"), "clicked");
});

await test("Node runtime (capsule run) now executes inline scripts too", async (page) => {
  const { runCapsule } = await import("@capsule/runtime");
  const running = await runCapsule(path.join(work, "inline-app.capsule"), { headless: true, receiptPath: null });
  try {
    await page.goto(running.url);
    await page.click("#btn-run");
    const frame = await (await page.waitForSelector("#capsule-frame")).contentFrame();
    await frame.waitForFunction(() => document.getElementById("p")?.textContent === "inline ran", null, { timeout: 5000 });
  } finally {
    await running.server.close();
  }
});

await test("self-opening wrapper built by the Node helper matches the CLI output format", async () => {
  const html = await buildSelfOpeningHtml(probeBytes, "Probe · Capsule");
  assert.match(html, /<title>Probe · Capsule<\/title>/);
  assert.equal((html.match(/id="capsule-payload"/g) ?? []).length, 1);
});

// ---------------------------------------------------------------------

await browser.close();
server.close();
await fs.rm(work, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
