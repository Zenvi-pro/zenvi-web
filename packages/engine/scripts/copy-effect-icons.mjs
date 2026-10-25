#!/usr/bin/env node
// Copy zenvi-core src/effects/icons/* (origin/main) to assets/effects/.
// Dev-time only:  node packages/engine/scripts/copy-effect-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { readTree } from "./lib/desktop-git.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "../assets/effects");
mkdirSync(target, { recursive: true });
let bytes = 0;
let count = 0;
for (const [path, data] of readTree("src/effects/icons/")) {
  writeFileSync(join(target, posix.basename(path)), data);
  bytes += data.length;
  count += 1;
}
console.log(`copied ${count} icons (${(bytes / 1024 / 1024).toFixed(2)} MB) to ${target}`);
