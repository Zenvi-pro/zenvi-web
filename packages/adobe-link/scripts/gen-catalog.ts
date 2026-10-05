/**
 * Write the host tool catalogs the extension bundles:
 * `extension/catalog/{aftereffects,premiere}.json` (committed; a test fails
 * when they are stale).
 *
 *   npm run gen:catalog -w @zenvi/adobe-link            # write
 *   npm run gen:catalog -w @zenvi/adobe-link -- --check # fail when stale
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_IDS, catalogFileName, catalogFileText } from "../src/catalog/index.js";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "extension", "catalog");
const check = process.argv.includes("--check");
let stale = 0;
mkdirSync(dir, { recursive: true });
for (const host of HOST_IDS) {
  const file = path.join(dir, catalogFileName(host));
  const text = catalogFileText(host);
  let current = "";
  try {
    current = readFileSync(file, "utf8");
  } catch {
    current = "";
  }
  if (current === text) continue;
  if (check) {
    console.error(`stale: ${path.relative(process.cwd(), file)}`);
    stale += 1;
  } else {
    writeFileSync(file, text);
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
  }
}
if (stale > 0) {
  console.error("Run `npm run gen:catalog -w @zenvi/adobe-link`.");
  process.exit(1);
}
