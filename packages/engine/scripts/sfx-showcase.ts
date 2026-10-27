/**
 * Render every procedural sound effect, in catalog order with half a second
 * between them, to one WAV plus a text file of where each one starts, to
 * listen to the whole library in one go.
 *
 *   npx tsx packages/engine/scripts/sfx-showcase.ts <out-dir>
 *
 * Writes <out-dir>/showcase.wav and <out-dir>/showcase.txt.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { encodeWav } from "../src/io/wav.js";
import { SFX_SAMPLE_RATE } from "../src/sfx/dsp.js";
import { SFX_RECIPES } from "../src/sfx/recipes.js";
import { renderSfx } from "../src/sfx/render.js";

const GAP_SECONDS = 0.5;

const dir = process.argv[2];
if (!dir) {
  console.error("usage: sfx-showcase.ts <out-dir>");
  process.exit(2);
}
mkdirSync(dir, { recursive: true });

const renders = SFX_RECIPES.map((recipe) => renderSfx(recipe.id, { seed: 7 }));
const gap = Math.round(GAP_SECONDS * SFX_SAMPLE_RATE);
const total = renders.reduce((n, r) => n + r.left.length + gap, gap);
const left = new Float32Array(total);
const right = new Float32Array(total);
const lines = ["start_s  hit_s    length_s  recipe            family      title"];
let at = gap;
renders.forEach((r, i) => {
  left.set(r.left, at);
  right.set(r.right, at);
  const recipe = SFX_RECIPES[i]!;
  const start = at / SFX_SAMPLE_RATE;
  lines.push(
    `${start.toFixed(2).padStart(7)}  ${(start + r.hit).toFixed(2).padStart(7)}  ${r.duration.toFixed(2).padStart(8)}  ${recipe.id.padEnd(16)}  ${recipe.family.padEnd(10)}  ${recipe.title}`,
  );
  at += r.left.length + gap;
});
writeFileSync(path.join(dir, "showcase.wav"), encodeWav([left, right], SFX_SAMPLE_RATE));
writeFileSync(path.join(dir, "showcase.txt"), `${lines.join("\n")}\n`);
console.log(`${renders.length} effects, ${(total / SFX_SAMPLE_RATE).toFixed(1)} s → ${path.join(dir, "showcase.wav")}`);
