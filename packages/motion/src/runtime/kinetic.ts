/**
 * Kinetic-cut FX: hits (a cut, a slam, the climax) drive the camera and the
 * finish — a punch-in, a decaying shake, chromatic aberration, a flash and a
 * bloom pulse — and a shot's frame is the average of sub-frames inside the
 * shot (motion blur that never smears across a cut). Plus the parts shots are
 * drawn with: progress, stagger, smooth noise, draw-on polylines, particles
 * that assemble into any shape.
 *
 * Ported from Tweenkit's kinetic-cut-video engine (MIT, © 2026 wmzspace:
 * assets/template/engine.js `K.start`, `renderAt`, `drawOn`, `stg`, `noise1`,
 * `FX.sample`, `FX.assemble`, `blobs`; see packages/motion/NOTICE). Every
 * function is pure in t, so tabs render frames in any order.
 */

import { mulberry32 } from "./rng.js";
import type { Track } from "./timeline.js";

/** A hit at `t` s: `strength` 1 for a cut, 0.5-0.6 for an off-beat cut, 1.3-1.4 for the climax; `shake` in design px. */
export interface Hit {
  t: number;
  strength: number;
  shake?: number;
}

/** How hard hits push the picture. */
export interface HitLook {
  /** Camera punch-in per unit hit (0.05 = 5 %). */
  punch: number;
  /** Chromatic aberration at rest and added per hit, px at 960 px half-width. */
  chroma: number;
  chromaHit: number;
  /** Additive flash per hit, 0..1. */
  flash: number;
  /** Corner darkening, 0..1. */
  vignette: number;
}

/** engine.js `KC` defaults are `punchy`; `clean` is its "cleaner picture" advice (no resting aberration, a soft flash). */
export const HIT_LOOKS = {
  clean: { punch: 0.035, chroma: 0, chromaHit: 6, flash: 0.15, vignette: 0.25 },
  punchy: { punch: 0.05, chroma: 1.6, chromaHit: 13, flash: 0.3, vignette: 0.34 },
  wild: { punch: 0.08, chroma: 3, chromaHit: 22, flash: 0.45, vignette: 0.4 },
} as const satisfies Record<string, HitLook>;
export type HitLookName = keyof typeof HIT_LOOKS;

/** A hit stops counting this long after it lands, s. */
const HIT_TAIL = 1.2;

/** Sum of the hits' exponential decays at `t` (engine.js `env`): 7 for the punch, 9 aberration, 10 bloom, 24 flash. */
export function hitEnvelope(hits: readonly Hit[], t: number, decay: number): number {
  let v = 0;
  for (const h of hits) {
    const u = t - h.t;
    if (u >= 0 && u < HIT_TAIL) v += h.strength * Math.exp(-decay * u);
  }
  return v;
}

/** The camera at `t`: a zoom about the frame centre and a shake offset in design px. */
export function hitCamera(hits: readonly Hit[], t: number, punch: number): { zoom: number; x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const h of hits) {
    const u = t - h.t;
    if (!h.shake || u < 0 || u >= 1) continue;
    const d = h.shake * Math.exp(-8 * u);
    x += d * Math.sin(u * 64 + h.t);
    y += d * Math.cos(u * 57 + h.t * 2);
  }
  return { zoom: 1 + punch * hitEnvelope(hits, t, 7), x, y };
}

/** The finish at `t`: aberration as a fraction of the frame, flash alpha, bloom strength (from the shot's `bloom`). */
export function hitFinish(hits: readonly Hit[], t: number, look: HitLook, bloom: number): { chroma: number; flash: number; bloom: number } {
  return {
    chroma: (look.chroma + look.chromaHit * hitEnvelope(hits, t, 9)) / 960,
    flash: Math.min(1, look.flash * hitEnvelope(hits, t, 24)),
    bloom: Math.min(1, bloom * 0.72 + 0.22 * hitEnvelope(hits, t, 10)),
  };
}

/**
 * Sub-frame times for frame time `t`: `samples` spread over the shutter
 * (`shutter` of a frame), clamped inside the shot [from, to) so a cut stays a cut.
 */
export function subframeTimes(t: number, samples: number, shutter: number, fps: number, from: number, to: number): number[] {
  const n = Math.max(1, Math.round(samples));
  const out: number[] = [];
  for (let k = 0; k < n; k += 1) out.push(Math.min(to - 1e-4, Math.max(from, t + ((k + 0.5) / n - 0.5) * (shutter / fps))));
  return out;
}

// Easing parts (engine.js names in brackets): shots are written with these.
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** 0..1 progress of `t` through [start, start + dur] [P]. */
export const prog = (t: number, start: number, dur: number): number => clamp01((t - start) / dur);
/** Expo-out: the hard stop of a slam or a fling [ex]. */
export const expoOut = (x: number): number => (x >= 1 ? 1 : x <= 0 ? 0 : 1 - 2 ** (-10 * x));
/** Cubic-in: wind-up, being sucked away [ei]. */
export const cubicIn = (x: number): number => x * x * x;
/** Cubic-out [eo]. */
export const cubicOut = (x: number): number => 1 - (1 - x) ** 3;
/** Cubic in-out: sweeps, paths [eio]. */
export const cubicInOut = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
/** Spring 0→1 with overshoot [spr]. */
export const springIn = (x: number, damp = 7, freq = 9): number => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-damp * x) * Math.cos(freq * x));
/** Stamp scale: (1 + k) → 1 with a hard stop over `d` s [st]. */
export const stamp = (u: number, d = 0.28, k = 1.2): number => 1 + k * (1 - expoOut(prog(u, 0, d)));
/** Element i of a staggered group: its eased progress [stg]. */
export const stagger = (u: number, i: number, gap = 0.05, d = 0.4, ease: (x: number) => number = expoOut): number => ease(prog(u, i * gap, d));

/** Smooth value noise in [-1, 1] [noise1]: signal jitter, a hand-drawn wobble. */
export function noise1(x: number, seed = 0): number {
  const h = (n: number): number => {
    const v = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const i = Math.floor(x);
  const f = x - i;
  const k = f * f * (3 - 2 * f);
  return (h(i) + (h(i + 1) - h(i)) * k) * 2 - 1;
}

export type Pt = readonly [number, number];

/** The first `p` (0..1) of a polyline by length, and its head [drawOn without the drawing]. */
export function polylineTo(pts: readonly Pt[], p: number): { pts: Pt[]; head: Pt } {
  if (pts.length < 2 || p <= 0) return { pts: pts.slice(0, 1), head: pts[0] ?? [0, 0] };
  const lens = [0];
  for (let i = 1; i < pts.length; i += 1) lens.push(lens[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  const end = lens[lens.length - 1]! * clamp01(p);
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length; i += 1) {
    if (lens[i]! <= end) {
      out.push(pts[i]!);
      continue;
    }
    const f = (end - lens[i - 1]!) / (lens[i]! - lens[i - 1]! || 1);
    out.push([pts[i - 1]![0] + (pts[i]![0] - pts[i - 1]![0]) * f, pts[i - 1]![1] + (pts[i]![1] - pts[i - 1]![1]) * f]);
    break;
  }
  return { pts: out, head: out[out.length - 1]! };
}

/** Stroke the first `p` of a polyline (a trace, a route, a signature); returns the pen's head. */
export function drawOn(g: CanvasRenderingContext2D, pts: readonly Pt[], p: number, color: string, width = 3, alpha = 1): Pt {
  const { pts: part, head } = polylineTo(pts, p);
  if (part.length < 2) return head;
  g.save();
  g.globalAlpha *= alpha;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(part[0]![0], part[0]![1]);
  for (const q of part.slice(1)) g.lineTo(q[0], q[1]);
  g.stroke();
  g.restore();
  return head;
}

/** A particle of a shape: its target in polar form (radius in [0, ~1.4] of the shape's half-size), start radius, delay, colour pick, size. */
export interface ShapeParticle {
  angle: number;
  radius: number;
  startRadius: number;
  delay: number;
  pick: number;
  size: number;
}

/**
 * `count` particles on the filled pixels of `mask` (row-major, `side`×`side`,
 * true = inside), seeded [FX.sample]: what `assemble` flies into place.
 */
export function shapeParticles(mask: ArrayLike<boolean | number>, side: number, count: number, seed: number): ShapeParticle[] {
  const inside: number[] = [];
  for (let k = 0; k < side * side; k += 1) if (mask[k]) inside.push(k);
  const r = mulberry32(seed);
  const out: ShapeParticle[] = [];
  for (let i = 0; i < count && inside.length > 0; i += 1) {
    const k = inside[Math.floor(r() * inside.length)]!;
    const px = ((k % side) + r()) / side * 2 - 1;
    const py = (Math.floor(k / side) + r()) / side * 2 - 1;
    out.push({ angle: Math.atan2(py, px), radius: Math.hypot(px, py), startRadius: 4 + r() * 7, delay: r() * 0.42, pick: r(), size: 2 + r() * 3 });
  }
  return out;
}

/** A shape's mask: `draw` paints white into a `side`² canvas whose [-1, 1] square is the shape box; null without a 2D canvas. */
export function shapeMask(doc: Document, draw: (g: CanvasRenderingContext2D, side: number) => void, side = 180): boolean[] | null {
  const c = doc.createElement("canvas");
  c.width = side;
  c.height = side;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.fillStyle = "#000";
  g.fillRect(0, 0, side, side);
  g.fillStyle = "#fff";
  g.strokeStyle = "#fff";
  draw(g, side);
  const data = g.getImageData(0, 0, side, side).data;
  const out: boolean[] = [];
  for (let k = 0; k < side * side; k += 1) out.push(data[k * 4]! > 127);
  return out;
}

/**
 * Where particle `p` is at `u` s into the assembly (each lands over ~1 s
 * after its delay, spiralling in from far out) [FX.assemble]: design px from
 * the centre, for a shape box of half-size `R`, and how settled it is (0..1).
 */
export function assembleAt(p: ShapeParticle, u: number, R: number, spin = 0): { x: number; y: number; settled: number; size: number } {
  const a = prog(u - p.delay, 0, 0.95);
  const e = expoOut(a);
  const rad = p.startRadius + (p.radius - p.startRadius) * e;
  const ang = p.angle + spin + (1 - e) * (2.4 + p.pick);
  return { x: Math.cos(ang) * rad * R, y: Math.sin(ang) * rad * R, settled: a, size: p.size * (1 + 2.5 * (1 - e)) };
}

/**
 * The finish over a frame already drawn into `src` [renderAt]: bloom (a
 * quarter-size squared, blurred copy screened on), chromatic aberration (red
 * and green scaled out from the centre), the flash and the vignette, into `out`.
 * `scratch` holds the reusable buffers (one per output canvas).
 */
export interface FinishBuffers {
  small: [HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement];
  channels: [HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement];
  vignette: HTMLCanvasElement;
}

export function finishBuffers(doc: Document, w: number, h: number, vignette: number): FinishBuffers {
  const mk = (cw: number, ch: number): HTMLCanvasElement => Object.assign(doc.createElement("canvas"), { width: cw, height: ch });
  const bw = Math.max(1, Math.round(w / 4));
  const bh = Math.max(1, Math.round(h / 4));
  const vig = mk(w, h);
  const g = vig.getContext("2d");
  if (g) {
    const d = Math.hypot(w, h) / 2;
    const gr = g.createRadialGradient(w / 2, h / 2, d * 0.45, w / 2, h / 2, d * 1.05);
    gr.addColorStop(0, "rgba(0,0,0,0)");
    gr.addColorStop(1, `rgba(0,0,0,${vignette})`);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }
  return { small: [mk(bw, bh), mk(bw, bh), mk(bw, bh)], channels: [mk(w, h), mk(w, h), mk(w, h)], vignette: vig };
}

export function applyFinish(
  out: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  buf: FinishBuffers,
  f: { chroma: number; flash: number; bloom: number; flashColor?: string; lightGround?: boolean },
): void {
  const { width: W, height: H } = src;
  const [b1, b2, b3] = buf.small;
  const bw = b1.width;
  const bh = b1.height;
  const sg = src.getContext("2d")!;
  if (f.bloom > 0.01) {
    b1.getContext("2d")!.drawImage(src, 0, 0, bw, bh);
    const c2 = b2.getContext("2d")!;
    c2.globalCompositeOperation = "copy";
    c2.drawImage(b1, 0, 0);
    // Squaring keeps the highlights: only what is bright blooms.
    c2.globalCompositeOperation = "multiply";
    c2.drawImage(b1, 0, 0);
    const c3 = b3.getContext("2d")!;
    c3.globalCompositeOperation = "copy";
    c3.filter = "blur(8px)";
    c3.drawImage(b2, 0, 0);
    c3.filter = "none";
    sg.globalCompositeOperation = "screen";
    sg.globalAlpha = clamp01(f.bloom);
    sg.drawImage(b3, 0, 0, W, H);
    // A wide horizontal streak, the anamorphic flare of the original.
    sg.globalAlpha = clamp01(f.bloom * 0.16);
    sg.drawImage(b3, -W * 0.6, H * 0.3, W * 2.2, H * 0.4);
    sg.globalCompositeOperation = "source-over";
    sg.globalAlpha = 1;
  }
  out.globalCompositeOperation = "source-over";
  out.globalAlpha = 1;
  const k = f.chroma;
  if (k > 0) {
    const tint = (cv: HTMLCanvasElement, col: string): void => {
      const c = cv.getContext("2d")!;
      c.globalCompositeOperation = "copy";
      c.drawImage(src, 0, 0);
      c.globalCompositeOperation = "multiply";
      c.fillStyle = col;
      c.fillRect(0, 0, W, H);
    };
    const [cr, cg, cb] = buf.channels;
    tint(cr, "#f00");
    tint(cg, "#0f0");
    tint(cb, "#00f");
    out.fillStyle = "#000";
    out.fillRect(0, 0, W, H);
    out.globalCompositeOperation = "lighter";
    out.drawImage(cr, -W * k, -H * k, W * (1 + 2 * k), H * (1 + 2 * k));
    out.drawImage(cg, (-W * k) / 2, (-H * k) / 2, W * (1 + k), H * (1 + k));
    out.drawImage(cb, 0, 0);
  } else out.drawImage(src, 0, 0);
  if (f.flash > 0.004) {
    out.globalCompositeOperation = "lighter";
    out.globalAlpha = clamp01(f.flash);
    out.fillStyle = f.flashColor ?? "rgb(255,236,224)";
    out.fillRect(0, 0, W, H);
    out.globalAlpha = 1;
  }
  out.globalCompositeOperation = "source-over";
  // Light grounds get a lighter vignette, or the corners look dirty.
  out.globalAlpha = f.lightGround ? 0.4 : 1;
  out.drawImage(buf.vignette, 0, 0);
  out.globalAlpha = 1;
}

/**
 * The same hits on a DOM element (a wrapper around a block's content): the
 * punch and shake as a transform, the flash as a brightness lift. Lets any
 * block land on the cuts like a kinetic-cut scene.
 */
export function hitTrack(el: HTMLElement, hits: readonly Hit[], look: HitLook = HIT_LOOKS.punchy): Track {
  return (t) => {
    const cam = hitCamera(hits, t, look.punch);
    const flash = Math.min(1, look.flash * hitEnvelope(hits, t, 24));
    el.style.transform = cam.zoom === 1 && cam.x === 0 && cam.y === 0 ? "" : `translate(${cam.x.toFixed(2)}px, ${cam.y.toFixed(2)}px) scale(${cam.zoom.toFixed(4)})`;
    el.style.filter = flash > 0.004 ? `brightness(${(1 + flash * 1.5).toFixed(3)})` : "";
  };
}
