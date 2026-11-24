// Assemble the static site for the hosted viewer:
//   <out>/index.html               the viewer
//   <out>/examples/<slug>.capsule  every example, packed deterministically
//   <out>/examples/<slug>.capsule.html  self-opening copies (direct downloads)
//   <out>/examples/index.json      listing the viewer shows on its landing page
//
// Usage: node scripts/build-site.mjs <out-dir>
// Used by the GitHub Pages workflow and by the end-to-end tests.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { embedCapsuleInHtml, packArchive } from "@capsule/core";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const out = path.resolve(process.argv[2] ?? path.join(here, "..", "site"));

const viewer = await fs.readFile(path.join(here, "..", "dist", "viewer.html"), "utf8").catch(() => {
  throw new Error("dist/viewer.html is missing; run `pnpm --filter @capsule/web build` first");
});

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(path.join(out, "examples"), { recursive: true });
await fs.writeFile(path.join(out, "index.html"), viewer);
// GitHub Pages: serve files as-is (no Jekyll processing).
await fs.writeFile(path.join(out, ".nojekyll"), "");

const examplesDir = path.join(repoRoot, "examples");
const listing = [];
for (const name of (await fs.readdir(examplesDir)).sort()) {
  const dir = path.join(examplesDir, name);
  if (!(await fs.stat(path.join(dir, "capsule.json")).catch(() => null))) continue;
  const files = await collect(dir);
  const { bytes, manifest } = await packArchive(files);
  const file = `${manifest.slug}.capsule`;
  await fs.writeFile(path.join(out, "examples", file), bytes);
  await fs.writeFile(
    path.join(out, "examples", `${manifest.slug}.capsule.html`),
    embedCapsuleInHtml(viewer, bytes, `${manifest.name} · Capsule`),
  );
  listing.push({ file, name: manifest.name, description: manifest.description });
}
await fs.writeFile(path.join(out, "examples", "index.json"), JSON.stringify(listing, null, 2) + "\n");
console.log(`site → ${out} (${listing.length} examples)`);

async function collect(root) {
  const result = [];
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of await fs.readdir(cur, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".DS_Store" || e.name === "package.json") continue;
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        result.push({
          path: path.relative(root, full).split(path.sep).join("/"),
          bytes: new Uint8Array(await fs.readFile(full)),
        });
      }
    }
  }
  return result;
}
