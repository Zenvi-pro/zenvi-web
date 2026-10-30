#!/usr/bin/env node
/**
 * Embed docs/TASTE.md (the motion and editing defaults) in the CLI as
 * src/hosts/taste.gen.ts, the zenvi-motion-director skill with its genre
 * recipes as src/hosts/director.gen.ts and the zenvi-sound-designer skill with
 * its genre palettes as src/hosts/sound.gen.ts, so `zenvi mcp` can serve them
 * as `zenvi://taste` / `zenvi://director` / `zenvi://sound` and in its prompts
 * from any build (a single-file bundle has no docs or plugin folder).
 *
 *   node packages/cli/scripts/sync-taste.mjs [--check]
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..", "..");
const SOURCE = path.resolve(ROOT, "docs", "TASTE.md");
const TARGET = path.resolve(here, "..", "src", "hosts", "taste.gen.ts");
const DIRECTOR = path.resolve(ROOT, "plugins", "zenvi", "skills", "zenvi-motion-director");
const DIRECTOR_TARGET = path.resolve(here, "..", "src", "hosts", "director.gen.ts");
const SOUND = path.resolve(ROOT, "plugins", "zenvi", "skills", "zenvi-sound-designer");
const SOUND_TARGET = path.resolve(here, "..", "src", "hosts", "sound.gen.ts");

export function tasteModule(markdown) {
  return [
    "// Generated from docs/TASTE.md by packages/cli/scripts/sync-taste.mjs. Do not edit.",
    "",
    "/** TASTE.md: the motion design and editing defaults (zenvi://taste, the taste prompts, the skills). */",
    `export const TASTE_MARKDOWN: string = ${JSON.stringify(markdown)};`,
    "",
  ].join("\n");
}

/** A skill's SKILL.md without its front matter, and the markdown files of its `sub` folder by genre (file name without .md), sorted. */
export function readSkill(dir, sub) {
  const skill = readFileSync(path.join(dir, "SKILL.md"), "utf8").replace(/^---\n[\s\S]*?\n---\n+/, "");
  const recipes = readdirSync(path.join(dir, sub))
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => ({ genre: name.slice(0, -3), markdown: readFileSync(path.join(dir, sub, name), "utf8") }));
  return { skill, recipes };
}

/** The motion-director skill and its recipes. */
export function readDirector(dir = DIRECTOR) {
  return readSkill(dir, "recipes");
}

export function directorModule({ skill, recipes }) {
  return [
    "// Generated from plugins/zenvi/skills/zenvi-motion-director by packages/cli/scripts/sync-taste.mjs. Do not edit.",
    "",
    "/** The motion-director skill's SKILL.md body (zenvi://director, the motion_director prompt). */",
    `export const DIRECTOR_SKILL: string = ${JSON.stringify(skill)};`,
    "",
    "/** Its genre recipes (zenvi://director/<genre>), by file name. */",
    `export const DIRECTOR_RECIPES: readonly { genre: string; markdown: string }[] = ${JSON.stringify(recipes, null, 2)};`,
    "",
  ].join("\n");
}

export function soundModule({ skill, recipes }) {
  return [
    "// Generated from plugins/zenvi/skills/zenvi-sound-designer by packages/cli/scripts/sync-taste.mjs. Do not edit.",
    "",
    "/** The sound-designer skill's SKILL.md body (zenvi://sound, the sound_designer prompt). */",
    `export const SOUND_SKILL: string = ${JSON.stringify(skill)};`,
    "",
    "/** Its genre palettes (zenvi://sound/<genre>), by file name. */",
    `export const SOUND_PALETTES: readonly { genre: string; markdown: string }[] = ${JSON.stringify(recipes, null, 2)};`,
    "",
  ].join("\n");
}

function sync(target, text) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    current = "";
  }
  if (process.argv.includes("--check")) {
    if (current !== text) {
      console.error(`${path.relative(process.cwd(), target)} is stale: run node packages/cli/scripts/sync-taste.mjs`);
      process.exitCode = 1;
      return;
    }
    console.log(`${path.relative(process.cwd(), target)} is up to date`);
  } else {
    writeFileSync(target, text);
    console.log(`wrote ${path.relative(process.cwd(), target)}`);
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  sync(TARGET, tasteModule(readFileSync(SOURCE, "utf8")));
  sync(DIRECTOR_TARGET, directorModule(readDirector()));
  sync(SOUND_TARGET, soundModule(readSkill(SOUND, "palettes")));
}
