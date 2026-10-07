#!/usr/bin/env node
/**
 * Embed docs/TASTE.md (the motion and editing defaults) in the CLI as
 * src/hosts/taste.gen.ts, so `zenvi mcp` can serve it as `zenvi://taste` and
 * in its prompts from any build (a single-file bundle has no docs folder).
 *
 *   node packages/cli/scripts/sync-taste.mjs [--check]
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(here, "..", "..", "..", "docs", "TASTE.md");
const TARGET = path.resolve(here, "..", "src", "hosts", "taste.gen.ts");

export function tasteModule(markdown) {
  return [
    "// Generated from docs/TASTE.md by packages/cli/scripts/sync-taste.mjs. Do not edit.",
    "",
    "/** TASTE.md: the motion design and editing defaults (zenvi://taste, the taste prompts, the skills). */",
    `export const TASTE_MARKDOWN: string = ${JSON.stringify(markdown)};`,
    "",
  ].join("\n");
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const text = tasteModule(readFileSync(SOURCE, "utf8"));
  let current = "";
  try {
    current = readFileSync(TARGET, "utf8");
  } catch {
    current = "";
  }
  if (process.argv.includes("--check")) {
    if (current !== text) {
      console.error(`${path.relative(process.cwd(), TARGET)} is stale: run node packages/cli/scripts/sync-taste.mjs`);
      process.exit(1);
    }
    console.log(`${path.relative(process.cwd(), TARGET)} is up to date`);
  } else {
    writeFileSync(TARGET, text);
    console.log(`wrote ${path.relative(process.cwd(), TARGET)}`);
  }
}
