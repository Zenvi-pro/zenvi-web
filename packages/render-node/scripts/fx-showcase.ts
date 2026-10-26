/**
 * Zenvi FX showcase: renders every effect over a 2 s range of each source
 * with the real renderer and writes, per source, a before/after strip per
 * effect (labelled), one H.264 reel of all effects, and `timings.md`
 * (render seconds per second of footage).
 *
 *   npx tsx packages/render-node/scripts/fx-showcase.ts <out-dir> [clip.mp4@start …]
 *
 * The first source is always a 1080p testsrc2 pattern it generates. Media
 * stay outside the repo: pass clips you are allowed to use (Pexels, your own).
 * FX_ONLY=bloom,glitch renders some effects only.
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FX_IDS, FX_INFO, parseFxStack, type FxId } from "@zenvi/engine";
import { resolveBinary } from "../src/ffmpeg/binaries.js";
import { createFxRenderer, probeFxSource } from "../src/fx/render.js";
import { encodePng } from "../src/image/png.js";
import { rasterizeSvg } from "../src/svg/rasterize.js";

const exec = promisify(execFile);
const ffmpeg = resolveBinary("ffmpeg");
const ffprobe = resolveBinary("ffprobe");
const SECONDS = 2;
const STRIP_FRAMES = 6;
const THUMB = 320;

async function run(args: string[]): Promise<void> {
  await exec(ffmpeg, ["-hide_banner", "-v", "error", "-y", ...args], { maxBuffer: 16 * 1024 * 1024 });
}

async function label(file: string, text: string, width: number): Promise<void> {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="44"><rect width="100%" height="100%" fill="#111"/><text x="14" y="30" font-family="Lato" font-size="22" fill="#eee">${escaped}</text></svg>`;
  await writeFile(file, encodePng(await rasterizeSvg(svg)));
}

/** `count` frames spread over `file`'s first `seconds`, tiled in one row. */
async function row(file: string, out: string, start: number, seconds: number): Promise<void> {
  const fps = STRIP_FRAMES / seconds;
  await run(["-ss", String(start), "-t", String(seconds), "-i", file, "-vf", `fps=${fps},scale=${THUMB}:-2,tile=${STRIP_FRAMES}x1`, "-frames:v", "1", out]);
}

async function main(): Promise<void> {
  const [outArg, ...clipArgs] = process.argv.slice(2);
  if (!outArg) throw new Error("usage: fx-showcase.ts <out-dir> [clip.mp4@start …]");
  const out = path.resolve(outArg);
  await mkdir(out, { recursive: true });
  const sources: { name: string; file: string; start: number }[] = [];
  {
    const pattern = path.join(out, "testsrc2-1080p.mp4");
    await run(["-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", pattern]);
    sources.push({ name: "testsrc2", file: pattern, start: 0.5 });
  }
  for (const arg of clipArgs) {
    const at = arg.lastIndexOf("@");
    const file = path.resolve(at > 0 ? arg.slice(0, at) : arg);
    sources.push({ name: path.basename(file, path.extname(file)), file, start: at > 0 ? Number(arg.slice(at + 1)) : 0 });
  }
  const only = (process.env.FX_ONLY ?? "").split(",").filter(Boolean) as FxId[];
  const ids = only.length > 0 ? only : [...FX_IDS];
  const fx = createFxRenderer({ ffmpeg, ffprobe, outputDir: () => path.join(out, "renders"), resolveMedia: (p) => p, hwaccel: process.env.ZENVI_FX_HWACCEL !== "0" });
  const timings: Record<string, Record<string, number>> = {};

  for (const src of sources) {
    const info = await probeFxSource(ffprobe, src.file);
    const dir = path.join(out, src.name);
    await mkdir(dir, { recursive: true });
    const before = path.join(dir, "_before.png");
    await row(src.file, before, src.start, SECONDS);
    const reel: string[] = [];
    for (const id of ids) {
      const parsed = parseFxStack([{ effect: id }], SECONDS);
      if (!parsed.ok) throw new Error(parsed.error);
      const r = await fx.render({ path: src.file, start: src.start, end: src.start + SECONDS, effects: parsed.effects });
      (timings[id] ??= {})[src.name] = r.cached ? NaN : r.seconds / SECONDS;
      const after = path.join(dir, `_${id}.png`);
      await row(r.path, after, 0, r.duration);
      const title = path.join(dir, `_${id}-label.png`);
      await label(title, `${FX_INFO[id].title} (${id}, amount ${parsed.effects[0]!.amount}) — top: original, bottom: FX — ${src.name} ${info.width}x${info.height}`, THUMB * STRIP_FRAMES);
      await run(["-i", title, "-i", before, "-i", after, "-filter_complex", "[0][1][2]vstack=inputs=3", path.join(dir, `${id}.png`)]);
      reel.push(r.path);
      process.stdout.write(`${src.name} ${id}: ${r.seconds.toFixed(1)}s\n`);
    }
    // One reel per source: every effect in turn at 1280 wide, H.264 (no audio: slow motion is longer).
    const inputs = reel.flatMap((f) => ["-i", f]);
    const chain = reel.map((_, i) => `[${i}:v]scale=1280:-2,setsar=1,fps=30,format=yuv420p[r${i}]`).join(";");
    const concat = `${reel.map((_, i) => `[r${i}]`).join("")}concat=n=${reel.length}:v=1:a=0[v]`;
    await run([...inputs, "-filter_complex", `${chain};${concat}`, "-map", "[v]", "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", path.join(dir, `${src.name}-fx-reel.mp4`)]);
  }

  const names = sources.map((s) => s.name);
  const lines = [
    "# Zenvi FX render timings",
    "",
    `Render seconds per second of footage (${SECONDS} s ranges, ProRes 422 HQ out, ffmpeg ${(await exec(ffmpeg, ["-version"])).stdout.split(" ")[2]}, ${process.platform} ${process.arch}, VideoToolbox decode ${process.env.ZENVI_FX_HWACCEL === "0" ? "off" : "on"}).`,
    "Lower is faster; 1.0 = real time. optical_flow_slowmo renders 1/speed times more frames.",
    "",
    `| effect | ${names.join(" | ")} |`,
    `| --- | ${names.map(() => "---:").join(" | ")} |`,
    ...ids.map((id) => `| ${id} | ${names.map((n) => (Number.isFinite(timings[id]?.[n]) ? timings[id]![n]!.toFixed(2) : "cached")).join(" | ")} |`),
    "",
  ];
  await writeFile(path.join(out, "timings.md"), lines.join("\n"));
  process.stdout.write(lines.join("\n"));
}

await main();
