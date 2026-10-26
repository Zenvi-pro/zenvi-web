/**
 * Motion transitions showcase: every preset (and each direction) on a cut
 * between two generated clips, labelled, rendered by render-node (the same
 * planner the desktop matches), plus a contact sheet of each transition's
 * frames.
 *
 *   npx tsx packages/render-node/scripts/motion-transitions-showcase.ts [out-dir]
 *
 * Writes <out-dir>/showcase.mp4, <out-dir>/frames.png and the project
 * (<out-dir>/showcase.zvn) with its generated media. All pictures come from
 * ffmpeg's lavfi sources (no third-party media).
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ProjectDocument, addClip, createProject, findProfile } from "@zenvi/engine";
import { runTool, type ToolResult } from "@zenvi/engine/tools";
import { createNodeHost, renderProject } from "@zenvi/render-node";

const out = path.resolve(process.argv[2] ?? "showcase-motion-transitions");
const mediaDir = path.join(out, "media");
mkdirSync(mediaDir, { recursive: true });

const W = 1280;
const H = 720;
const FPS = 30;
/** Seconds of each shot either side of a cut, and the black gap between demos. */
const SHOT = 1.2;
const GAP = 0.3;

function ffmpeg(args: string[]): void {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}`);
}

/** Moving, colourful, full-frame generated shots (lavfi), each different. */
const SOURCES: [string, string][] = [
  ["testsrc2", `testsrc2=s=${W}x${H}:r=${FPS}`],
  ["mandelbrot", `mandelbrot=s=${W}x${H}:r=${FPS}:start_scale=2:end_scale=0.6,hue=h=t*40`],
  ["gradients", `gradients=s=${W}x${H}:r=${FPS}:speed=0.03:n=5:seed=7`],
  ["life", `life=s=${W / 4}x${H / 4}:r=${FPS}:mold=10:ratio=0.2:life_color=#ffcc33:death_color=#2040a0,scale=${W}:${H}:flags=neighbor`],
  ["bars", `smptehdbars=s=${W}x${H}:r=${FPS},hue=H=t*2`],
  ["cells", `cellauto=s=${W / 4}x${H / 4}:r=${FPS}:rule=110,scale=${W}:${H}:flags=neighbor,lutrgb=r=val*0.4+120:g=val*0.2+40:b=200`],
];

const DEMOS: { preset: string; direction?: string; label: string }[] = [
  { preset: "whip", direction: "left", label: "whip · left" },
  { preset: "whip", direction: "right", label: "whip · right" },
  { preset: "whip", direction: "up", label: "whip · up" },
  { preset: "whip", direction: "down", label: "whip · down" },
  { preset: "slide", direction: "left", label: "slide / push" },
  { preset: "zoom_in", label: "zoom punch in" },
  { preset: "zoom_out", label: "zoom punch out" },
  { preset: "zoom_through", label: "zoom through" },
  { preset: "spin", direction: "cw", label: "spin · cw" },
  { preset: "spin", direction: "ccw", label: "spin · ccw" },
  { preset: "squash", direction: "up", label: "squash & stretch" },
  { preset: "shake", label: "shake cut" },
  { preset: "glitch", label: "glitch cut" },
  { preset: "flash_white", label: "white flash" },
  { preset: "flash_black", label: "black flash" },
  { preset: "flash_invert", label: "invert flash" },
  { preset: "blur_dissolve", label: "blur dissolve" },
];

function check(result: ToolResult, what: string): void {
  if (!result.ok) throw new Error(`${what}: ${result.text}`);
}

async function main(): Promise<void> {
  const files = SOURCES.map(([name, src]) => {
    const file = path.join(mediaDir, `${name}.mp4`);
    ffmpeg(["-f", "lavfi", "-i", `${src},format=yuv420p`, "-t", "8", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", file]);
    return file;
  });

  const projectFile = path.join(out, "showcase.zvn");
  const profile = findProfile("HD 720p 30 fps");
  const doc = new ProjectDocument(createProject(profile ? { profile } : {}));
  const host = createNodeHost({ projectFile });
  const ctx = { doc, host };
  check(await runTool(ctx, "import_files_tool", { paths: JSON.stringify(files), skip_indexing: "true" }), "import");
  const fileIds = files.map((f) => doc.project.files.find((x) => x.path === f)!.id);

  const cuts: { label: string; cut: number }[] = [];
  let t = 0;
  for (const [i, demo] of DEMOS.entries()) {
    const a = fileIds[i % fileIds.length]!;
    const b = fileIds[(i + 1) % fileIds.length]!;
    const ids = doc.transaction(`demo ${demo.label}`, (tx) => [
      addClip(tx, { fileId: a, position: t, layer: 1, start: 1, end: 1 + SHOT }).id,
      addClip(tx, { fileId: b, position: t + SHOT, layer: 1, start: 3, end: 3 + SHOT }).id,
    ]);
    const args: Record<string, unknown> = { preset: demo.preset, clip1_id: ids[0], clip2_id: ids[1] };
    if (demo.direction) args.direction = demo.direction;
    if (demo.preset === "zoom_through") Object.assign(args, { focus_x: "0.7", focus_y: "0.35" });
    check(await runTool(ctx, "apply_motion_transition_tool", args), demo.label);
    check(
      await runTool(ctx, "add_title_tool", { text: demo.label, position_seconds: String(t), duration_seconds: String(2 * SHOT), template: "Standard_1", screen_position: "bottom", font_scale: "0.8", text_color: "#ffffff", track: "2" }),
      `label ${demo.label}`,
    );
    cuts.push({ label: demo.label, cut: t + SHOT });
    t += 2 * SHOT + GAP;
  }
  writeFileSync(projectFile, JSON.stringify(doc.toJSON()));

  const video = path.join(out, "showcase.mp4");
  await renderProject(doc.project, {
    resolveMedia: (p) => p,
    output: video,
    options: { format: "mp4", width: W, height: H, fps: { num: FPS, den: 1 }, crf: 18, range: { start: 0, end: t - GAP } },
    onProgress: (p) => process.stdout.write(`\rrendering ${Math.round(p.fraction * 100)}%`),
  });
  process.stdout.write("\n");

  // Contact sheet: one row per demo, frames cut-4 … cut+5 (the cut lands between the 4th and 5th frame).
  const select = cuts.map(({ cut }) => `between(n\\,${Math.round(cut * FPS) - 4}\\,${Math.round(cut * FPS) + 5})`).join("+");
  ffmpeg(["-i", video, "-vf", `select='${select}',scale=256:-2,tile=10x${cuts.length}:padding=4:margin=4:color=0x202020`, "-frames:v", "1", "-fps_mode", "vfr", path.join(out, "frames.png")]);
  writeFileSync(path.join(out, "cuts.json"), JSON.stringify(cuts, null, 1));
  console.log(`wrote ${video}\nwrote ${path.join(out, "frames.png")}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
