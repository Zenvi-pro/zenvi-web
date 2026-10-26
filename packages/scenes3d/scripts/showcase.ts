/**
 * Render every Zenvi 3D scene for people to look at: each scene in 9:16 and
 * 16:9 on a dark and a light backdrop, a contact sheet and a timings table.
 * The footage on screens, cards and cubes is generated here with ffmpeg
 * (gradients, test patterns, fractals), so everything is original.
 *
 *   npx tsx packages/scenes3d/scripts/showcase.ts --out ~/zenvi-motion/fleet/artifacts/w3-blender
 *   options: --quality draft|final (default final) --scenes title_3d,cube_cut --aspects 9:16,16:9 --backgrounds dark,light
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { SCENE3D_IDS, SCENE3D_INFO, parseScene3dParams, type Scene3dId, type Scene3dMediaInput, type Scene3dQuality } from "@zenvi/engine";
import { createScene3dRenderer, findBlender } from "../src/index.js";

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    quality: { type: "string", default: "final" },
    scenes: { type: "string", default: SCENE3D_IDS.join(",") },
    aspects: { type: "string", default: "9:16,16:9" },
    backgrounds: { type: "string", default: "dark,light" },
  },
});
if (!values.out) throw new Error("--out <folder> is required");
const out = path.resolve(values.out);
const quality = values.quality as Scene3dQuality;
const blender = findBlender();
if (!blender) throw new Error("Blender not found (set ZENVI_BLENDER)");

const mediaDir = path.join(out, "media");
await mkdir(mediaDir, { recursive: true });

/** Generated footage: name → ffmpeg lavfi source, size, seconds (0: one still). */
const SOURCES: Record<string, { lavfi: string; width: number; height: number; seconds: number }> = {
  tall: { lavfi: "gradients=s=1080x1920:r=30:c0=0xff5a36:c1=0x7b5cff:c2=0x00c2ff:n=3:speed=0.03:type=radial", width: 1080, height: 1920, seconds: 8 },
  wide: { lavfi: "gradients=s=1920x1080:r=30:c0=0x2f6bff:c1=0xffd166:c2=0xff5a36:n=3:speed=0.025", width: 1920, height: 1080, seconds: 8 },
  pattern: { lavfi: "testsrc2=s=1280x720:r=30", width: 1280, height: 720, seconds: 8 },
  fractal: { lavfi: "mandelbrot=s=1080x1080:r=30:end_scale=0.02", width: 1080, height: 1080, seconds: 8 },
  life: { lavfi: "life=s=270x480:r=30:mold=10:ratio=0.1:death_color=#1b1f3a:life_color=#00c2ff,scale=1080:1920:flags=neighbor", width: 1080, height: 1920, seconds: 8 },
};
const STILLS = ["#FF5A36", "#2F6BFF", "#FFD166", "#06D6A0", "#B388FF", "#FF7AB6"];

function ffmpeg(args: string[]): void {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

const media = new Map<string, Scene3dMediaInput>();
for (const [name, s] of Object.entries(SOURCES)) {
  const file = path.join(mediaDir, `${name}.mp4`);
  if (!existsSync(file)) ffmpeg(["-f", "lavfi", "-i", s.lavfi, "-t", String(s.seconds), "-c:v", "libx264", "-pix_fmt", "yuv420p", file]);
  media.set(name, { fileId: name, path: file, kind: "video", width: s.width, height: s.height, fps: 30, frames: s.seconds * 30, start: 0 });
}
for (const [i, color] of STILLS.entries()) {
  // An icon-like still: a white ring and dot on a colour (PNG).
  const file = path.join(mediaDir, `icon${i}.png`);
  const hex = color.slice(1);
  if (!existsSync(file)) {
    ffmpeg(["-f", "lavfi", "-i", `color=c=0x${hex}:s=512x512`, "-vf", `geq=r='if(between(hypot(X-256,Y-256),110,150)+lt(hypot(X-256,Y-256),48),255,r(X,Y))':g='if(between(hypot(X-256,Y-256),110,150)+lt(hypot(X-256,Y-256),48),255,g(X,Y))':b='if(between(hypot(X-256,Y-256),110,150)+lt(hypot(X-256,Y-256),48),255,b(X,Y))'`, "-frames:v", "1", file]);
  }
  media.set(`icon${i}`, { fileId: `icon${i}`, path: file, kind: "image", width: 512, height: 512, fps: 0, frames: 0, start: 0 });
}

/** Per scene: showcase params and media slots. */
function setup(scene: Scene3dId, background: string, vertical: boolean): { params: Record<string, unknown>; slots: Record<string, string> } {
  switch (scene) {
    case "title_3d":
      return { params: { text: vertical ? "ZENVI" : "ZENVI 3D", style: background === "dark" ? "chrome" : "iridescent", background }, slots: {} };
    case "device_mockup":
      return vertical ? { params: { device: "phone", move: "hero", file_id: "tall", background }, slots: { screen: "tall" } } : { params: { device: "laptop", move: "orbit", file_id: "wide", background }, slots: { screen: "wide" } };
    case "floating_cards":
      return { params: { file_ids: ["wide", "icon1", "life", "fractal", "icon3", "pattern"], background }, slots: { card0: "wide", card1: "icon1", card2: "life", card3: "fractal", card4: "icon3", card5: "pattern" } };
    case "icon_cube":
      return { params: { file_ids: ["icon0", "icon1", "icon2", "icon3", "icon4", "icon5"], background }, slots: Object.fromEntries(STILLS.map((_, i) => [`face${i}`, `icon${i}`])) };
    case "cube_cut":
      return { params: { from_clip_id: "a", to_clip_id: "b", direction: vertical ? "up" : "left", background }, slots: { from: vertical ? "life" : "pattern", to: vertical ? "tall" : "wide" } };
    case "glass_hero":
      return { params: { shape: vertical ? "blob" : "rings", material: "glass", background }, slots: {} };
    case "particle_burst":
      return { params: { kind: background === "dark" ? "sparks" : "confetti", background, origin_y: 0.55 }, slots: {} };
  }
}

const renderer = createScene3dRenderer({ blender, cacheDir: path.join(out, ".cache"), resolveMedia: (p) => p, log: (m) => console.log(m) });
const timings: string[] = [];
const sheet: string[] = [];
for (const scene of values.scenes!.split(",") as Scene3dId[]) {
  for (const aspect of values.aspects!.split(",")) {
    const vertical = aspect === "9:16";
    const [width, height] = vertical ? [1080, 1920] : aspect === "1:1" ? [1080, 1080] : [1920, 1080];
    for (const background of values.backgrounds!.split(",")) {
      const { params, slots } = setup(scene, background, vertical);
      const parsed = parseScene3dParams(scene, params);
      if (!parsed.ok) throw new Error(parsed.error);
      const seconds = SCENE3D_INFO[scene].defaultSeconds;
      const requestMedia = Object.fromEntries(Object.entries(slots).map(([slot, name]) => [slot, { ...media.get(name)!, start: scene === "cube_cut" && slot === "from" ? 2 : 0 }]));
      const started = Date.now();
      const r = await renderer.render({ scene, params: parsed.params, width, height, fps: { num: 30, den: 1 }, frames: Math.round(seconds * 30), quality, media: requestMedia });
      const took = (Date.now() - started) / 1000;
      const name = `${scene}_${vertical ? "9x16" : aspect.replace(":", "x")}_${background}${quality === "draft" ? "_draft" : ""}.mp4`;
      await copyFile(r.path, path.join(out, name));
      timings.push(`| ${scene} | ${aspect} | ${background} | ${quality} | ${r.width}x${r.height} | ${r.frames} | ${r.cached ? "cached" : took.toFixed(1)} |`);
      console.log(`${name}: ${took.toFixed(1)}s`);
      if (vertical && background === "dark") sheet.push(path.join(out, name));
    }
  }
}
renderer.close();

await writeFile(path.join(out, `timings-${quality}.md`), ["| scene | aspect | background | quality | size | frames | seconds |", "| --- | --- | --- | --- | --- | --- | --- |", ...timings, ""].join("\n"));
if (sheet.length > 0) {
  // Contact sheet: three moments (25 %, 55 %, 90 %) of each 9:16 dark render, one row per scene.
  const rows: string[] = [];
  for (const [i, file] of sheet.entries()) {
    const row = path.join(out, `.row${i}.png`);
    const frames = Number(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", file], { encoding: "utf8" }).trim());
    const picks = [0.25, 0.55, 0.9].map((f) => Math.min(frames - 1, Math.round(f * frames)));
    ffmpeg(["-i", file, "-vf", `select='${picks.map((n) => `eq(n\\,${n})`).join("+")}',scale=-2:480,tile=3x1`, "-frames:v", "1", "-fps_mode", "passthrough", row]);
    rows.push(row);
  }
  const contact = path.join(out, quality === "draft" ? "contact-draft.png" : "contact.png");
  if (rows.length === 1) await copyFile(rows[0]!, contact);
  else ffmpeg([...rows.flatMap((r) => ["-i", r]), "-filter_complex", `${rows.map((_, i) => `[${i}]`).join("")}vstack=inputs=${rows.length}`, contact]);
}
