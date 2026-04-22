import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "src", "host");
const dst = path.join(here, "..", "dist", "host");

await fs.mkdir(dst, { recursive: true });
for (const name of await fs.readdir(src)) {
  await fs.copyFile(path.join(src, name), path.join(dst, name));
}
console.log(`copied host assets → ${path.relative(process.cwd(), dst)}`);
