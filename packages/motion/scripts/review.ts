/**
 * Render every block for review: 9:16 and 16:9 MP4s, a contact sheet
 * (contact.png, six frames per render), render timings (timings.md), and one
 * transparent ProRes 4444 render composited over a generated test clip.
 *
 *   npx tsx packages/motion/scripts/review.ts --out /tmp/motion-review [--blocks prompt_bar,counter] [--fps 30]
 *
 * Renders use a fresh cache folder, so the timings are real renders.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { BLOCKS } from "../src/index.js";
import { launchChrome, renderBlock } from "../src/node/index.js";

const { values } = parseArgs({ options: { out: { type: "string" }, blocks: { type: "string" }, fps: { type: "string", default: "30" } } });
if (!values.out) throw new Error("usage: review.ts --out <folder> [--blocks a,b]");
const out = path.resolve(values.out);
mkdirSync(out, { recursive: true });
const fps = Number(values.fps);
const ids = values.blocks ? values.blocks.split(",") : BLOCKS.map((b) => b.id);
const sizes = [
  { name: "9x16", width: 1080, height: 1920 },
  { name: "16x9", width: 1920, height: 1080 },
] as const;

function ffmpeg(args: string[]): void {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}`);
}

const cache = mkdtempSync(path.join(tmpdir(), "zenvi-motion-review-"));
// Chrome comes from the real cache; renders go to the fresh one.
const env = { ...process.env, ZENVI_CACHE_DIR: cache };
const browser = await launchChrome(process.env);
const rows: string[] = [];
const strips: string[] = [];
try {
  for (const id of ids) {
    for (const size of sizes) {
      const file = path.join(out, `${id}-${size.name}.mp4`);
      const r = await renderBlock(id, {}, { width: size.width, height: size.height, fps, alpha: false, output: file, env, browser });
      const perFrame = (r.renderSeconds / r.frames) * 1000;
      rows.push(`| ${id} | ${size.width}×${size.height} | ${r.seconds} | ${r.frames} | ${r.renderSeconds.toFixed(1)} | ${perFrame.toFixed(0)} |`);
      console.log(rows[rows.length - 1]);
      const strip = path.join(cache, `${id}-${size.name}-strip.png`);
      const step = Math.max(1, Math.floor(r.frames / 6));
      // Six frames across, each strip 1920 px wide.
      ffmpeg(["-i", file, "-vf", `select='not(mod(n\\,${step}))',scale=320:-2,tile=6x1,pad=1920:ih+8:0:0:0x222222`, "-frames:v", "1", strip]);
      strips.push(strip);
    }
  }

  // Alpha: prompt_bar as ProRes 4444 over a generated test clip.
  const mov = path.join(out, "prompt_bar-alpha.mov");
  const alpha = await renderBlock("prompt_bar", { prompt: "Turn this clip into a 9:16 teaser" }, { width: 1080, height: 1920, fps, alpha: true, output: mov, env, browser });
  rows.push(`| prompt_bar (alpha, ProRes 4444) | 1080×1920 | ${alpha.seconds} | ${alpha.frames} | ${alpha.renderSeconds.toFixed(1)} | ${((alpha.renderSeconds / alpha.frames) * 1000).toFixed(0)} |`);
  const clip = path.join(cache, "testsrc.mp4");
  ffmpeg(["-f", "lavfi", "-i", `testsrc2=size=1080x1920:rate=${fps}:duration=${alpha.seconds}`, "-pix_fmt", "yuv420p", clip]);
  ffmpeg(["-i", clip, "-i", mov, "-filter_complex", "[0][1]overlay=format=auto,format=yuv420p", "-c:v", "libx264", "-crf", "18", path.join(out, "prompt_bar-alpha-over-testsrc.mp4")]);
} finally {
  await browser.close();
}

if (strips.length > 0) {
  ffmpeg([...strips.flatMap((s) => ["-i", s]), "-filter_complex", `${strips.map((_, i) => `[${i}]`).join("")}vstack=${strips.length}`, path.join(out, "contact.png")]);
}
writeFileSync(
  path.join(out, "timings.md"),
  `# Zenvi Motion render timings\n\nFresh renders (no cache), ${fps} fps, 3 capture tabs, opaque H.264 unless noted. Machine: ${process.platform}/${process.arch}, shared with other jobs.\n\n| block | size | seconds | frames | render s | ms/frame |\n| --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}\n`,
);
rmSync(cache, { recursive: true, force: true });
console.log(`wrote ${out}`);
