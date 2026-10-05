/**
 * Type-check the host scripts: one `tsc -p` per tsconfig.jsx*.json in this
 * package (Premiere: tsconfig.jsx-ppro.json; After Effects brings its own).
 * Each app's typings declare a different `app`, so every app needs its own
 * TypeScript program.
 *
 *   npm run typecheck:jsx -w @zenvi/adobe-link
 */

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configs = readdirSync(root)
  .filter((name) => /^tsconfig\.jsx.*\.json$/.test(name))
  .sort();
if (configs.length === 0) {
  console.error("No tsconfig.jsx*.json in " + root);
  process.exit(1);
}
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
let failed = 0;
for (const config of configs) {
  const result = spawnSync(process.execPath, [tsc, "-p", path.join(root, config)], { stdio: "inherit" });
  if (result.status !== 0) failed += 1;
  console.log(`${result.status === 0 ? "ok" : "failed"}: ${config}`);
}
process.exit(failed > 0 ? 1 : 0);
