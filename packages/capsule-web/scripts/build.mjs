// Build the single-file browser viewer: bundle src/viewer.ts with esbuild and
// inline it, with src/viewer.css, into dist/viewer.html. The same file is the
// hosted viewer (GitHub Pages) and the template the CLI wraps capsules in for
// self-opening .capsule.html files.
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const require = createRequire(import.meta.url);
const runtimeHost = path.join(path.dirname(require.resolve("@capsule/runtime/package.json")), "src", "host");

const HOSTED_VIEWER_URL = process.env.CAPSULE_VIEWER_URL ?? "https://imjustricky.github.io/capsule/";

const [bridgeSource, navShimSource, viewerCss, template] = await Promise.all([
  fs.readFile(path.join(runtimeHost, "bridge.js"), "utf8"),
  fs.readFile(path.join(root, "src", "shims", "navigate.js"), "utf8"),
  fs.readFile(path.join(root, "src", "viewer.css"), "utf8"),
  fs.readFile(path.join(root, "src", "viewer.html"), "utf8"),
]);

const result = await esbuild.build({
  entryPoints: [path.join(root, "src", "viewer.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020", "chrome103", "firefox113", "safari16.4"],
  write: false,
  minify: false,
  legalComments: "none",
  charset: "utf8",
  define: {
    __BRIDGE_SOURCE__: JSON.stringify(bridgeSource),
    __NAV_SHIM_SOURCE__: JSON.stringify(navShimSource),
    __HOSTED_VIEWER_URL__: JSON.stringify(HOSTED_VIEWER_URL),
  },
  logLevel: "warning",
});
const js = result.outputFiles[0].text;

// The bundle is inlined into a <script> element, so it must never contain
// text the HTML tokenizer would treat as the end of (or an escape inside) it.
for (const [needle, why] of [
  [/<\/script/i, "would close the inline <script> early"],
  [/<!--/, "would switch the tokenizer into script-escape state"],
]) {
  if (needle.test(js)) throw new Error(`viewer bundle contains ${needle}: ${why}`);
}
for (const [label, source] of [["bridge.js", bridgeSource], ["navigate.js", navShimSource]]) {
  if (/<\/script/i.test(source)) throw new Error(`${label} contains </script; it is injected inline`);
}

const css = viewerCss;
if (/<\/style/i.test(css)) throw new Error("viewer CSS contains </style");

let html = template;
for (const [marker, value] of [["/*__VIEWER_CSS__*/", css], ["/*__VIEWER_JS__*/", js]]) {
  const at = html.indexOf(marker);
  if (at < 0 || html.indexOf(marker, at + 1) >= 0) throw new Error(`template must contain ${marker} exactly once`);
  html = html.slice(0, at) + value + html.slice(at + marker.length);
}
const payloadSlots = html.match(/<script id="capsule-payload"[^>]*><\/script>/g) ?? [];
if (payloadSlots.length !== 1) throw new Error("built viewer must contain exactly one empty payload slot");

await fs.mkdir(path.join(root, "dist"), { recursive: true });
await fs.writeFile(path.join(root, "dist", "viewer.html"), html);
console.log(`built dist/viewer.html (${(html.length / 1024).toFixed(1)} KB, viewer url ${HOSTED_VIEWER_URL})`);
