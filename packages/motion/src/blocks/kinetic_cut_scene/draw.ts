/**
 * Drawing a kinetic_cut_scene shot at u seconds into it: the ground, the
 * motif layers, the text entrance, the sub line and the second-half event
 * (an accent rule drawing on), inside a slow drift so nothing ever stops.
 * Canvas 2D in design px; every function reads only its arguments.
 *
 * Entrances and layers are ports of Tweenkit's kinetic-cut-video parts (MIT,
 * © 2026 wmzspace: engine.js `cjk`/`word` letter transforms, `st`, `FX.echo`,
 * `FX.speedLines`, `FX.shock`, `FX.tunnel`, `FX.marquee`, `FX.isoBars`,
 * `FX.orbits`, `FX.dial`, `FX.assemble`, `blobs`, and the oscilloscope and
 * auto-routing examples of references/motif-method.md). FX.star is not
 * ported: it resembles a brand mark.
 */

import {
  assembleAt,
  clamp01,
  cubicIn,
  cubicInOut,
  cubicOut,
  drawOn,
  expoOut,
  noise1,
  prog,
  springIn,
  stagger,
  stamp,
  type Pt,
  type ShapeParticle,
} from "../../runtime/kinetic.js";
import { mulberry32 } from "../../runtime/rng.js";
import { strobeStep, typingSeconds, type Ground, type Shot } from "./shots.js";

export interface Scene {
  W: number;
  H: number;
  /** Design px per 1080. */
  s: number;
  portrait: boolean;
  font: string;
  weight: number;
  mono: string;
  colors: Record<Ground, string>;
  /** Text colour on each ground. */
  inks: Record<Ground, string>;
  accent: string;
  bpm: number;
  seed: number;
  /** Assembly particles per shot index (sampled from the shot's text). */
  particles: Map<number, ShapeParticle[]>;
}

const TAU = Math.PI * 2;

/** Bloom per ground (engine.js advice: dark 0.5-0.6, accent 0.12-0.14, light 0.07-0.1). */
export function groundBloom(ground: Ground): number {
  return ground === "dark" ? 0.5 : ground === "light" ? 0.08 : 0.13;
}

interface Box {
  cx: number;
  cy: number;
  maxW: number;
  maxSize: number;
  /** Tallest the lines may stand together (bleed crops sideways, never off the top). */
  maxH: number;
  align: CanvasTextAlign;
  rot: number;
  /** Where the motif layers centre, and their reach. */
  rx: number;
  ry: number;
  rr: number;
}

/** Where type and picture go for a layout; portrait turns left/right into top/bottom. */
export function layoutBox(sc: Scene, shot: Shot): Box {
  const { W, H } = sc;
  const m = Math.min(W, H);
  const base: Box = { cx: W / 2, cy: H / 2, maxW: W * 0.84, maxSize: m * 0.36, maxH: H * 0.62, align: "center", rot: 0, rx: W / 2, ry: H / 2, rr: m * 0.42 };
  let layout = shot.layout;
  if (sc.portrait && layout === "left") layout = "top";
  if (sc.portrait && layout === "right") layout = "bottom";
  switch (layout) {
    case "left":
      return { ...base, cx: W * 0.3, maxW: W * 0.46, rx: W * 0.73, rr: m * 0.34 };
    case "right":
      return { ...base, cx: W * 0.7, maxW: W * 0.46, rx: W * 0.27, rr: m * 0.34 };
    case "top":
      return { ...base, cy: H * 0.3, maxSize: m * 0.3, ry: H * 0.7, rr: m * 0.3 };
    case "bottom":
      return { ...base, cy: H * 0.72, maxSize: m * 0.3, ry: H * 0.32, rr: m * 0.3 };
    case "bleed":
      return { ...base, maxW: W * 1.32, maxSize: m * 0.82, maxH: H * 0.86 };
    case "diagonal":
      return { ...base, maxW: Math.hypot(W, H) * 0.62, rot: -0.21 };
    case "space":
      return { ...base, cx: W * 0.1, cy: H * 0.82, maxW: W * 0.5, maxSize: m * 0.075, align: "left", rx: W * 0.66, ry: H * 0.4, rr: m * 0.2 };
    default:
      return base;
  }
}

const fontOf = (sc: Scene, size: number): string => `${sc.weight} ${size.toFixed(1)}px ${sc.font}`;

/** The largest size ≤ maxSize at which every line fits maxW. */
export function fitSize(g: CanvasRenderingContext2D, sc: Scene, lines: readonly string[], maxW: number, maxSize: number, maxH = Infinity): number {
  g.font = fontOf(sc, 100);
  const widest = Math.max(1, ...lines.map((l) => g.measureText(l).width));
  const byLines = maxSize * (lines.length > 1 ? 1.6 / (lines.length + 0.6) : 1);
  return Math.max(8, Math.min(byLines, maxH / (lines.length * 0.98), (maxW / widest) * 100));
}

interface Glyph {
  ch: string;
  x: number;
  w: number;
}

/** Letters of a line with their x from the line's anchor (alignment applied). */
function glyphs(g: CanvasRenderingContext2D, line: string, align: CanvasTextAlign): { gl: Glyph[]; w: number } {
  const gl: Glyph[] = [];
  let x = 0;
  for (const ch of line) {
    const w = g.measureText(ch).width;
    gl.push({ ch, x, w });
    x += w;
  }
  const off = align === "left" ? 0 : align === "right" ? -x : -x / 2;
  for (const q of gl) q.x += off;
  return { gl, w: x };
}

interface Letter {
  s?: number;
  sx?: number;
  sy?: number;
  dx?: number;
  dy?: number;
  rot?: number;
  al?: number;
  color?: string;
}

/** Draw a line letter by letter, each transformed about its baseline centre. */
function letters(g: CanvasRenderingContext2D, line: string, x: number, base: number, align: CanvasTextAlign, color: string, fn: (j: number, n: number) => Letter, stroke = 0): void {
  const { gl } = glyphs(g, line, align);
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  gl.forEach((q, j) => {
    const o = fn(j, gl.length);
    if (o.al !== undefined && o.al <= 0.003) return;
    g.save();
    g.translate(x + q.x + q.w / 2 + (o.dx ?? 0), base + (o.dy ?? 0));
    if (o.rot) g.rotate(o.rot);
    const s = o.s ?? 1;
    g.scale(Math.max(0.001, (o.sx ?? 1) * s), Math.max(0.001, (o.sy ?? 1) * s));
    g.globalAlpha *= o.al ?? 1;
    if (stroke > 0) {
      g.strokeStyle = o.color ?? color;
      g.lineWidth = stroke;
      g.lineJoin = "round";
      g.strokeText(q.ch, 0, 0);
    } else {
      g.fillStyle = o.color ?? color;
      g.fillText(q.ch, 0, 0);
    }
    g.restore();
  });
}

/** Baselines of `n` lines of `size` centred on cy (cap height ≈ 0.72 em). */
export function baselines(n: number, size: number, cy: number): number[] {
  const lh = size * 0.98;
  const top = cy - ((n - 1) * lh) / 2 + size * 0.36;
  return Array.from({ length: n }, (_, i) => top + i * lh);
}

function fill(g: CanvasRenderingContext2D, sc: Scene, color: string): void {
  g.fillStyle = color;
  // Bleed past the frame: the punch and the shake must never show an edge.
  g.fillRect(-sc.W * 0.25, -sc.H * 0.25, sc.W * 1.5, sc.H * 1.5);
}

/** The ground a shot shows at u: strobe flips its ground with the words, at most 3 flips a second (WCAG 2.3.1). */
function groundAt(sc: Scene, shot: Shot, u: number): Ground {
  if (shot.entrance !== "strobe") return shot.ground;
  const step = strobeStep(shot, sc.bpm);
  if (step < 1 / 3) return shot.ground;
  const order: Ground[] = shot.ground === "light" ? ["light", "dark", "accent"] : shot.ground === "accent" ? ["accent", "dark", "light"] : ["dark", "light", "accent"];
  return order[Math.floor(u / step) % order.length]!;
}

/** Everything of one shot at u s into it, in design px. */
/** `uf` is the frame's own time in the shot: discrete things (digits, words, typed letters) step with it, not with the sub-frames, so they never ghost. */
export function drawShot(g: CanvasRenderingContext2D, sc: Scene, shot: Shot, u: number, uf = u): void {
  const len = shot.end - shot.start;
  const ground = groundAt(sc, shot, uf);
  const box = layoutBox(sc, shot);
  const ink = sc.inks[ground];
  fill(g, sc, sc.colors[ground]);
  g.save();
  // The second layer of motion: a slow drift, alternating direction shot to shot.
  const dir = shot.index % 2 === 0 ? 1 : -1;
  const creep = 1 + 0.08 * (u / Math.max(0.5, len));
  g.translate(sc.W / 2 + dir * 36 * sc.s * (u / Math.max(0.5, len)), sc.H / 2);
  g.rotate(dir * 0.006 * u);
  g.scale(creep, creep);
  g.translate(-sc.W / 2, -sc.H / 2);
  if (shot.layers.includes("collapse")) {
    // The last 0.3 s squash the frame into a line; the next cut bursts out of it.
    const q = cubicIn(prog(u, len - 0.3, 0.28));
    if (q > 0) {
      g.translate(sc.W / 2, sc.H / 2);
      g.scale(1 - q * 0.15, Math.max(0.004, 1 - q));
      g.translate(-sc.W / 2, -sc.H / 2);
    }
  }
  if (shot.layout === "split") drawSplit(g, sc, shot, u, uf, ground);
  for (const layer of shot.layers) drawLayer(g, sc, shot, u, layer, box, ground);
  if (shot.layout !== "split") drawSub(g, sc, shot, u, box, ink, drawText(g, sc, shot, u, uf, box, ink, ground));
  g.restore();
  if (shot.layers.includes("collapse")) {
    const q = cubicIn(prog(u, len - 0.3, 0.28));
    if (q > 0.6) {
      g.fillStyle = sc.inks[ground];
      g.globalAlpha = (q - 0.6) / 0.4;
      g.fillRect(-sc.W * 0.2, sc.H / 2 - 2 * sc.s, sc.W * 1.4, 4 * sc.s);
      g.globalAlpha = 1;
    }
  }
}

/** Two grounds side by side (top and bottom in portrait), the text crossing them inverted on each side. */
function drawSplit(g: CanvasRenderingContext2D, sc: Scene, shot: Shot, u: number, uf: number, ground: Ground): void {
  const other: Ground = ground === "light" ? "dark" : "light";
  const open = expoOut(prog(u, 0, 0.35));
  const box = layoutBox(sc, { ...shot, layout: "center" });
  g.save();
  g.beginPath();
  if (sc.portrait) g.rect(-sc.W, sc.H / 2 + (1 - open) * sc.H, sc.W * 3, sc.H * 2);
  else g.rect(sc.W / 2 + (1 - open) * sc.W, -sc.H, sc.W * 2, sc.H * 3);
  g.clip();
  fill(g, sc, sc.colors[other]);
  g.restore();
  for (const [side, inkOf] of [[0, ground], [1, other]] as const) {
    g.save();
    g.beginPath();
    if (sc.portrait) g.rect(-sc.W, side === 0 ? -sc.H : sc.H / 2 + (1 - open) * sc.H, sc.W * 3, side === 0 ? sc.H * 1.5 + (1 - open) * sc.H : sc.H * 2);
    else g.rect(side === 0 ? -sc.W : sc.W / 2 + (1 - open) * sc.W, -sc.H, side === 0 ? sc.W * 1.5 + (1 - open) * sc.W : sc.W * 2, sc.H * 3);
    g.clip();
    drawSub(g, sc, shot, u, box, sc.inks[inkOf], drawText(g, sc, shot, u, uf, box, sc.inks[inkOf], inkOf));
    g.restore();
  }
}

/** Draws the type; returns its top and bottom (design px, before the layout's rotation) for the sub line. */
function drawText(g: CanvasRenderingContext2D, sc: Scene, shot: Shot, u: number, uf: number, box: Box, ink: string, ground: Ground): { top: number; bottom: number } {
  if (shot.entrance === "none" || shot.lines.length === 0) return { top: box.cy, bottom: box.cy };
  const len = shot.end - shot.start;
  g.save();
  g.translate(box.cx, box.cy);
  if (box.rot) g.rotate(box.rot);
  g.translate(-box.cx, -box.cy);
  const lines = shot.entrance === "strobe" ? [strobeWord(sc, shot, uf)] : shot.entrance === "count" ? [countText(shot.lines.join(" "), uf, len)] : shot.lines;
  // Counters are sized for their final value so the number does not grow while it counts.
  const sizing = shot.entrance === "count" ? [shot.lines.join(" ")] : lines;
  const size = fitSize(g, sc, sizing, box.maxW, box.maxSize, box.maxH);
  g.font = fontOf(sc, size);
  const bases = baselines(lines.length, size, box.cy);
  const lineAt = (i: number): number => bases[i]!;
  const accent = ground === "accent" ? ink : sc.accent;
  switch (shot.entrance) {
    case "slam": {
      // Letters stamp in from 2.1x with a hard stop, 50 ms apart; outline echoes ring out of the landing.
      const echo = 1 - expoOut(prog(u, 0.05, 0.55));
      lines.forEach((line, i) => {
        const off = i * 0.12;
        if (echo > 0.01)
          for (let k = 1; k <= 3; k += 1) {
            g.save();
            g.globalAlpha = echo * (0.5 - k * 0.12);
            g.translate(box.cx, lineAt(i) - size * 0.36);
            const e = 1 + k * 0.09 * (1 - echo * 0.5);
            g.scale(e, e);
            g.translate(-box.cx, -(lineAt(i) - size * 0.36));
            letters(g, line, box.cx, lineAt(i), box.align, accent, () => ({}), Math.max(2, size * 0.012));
            g.restore();
          }
        letters(g, line, box.cx, lineAt(i), box.align, ink, (j) => ({ s: stamp(u - off - j * 0.05, 0.3, 1.1), al: u >= off + j * 0.05 ? 1 : 0 }));
      });
      break;
    }
    case "type": {
      const dur = typingSeconds(shot);
      const total = lines.reduce((n, l) => n + [...l].length, 0);
      let left = Math.floor(clamp01((uf - 0.05) / dur) * total + 0.01);
      let caret: [number, number] | null = null;
      lines.forEach((line, i) => {
        const chars = [...line];
        const shown = chars.slice(0, Math.max(0, Math.min(chars.length, left))).join("");
        left -= chars.length;
        if (!shown && caret) return;
        const { w } = glyphs(g, line, box.align);
        const x0 = box.align === "left" ? box.cx : box.align === "right" ? box.cx - w : box.cx - w / 2;
        g.textAlign = "left";
        g.fillStyle = ink;
        g.fillText(shown, x0, lineAt(i));
        caret = [x0 + g.measureText(shown).width, lineAt(i)];
      });
      // A block caret, solid while typing, blinking at 2 Hz after.
      const c = caret as [number, number] | null;
      if (c && (uf < 0.05 + dur || Math.floor(uf * 4) % 2 === 0)) {
        g.fillStyle = accent;
        g.fillRect(c[0] + size * 0.05, c[1] - size * 0.74, size * 0.09, size * 0.86);
      }
      break;
    }
    case "assemble": {
      const pts = sc.particles.get(shot.index) ?? [];
      const solid = cubicOut(prog(u, 1.0, 0.35));
      const R = Math.min(box.maxW, sc.W) / 2;
      g.fillStyle = ink;
      for (const p of pts) {
        const at = assembleAt(p, u, R, 0);
        g.globalAlpha = (1 - solid * 0.75) * (at.settled > 0 ? 0.9 : 0);
        g.fillStyle = p.pick < 0.22 ? accent : ink;
        const px = at.size * 1.6 * sc.s;
        g.fillRect(box.cx + at.x - px / 2, box.cy + at.y - px / 2, px, px);
      }
      g.globalAlpha = solid;
      lines.forEach((line, i) => letters(g, line, box.cx, lineAt(i), box.align, ink, () => ({})));
      g.globalAlpha = 1;
      break;
    }
    case "mask": {
      // A bar of the accent sweeps across; the type is left behind it, rising inside the mask.
      const e = expoOut(prog(u, 0.04, 0.5));
      const widest = Math.max(...lines.map((l) => glyphs(g, l, box.align).w));
      const x0 = box.align === "left" ? box.cx : box.align === "right" ? box.cx - widest : box.cx - widest / 2;
      const top = lineAt(0) - size * 0.9;
      const h = lineAt(lines.length - 1) - top + size * 0.25;
      g.save();
      g.beginPath();
      g.rect(x0 - size * 0.1, top, (widest + size * 0.2) * e, h);
      g.clip();
      lines.forEach((line, i) => letters(g, line, box.cx, lineAt(i), box.align, ink, () => ({ dy: (1 - e) * size * 0.4 })));
      g.restore();
      const bar = 1 - cubicIn(prog(u, 0.4, 0.3));
      if (bar > 0) {
        g.fillStyle = accent;
        g.fillRect(x0 - size * 0.1 + (widest + size * 0.2) * e - size * 0.12, top, size * 0.12 * bar, h);
      }
      break;
    }
    case "flip":
      lines.forEach((line, i) =>
        letters(g, line, box.cx, lineAt(i), box.align, ink, (j) => {
          const e = stagger(u - i * 0.1, j, 0.035, 0.5, (x) => springIn(x, 6, 10));
          return { sy: e, dy: -(1 - e) * size * 0.35, al: e > 0 ? 1 : 0 };
        }),
      );
      break;
    case "stretch": {
      // Flung in from the side, stretched and sheared, snapping to rest; speed lines while it travels.
      const e = expoOut(prog(u, 0, 0.42));
      const d = shot.index % 2 === 0 ? 1 : -1;
      if (e < 0.98) speedLines(g, sc, u, 1 - e, ink, d);
      lines.forEach((line, i) => {
        g.save();
        g.translate(box.cx + d * (1 - e) * sc.W * 0.7, lineAt(i));
        g.transform(1, 0, -0.55 * (1 - e) * d, 1, 0, 0);
        g.scale(1 + 1.6 * (1 - e), 1 - 0.25 * (1 - e));
        g.translate(-box.cx, -lineAt(i));
        letters(g, line, box.cx, lineAt(i), box.align, ink, () => ({}));
        g.restore();
      });
      break;
    }
    case "drop":
      lines.forEach((line, i) =>
        letters(g, line, box.cx, lineAt(i), box.align, ink, (j) => {
          const e = stagger(u - i * 0.12, j, 0.045, 0.55, (x) => springIn(x, 5, 9));
          return { dy: -(1 - e) * sc.H * 0.6, rot: (1 - e) * (j % 2 ? 0.4 : -0.4), al: e > 0 ? 1 : 0 };
        }),
      );
      break;
    case "count":
    case "strobe":
      lines.forEach((line, i) => letters(g, line, box.cx, lineAt(i), box.align, ink, () => ({ s: shot.entrance === "strobe" ? 1.28 - 0.28 * expoOut(prog(u % strobeStep(shot, sc.bpm), 0, 0.18)) : stamp(u, 0.3, 0.25) })));
      break;
    default:
      break;
  }
  // The second-half event: an accent rule draws on under the type.
  if (len >= 0.9 && shot.layout !== "space" && shot.layout !== "bleed" && shot.entrance !== "strobe") {
    const p = cubicInOut(prog(u, len * 0.55, Math.min(0.45, len * 0.3)));
    if (p > 0) {
      const widest = Math.min(box.maxW, Math.max(...lines.map((l) => glyphs(g, l, box.align).w)));
      const x0 = box.align === "left" ? box.cx : box.align === "right" ? box.cx - widest : box.cx - widest / 2;
      const y = lineAt(lines.length - 1) + size * 0.16;
      drawOn(g, [[x0, y], [x0 + widest * 0.32, y]], p, accent, Math.max(4, size * 0.035));
    }
  }
  g.restore();
  return { top: lineAt(0) - size * 0.88, bottom: lineAt(lines.length - 1) + size * 0.2 };
}

function strobeWord(sc: Scene, shot: Shot, u: number): string {
  const words = shot.lines.join(" ").split(/\s+/).filter(Boolean);
  return words[Math.min(words.length - 1, Math.floor(u / strobeStep(shot, sc.bpm)))] ?? "";
}

/** "2.4M users" counted up: the first number rolls from 0 with its decimals and grouping, the rest kept. */
export function countText(text: string, u: number, len: number): string {
  const m = /(\d[\d,]*(?:\.\d+)?)/.exec(text);
  if (!m) return text;
  const raw = m[1]!;
  const value = Number(raw.replace(/,/g, ""));
  const decimals = raw.includes(".") ? raw.split(".")[1]!.length : 0;
  const v = value * cubicOut(prog(u, 0.06, Math.max(0.3, len * 0.7)));
  let shown = v.toFixed(decimals);
  if (raw.includes(",")) shown = Number(shown).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return text.slice(0, m.index) + shown + text.slice(m.index + raw.length);
}

function drawSub(g: CanvasRenderingContext2D, sc: Scene, shot: Shot, u: number, box: Box, ink: string, extent: { top: number; bottom: number }): void {
  if (!shot.sub) return;
  const e = expoOut(prog(u, 0.22, 0.5));
  if (e <= 0) return;
  const size = Math.max(40 * sc.s, Math.min(64 * sc.s, box.maxSize * 0.2));
  g.save();
  g.font = `500 ${size.toFixed(1)}px ${sc.mono}`;
  g.textAlign = box.align === "left" ? "left" : "center";
  g.textBaseline = "middle";
  g.globalAlpha = e;
  g.fillStyle = ink;
  // Never wider than the layout's column (or the frame).
  const room = Math.min(box.maxW, sc.W * 0.9);
  const wide = g.measureText(shot.sub.toUpperCase()).width * 1.25;
  if (wide > room) g.font = `500 ${((size * room) / wide).toFixed(1)}px ${sc.mono}`;
  // Under the type, or over it when under would leave the frame.
  const under = extent.bottom + size * 1.1;
  const y = (under + size > sc.H * 0.94 ? extent.top - size * 0.9 : under) + (1 - e) * size * 0.6;
  // Tracking closes as it lands.
  g.letterSpacing = `${((0.25 + 0.35 * (1 - e)) * size * 0.3).toFixed(1)}px`;
  g.fillText(shot.sub.toUpperCase(), box.cx, y);
  g.restore();
}

function speedLines(g: CanvasRenderingContext2D, sc: Scene, u: number, amount: number, color: string, dir: number): void {
  const r = mulberry32(sc.seed + 31);
  g.save();
  g.strokeStyle = color;
  for (let i = 0; i < 46; i += 1) {
    const y = r() * sc.H;
    const l = (200 + r() * 900) * sc.s;
    const v = 0.5 + r();
    const w = 1 + r() * 5;
    const x0 = r() * sc.W;
    const x = (((x0 - dir * u * v * 3600 * sc.s) % (sc.W + l)) + sc.W + l) % (sc.W + l) - l;
    g.globalAlpha = amount * (0.25 + 0.5 * r());
    g.lineWidth = w * sc.s;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + l, y);
    g.stroke();
  }
  g.restore();
}

function drawLayer(g: CanvasRenderingContext2D, sc: Scene, shot: Shot, u: number, layer: Shot["layers"][number], box: Box, ground: Ground): void {
  const ink = sc.inks[ground];
  const accent = ground === "accent" ? ink : sc.accent;
  const { s } = sc;
  const r = mulberry32(sc.seed * 7919 + shot.index * 104729 + layer.length);
  g.save();
  switch (layer) {
    case "blobs": {
      g.globalCompositeOperation = ground === "light" ? "multiply" : "screen";
      const kick = 1 + 1.4 * Math.exp(-4 * u);
      for (let i = 0; i < 4; i += 1) {
        const x = box.rx + noise1(u * 0.35 + i * 7, sc.seed + i) * sc.W * 0.32;
        const y = box.ry + noise1(u * 0.3 + i * 13, sc.seed + i + 9) * sc.H * 0.3;
        const rad = (0.42 + 0.12 * i) * Math.min(sc.W, sc.H) * (0.85 + 0.15 * kick);
        const gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, i % 2 ? sc.colors.secondary : accent);
        gr.addColorStop(1, "rgba(0,0,0,0)");
        g.globalAlpha = 0.42;
        g.fillStyle = gr;
        g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      break;
    }
    case "tunnel": {
      g.translate(box.rx, box.ry);
      for (let k = 0; k < 14; k += 1) {
        const z = (((k / 14 + u * 0.45) % 1) + 1) % 1;
        const sz = z ** 2.6 * 3.4 + 0.02;
        g.save();
        g.rotate((1 - z) * 1.6 + u * 0.25);
        g.strokeStyle = k % 3 ? ink : accent;
        g.globalAlpha = Math.min(1, z * 2.2) * (1 - prog(z, 0.85, 0.15)) * (k % 3 ? 0.45 : 0.9);
        g.lineWidth = (1.5 + 14 * z * z * z) * s;
        g.beginPath();
        g.roundRect((-sc.W * sz) / 2, (-sc.H * sz) / 2, sc.W * sz, sc.H * sz, sc.H * sz * 0.18);
        g.stroke();
        g.restore();
      }
      break;
    }
    case "grid": {
      // A dot grid lit by a wave travelling out from the motif's centre.
      const gap = 54 * s;
      for (let y = gap / 2; y < sc.H; y += gap)
        for (let x = gap / 2; x < sc.W; x += gap) {
          const d = Math.hypot(x - box.rx, y - box.ry);
          const lit = prog(u - d / (1500 * s), 0, 0.3);
          const breathe = 0.5 + 0.5 * Math.sin(u * 3 - d / (160 * s));
          g.fillStyle = lit > 0.98 && breathe > 0.93 ? accent : ink;
          g.globalAlpha = 0.12 + 0.5 * lit * (0.4 + 0.6 * breathe);
          const rad = (2 + 3.5 * lit * breathe) * s;
          g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        }
      break;
    }
    case "scope": {
      // An oscilloscope: graticule, then a trace that draws on and swells into a wave, three strokes for phosphor glow.
      const x0 = box.rx - box.rr * 1.5;
      const x1 = box.rx + box.rr * 1.5;
      const hh = box.rr * 0.7;
      g.strokeStyle = ink;
      g.globalAlpha = 0.12;
      g.lineWidth = 1.2 * s;
      for (let i = 0; i <= 10; i += 1) {
        const x = x0 + ((x1 - x0) * i) / 10;
        g.beginPath();
        g.moveTo(x, box.ry - hh);
        g.lineTo(x, box.ry + hh);
        g.stroke();
      }
      for (let i = -3; i <= 3; i += 1) {
        g.beginPath();
        g.moveTo(x0, box.ry + (i * hh) / 3);
        g.lineTo(x1, box.ry + (i * hh) / 3);
        g.stroke();
      }
      g.globalAlpha = 1;
      const amp = hh * 0.85 * expoOut(prog(u, 0.3, 0.6));
      const pts: Pt[] = [];
      for (let k = 0; k <= 300; k += 1) {
        const f = k / 300;
        const env = Math.exp(-(((f - 0.5) * 2.2) ** 2));
        pts.push([x0 + (x1 - x0) * f, box.ry + amp * env * (Math.sin(f * 40 + u * 18) * 0.7 + noise1(f * 30 + u * 6, sc.seed) * 0.3)]);
      }
      const draw = expoOut(prog(u, 0, 0.4));
      for (const [lw, al] of [[14, 0.12], [6, 0.3], [2.5, 1]] as const) drawOn(g, pts, draw, accent, lw * s, al);
      break;
    }
    case "routes": {
      // Auto-routed traces from both sides converge on the motif in 90° / 45° runs; pads pop where they land.
      for (let i = 0; i < 24; i += 1) {
        const d = i % 2 ? 1 : -1;
        const sx = d < 0 ? -40 * s : sc.W + 40 * s;
        const sy = 80 * s + r() * (sc.H - 160 * s);
        const tx = box.rx + d * (box.rr * 0.35 + r() * box.rr * 0.3);
        const ty = box.ry - box.rr * 0.35 + r() * box.rr * 0.7;
        const dy = Math.abs(ty - sy);
        const mx = tx + d * (dy + 40 * s + r() * 160 * s);
        const pts: Pt[] = [[sx, sy], [mx, sy], [mx - d * dy, ty], [tx, ty]];
        const p = stagger(u, i, 0.025, 0.7, cubicInOut);
        const head = drawOn(g, pts, p, i % 4 === 0 ? accent : ink, 3 * s, i % 4 === 0 ? 0.95 : 0.55);
        if (p >= 1) {
          const a = stagger(u - 0.7, i, 0.025, 0.3, (x) => springIn(x));
          g.fillStyle = accent;
          g.beginPath();
          g.arc(head[0], head[1], Math.max(0, 9 * s * a), 0, TAU);
          g.fill();
        }
      }
      break;
    }
    case "rings": {
      // A shockwave: rings racing out, streaks flung and slowing.
      for (let i = 0; i < 4; i += 1) {
        const p = prog(u, i * 0.09, 0.95);
        if (p <= 0 || p >= 1) continue;
        g.strokeStyle = i ? accent : ink;
        g.globalAlpha = (1 - p) * 0.8;
        g.lineWidth = (14 * (1 - p) + 1) * s;
        g.beginPath();
        g.arc(box.rx, box.ry, (180 + 1500 * (1 - (1 - p) ** 5)) * s, 0, TAU);
        g.stroke();
      }
      for (let i = 0; i < 140; i += 1) {
        const a = r() * TAU;
        const v = 700 + r() * 4400;
        const w = 1.5 + r() * 4;
        const rad = (150 + (v * (1 - Math.exp(-4.2 * u))) / 4.2) * s;
        const l = (v * Math.exp(-4.2 * u) * 0.035 + 2) * s;
        const al = (1 - prog(u, 0.7, 0.8)) * 0.7;
        if (al <= 0) continue;
        g.strokeStyle = i % 3 ? ink : accent;
        g.globalAlpha = al;
        g.lineWidth = w * s;
        g.beginPath();
        g.moveTo(box.rx + Math.cos(a) * rad, box.ry + Math.sin(a) * rad);
        g.lineTo(box.rx + Math.cos(a) * (rad + l), box.ry + Math.sin(a) * (rad + l));
        g.stroke();
      }
      break;
    }
    case "rays":
      speedLines(g, sc, u, 0.8, ink, shot.index % 2 === 0 ? 1 : -1);
      break;
    case "orbit": {
      const tilt = 0.32;
      for (let k = 0; k < 3; k += 1) {
        const R = box.rr * (0.75 + k * 0.32) * expoOut(prog(u, k * 0.08, 0.6));
        g.save();
        g.translate(box.rx, box.ry);
        g.rotate(-0.35 + k * 0.5);
        g.strokeStyle = ink;
        g.globalAlpha = 0.28;
        g.lineWidth = 1.5 * s;
        g.beginPath();
        g.ellipse(0, 0, R, R * tilt, 0, 0, TAU);
        g.stroke();
        const a = u * (1.1 - k * 0.25) * (k % 2 ? -1 : 1) + k * 2;
        g.globalAlpha = 1;
        g.fillStyle = k === 0 ? accent : ink;
        g.beginPath();
        g.arc(Math.cos(a) * R, Math.sin(a) * R * tilt, (10 - k * 2) * s, 0, TAU);
        g.fill();
        g.restore();
      }
      break;
    }
    case "bars": {
      // Data bars rising on a stagger, one in the accent, all breathing.
      const n = 9;
      const span = box.rr * 2.4;
      const bw = (span / n) * 0.62;
      const baseY = box.ry + box.rr * 0.9;
      const hi = 2 + Math.floor(r() * (n - 4));
      for (let i = 0; i < n; i += 1) {
        const target = (0.25 + 0.75 * r()) * box.rr * 1.6 * (i === hi ? 1.25 : 1);
        const grow = springIn(prog(u - i * 0.05, 0, 0.6), 5, 7);
        const h = Math.max(0, target * grow * (1 + 0.05 * Math.sin(u * 4 + i)));
        g.fillStyle = i === hi ? accent : ink;
        g.globalAlpha = i === hi ? 1 : 0.35;
        g.fillRect(box.rx - span / 2 + (i * span) / n, baseY - h, bw, h);
      }
      g.globalAlpha = 0.5;
      g.fillStyle = ink;
      g.fillRect(box.rx - span / 2 - 10 * s, baseY, span + 20 * s, 2 * s);
      break;
    }
    case "marquee": {
      // Rows of the shot's word in outline, scrolling in alternate directions on a diagonal, the middle row filled.
      const unit = `${(shot.lines[0] ?? shot.sub) || "•"}  `;
      const size = 150 * s;
      g.translate(sc.W / 2, sc.H / 2);
      g.rotate(-0.12);
      g.font = fontOf(sc, size);
      g.textBaseline = "middle";
      const uw = Math.max(1, g.measureText(unit).width);
      const D = Math.hypot(sc.W, sc.H) / 2;
      for (let k = -4; k <= 4; k += 1) {
        const d = k % 2 ? 1 : -1;
        const off = d * u * 420 * s + k * 137 * s;
        const y = k * size * 1.05;
        for (let x = (((off % uw) + uw) % uw) - uw - D; x < D; x += uw) {
          g.globalAlpha = k === 0 ? 0.9 : 0.28;
          if (k === 0) {
            g.fillStyle = accent;
            g.fillText(unit, x, y);
          } else {
            g.strokeStyle = ink;
            g.lineWidth = 2.5 * s;
            g.strokeText(unit, x, y);
          }
        }
      }
      break;
    }
    case "dial": {
      g.translate(box.rx, box.ry);
      const R = box.rr * 1.05 * expoOut(prog(u, 0, 0.5));
      g.rotate(u * 0.35);
      g.strokeStyle = ink;
      g.globalAlpha = 0.6;
      g.lineWidth = 2 * s;
      g.beginPath();
      for (let i = 0; i < 120; i += 1) {
        const a = (i / 120) * TAU;
        const l = (i % 5 ? 9 : 22) * s;
        g.moveTo(Math.cos(a) * R, Math.sin(a) * R);
        g.lineTo(Math.cos(a) * (R + l), Math.sin(a) * (R + l));
      }
      g.stroke();
      g.strokeStyle = accent;
      g.globalAlpha = 0.9;
      g.lineWidth = 3 * s;
      g.beginPath();
      g.arc(0, 0, R * 0.9, -0.4, -0.4 + TAU * 0.28 * cubicInOut(prog(u, 0.2, 0.8)));
      g.stroke();
      break;
    }
    default:
      break;
  }
  g.restore();
}
