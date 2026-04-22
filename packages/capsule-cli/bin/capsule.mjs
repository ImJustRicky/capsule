#!/usr/bin/env node
import { run } from "../dist/index.js";
run(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (err) => {
    console.error(err?.stack ?? String(err));
    process.exit(1);
  },
);
