#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const runtimeDir = process.argv[2];
if (!runtimeDir) {
  console.error("usage: rewrite-workspace-deps.mjs <runtime-dir>");
  process.exit(1);
}

const packagesDir = path.join(runtimeDir, "packages");
const packageDirs = await readdir(packagesDir, { withFileTypes: true });
const packageByName = new Map();

for (const entry of packageDirs) {
  if (!entry.isDirectory()) continue;
  const packageJsonPath = path.join(packagesDir, entry.name, "package.json");
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
  if (typeof pkg.name === "string") {
    packageByName.set(pkg.name, entry.name);
  }
}

for (const entry of packageDirs) {
  if (!entry.isDirectory()) continue;
  const packageJsonPath = path.join(packagesDir, entry.name, "package.json");
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
  let changed = false;

  for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const deps = pkg[section];
    if (!deps || typeof deps !== "object") continue;

    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec !== "string" || !spec.startsWith("workspace:")) continue;
      const packageDir = packageByName.get(name);
      if (!packageDir) {
        throw new Error(`Cannot rewrite ${name}@${spec}; no staged package found`);
      }
      deps[name] = `file:../${packageDir}`;
      changed = true;
    }
  }

  if (changed) {
    await writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}
