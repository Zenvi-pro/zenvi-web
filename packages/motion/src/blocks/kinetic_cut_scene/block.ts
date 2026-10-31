import { FONT_STACKS } from "../../tokens.js";
import { applyFinish, finishBuffers, HIT_LOOKS, hitCamera, hitFinish, shapeMask, shapeParticles, subframeTimes, type HitLookName } from "../../runtime/kinetic.js";
import type { BlockContext } from "../../runtime/index.js";
import { baselines, drawShot, fitSize, groundBloom, layoutBox, type Scene } from "./draw.js";
import { limitHitFlashes, parseShot, scheduleShots, shotCues, shotHits, type Ground, type ShotSpec } from "./shots.js";

/** engine.js `SHUTTER`: sub-frames spread over 0.6 of a frame. */
const SHUTTER = 0.6;
/** Display faces' heaviest bundled weight. */
const WEIGHTS: Record<string, number> = { sans: 900, serif: 400, mono: 800, display: 400 };

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return 0.5;
  const n = Number.parseInt(m[1]!, 16);
  const lin = (c: number): number => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/**
 * A beat-cut sequence drawn on one canvas, every frame a pure function of t:
 * each storyboard line is a shot on the BPM grid, every cut is a hit that
 * punches the camera and fires the flash, aberration and bloom, and each
 * frame averages sub-frames inside its shot. The storyboard's variety (beats,
 * entrances, layouts, grounds, layers) is the agent's: the block only draws it.
 */
export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, palette } = ctx;
  const bpm = Number(p.bpm);
  const look = HIT_LOOKS[(p.look as HitLookName) ?? "punchy"] ?? HIT_LOOKS.punchy;
  const samples = ctx.draft ? 1 : Number(p.shutter_samples);
  const specs: ShotSpec[] = [];
  for (const line of (p.shots as string[]).filter((l) => l.trim())) {
    const spec = parseShot(line);
    if (typeof spec === "string") throw new Error(`shots: ${spec}`);
    specs.push(spec);
  }
  const shots = scheduleShots(specs, bpm, ctx.seconds);
  const s = Math.min(W, H) / 1080;
  const hits = shotHits(shots, bpm, s);
  if (p.allow_strobe !== true) limitHitFlashes(shots, hits, bpm);
  for (const c of shotCues(shots, bpm)) ctx.cue(c.t, c.kind, { weight: c.weight, ...(c.until !== undefined ? { until: c.until } : {}), ...(c.rate !== undefined ? { rate: c.rate } : {}) });
  // The last shot is the hold the piece lands on: no fade.
  ctx.ownExit = true;

  const dark = palette.dark ? palette.paper : palette.ink;
  const light = palette.dark ? palette.ink : palette.paper;
  const colors: Record<Ground, string> = { dark, light, accent: palette.accent, secondary: palette.secondary };
  // The ink with the higher WCAG contrast ratio on that ground.
  const contrast = (a: string, c: string): number => (Math.max(luminance(a), luminance(c)) + 0.05) / (Math.min(luminance(a), luminance(c)) + 0.05);
  const on = (bg: string): string => (contrast(bg, dark) >= contrast(bg, light) ? dark : light);
  const scene: Scene = {
    W,
    H,
    s,
    portrait: ctx.portrait,
    font: FONT_STACKS[ctx.display],
    weight: WEIGHTS[ctx.display] ?? 900,
    mono: FONT_STACKS.mono,
    colors,
    inks: { dark: light, light: dark, accent: on(palette.accent), secondary: on(palette.secondary) },
    accent: palette.accent,
    bpm,
    seed: ctx.seed,
    particles: new Map(),
  };
  for (const shot of shots) {
    if (shot.entrance !== "assemble") continue;
    const box = layoutBox(scene, shot);
    const R = Math.min(box.maxW, W) / 2;
    // The text as a mask in the assembly's [-1, 1] box (half-size R about the text centre).
    const mask = shapeMask(ctx.doc, (g, side) => {
      const k = side / (2 * R);
      const size = fitSize(g, scene, shot.lines, box.maxW, box.maxSize, box.maxH);
      g.font = `${scene.weight} ${(size * k).toFixed(1)}px ${scene.font}`;
      g.textAlign = "center";
      g.textBaseline = "alphabetic";
      baselines(shot.lines.length, size, box.cy).forEach((y, i) => g.fillText(shot.lines[i]!, side / 2, side / 2 + (y - box.cy) * k));
    });
    if (mask) scene.particles.set(shot.index, shapeParticles(mask, 180, Math.round(900 * Math.max(0.6, s)), ctx.seed * 31 + shot.index));
  }

  const canvas = ctx.el("canvas", "kc-canvas");
  Object.assign(canvas.style, { position: "absolute", left: "0", top: "0", width: `${W}px`, height: `${H}px` });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = Math.round(W * dpr);
  const chh = Math.round(H * dpr);
  canvas.width = cw;
  canvas.height = chh;
  const mk = (): HTMLCanvasElement => Object.assign(ctx.doc.createElement("canvas"), { width: cw, height: chh });
  const sub = mk();
  const acc = mk();
  const out = canvas.getContext("2d", { alpha: false });
  const sg = sub.getContext("2d", { alpha: false });
  const ag = acc.getContext("2d", { alpha: false });
  if (!out || !sg || !ag) return;
  const buffers = finishBuffers(ctx.doc, cw, chh, look.vignette);

  tl.track((t) => {
    const shot = shots.find((sh) => t >= sh.start && t < sh.end) ?? shots[shots.length - 1];
    if (!shot) return;
    const times = subframeTimes(t, samples, SHUTTER, ctx.fps, shot.start, shot.end);
    times.forEach((ts, k) => {
      const cam = hitCamera(hits, ts, look.punch);
      sg.setTransform(1, 0, 0, 1, 0, 0);
      sg.globalAlpha = 1;
      sg.globalCompositeOperation = "source-over";
      sg.fillStyle = "#000";
      sg.fillRect(0, 0, cw, chh);
      sg.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * ((W / 2) * (1 - cam.zoom) + cam.x), dpr * ((H / 2) * (1 - cam.zoom) + cam.y));
      drawShot(sg, scene, shot, ts - shot.start, t - shot.start);
      ag.globalAlpha = 1 / (k + 1);
      ag.drawImage(sub, 0, 0);
    });
    ag.globalAlpha = 1;
    const f = hitFinish(hits, t, look, groundBloom(shot.ground));
    applyFinish(out, acc, buffers, { ...f, lightGround: shot.ground === "light" });
  });
}
