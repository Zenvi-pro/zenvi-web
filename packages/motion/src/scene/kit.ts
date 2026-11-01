/**
 * The scene kit: what a scene's `draw(ctx, t, api)` draws with. Every call
 * is a pure function of the frame being drawn (the runtime sets it before
 * each draw), so a frame looks the same in any tab and in any order.
 *
 * Motion tokens are the runtime's named eases and springs (runtime/easing.ts,
 * TASTE.md); hits are the kinetic-cut FX of runtime/kinetic.ts (punch,
 * shake, aberration, flash, bloom, ported from Tweenkit, MIT); text, UI and
 * camera follow cinetic's starter kit (MIT, assets/remotion-starter/src/lib:
 * Words, Window, Cursor, camera push and parallax) drawn with Canvas 2D.
 * Text records its boxes for the layout audit (scene/audit.ts).
 */

import type { Palette } from "../tokens.js";
import { FONT_STACKS, PALETTES, withAccent, type FontRole, type PaletteName } from "../tokens.js";
import { EASES, spring as springEase, type Ease, type EaseName, type SpringOptions } from "../runtime/easing.js";
import { applyFinish, finishBuffers, hitCamera, hitFinish, HIT_LOOKS, noise1, polylineTo, type FinishBuffers, type HitLookName, type Pt } from "../runtime/kinetic.js";
import type { Hit } from "../runtime/hit.js";
import { hashInts, mulberry32, random01 } from "../runtime/rng.js";
import { formatNumber, type NumberFormat } from "../runtime/text.js";
import { safeArea } from "../runtime/safe.js";
import type { SceneCue, SceneMediaRef, TextBox } from "./contract.js";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A time: a frame of the scene's grid, or a cue's name. */
export type When = number | string;
export type EaseSpec = EaseName | Ease;

export interface Reveal {
  /** When the first unit starts (frame or cue). */
  at: When;
  per?: "word" | "char" | "line";
  /** Frames between units (default 3 words, 1 char). */
  stagger?: number;
  /** Frames each unit takes (default 14). */
  dur?: number;
  ease?: EaseSpec;
  /** Design px each unit rises from (default 0.5 × size × 0.6). */
  rise?: number;
  /** Units leave from this time on (reverse order), same timing. */
  out?: When;
}

export interface TextOptions {
  x: number;
  y: number;
  size?: number;
  font?: FontRole;
  weight?: number;
  italic?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
  /** Vertical anchor of y (default middle of the first line). */
  baseline?: "top" | "middle" | "bottom";
  /** Letter spacing, em (cinetic: -0.02 to -0.04 for display sizes). */
  tracking?: number;
  /** Line height, × size (default 1.12). */
  leading?: number;
  /** Wrap at this width, design px. */
  maxWidth?: number;
  opacity?: number;
  reveal?: Reveal;
  /** The layout audit's id for this fragment (default the text). */
  id?: string;
  /** A product string (a typed command, a URL, an app label): read apart from the copy. */
  ui?: boolean;
  outline?: { width: number; color: string };
  /** Draw only inside this rect (a field's box); the audit sees the part inside. */
  clip?: Rect;
}

export interface ShapeStyle {
  fill?: string | CanvasGradient;
  stroke?: string;
  lineWidth?: number;
  /** 0..1 of the stroke drawn on (draw-on). */
  draw?: number;
  opacity?: number;
  shadow?: { blur: number; y?: number; color?: string };
  cap?: CanvasLineCap;
}

export interface CameraState {
  zoom: number;
  x: number;
  y: number;
  /** Degrees. */
  rotate: number;
}

export interface GradientSpec {
  stops: readonly (readonly [number, string])[];
  /** Linear angle, degrees (0 = left to right, 90 = top to bottom; default 90). */
  angle?: number;
  /** Radial: centre and radius as 0..1 of the rect (default centre, 0.75). */
  radial?: { cx?: number; cy?: number; r?: number };
  /** Dither amount (default 1; 0 = off): breaks the bands an 8-bit gradient shows. */
  dither?: number;
}

/** What the runtime gives the kit: the canvas (kept from the scene), the frame state, the media loader. */
export interface KitHost {
  doc: Document;
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  /** Canvas px per design px. */
  scale: number;
  designWidth: number;
  designHeight: number;
  fps: number;
  duration: number;
  cues: readonly SceneCue[];
  params: Record<string, unknown>;
  media: Record<string, SceneMediaRef>;
  seed: number;
  alpha: boolean;
  /** An image by URL when decoded, else null (the runtime loads it and draws the frame again). */
  image(url: string): HTMLImageElement | null;
}

interface FrameState {
  t: number;
  boxes: TextBox[];
  camera: CameraState;
  hitFx: { look: HitLookName; bloom: number } | null;
  grain: { amount: number; animated: boolean } | null;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

function roundRectPath(g: CanvasRenderingContext2D | Path2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** The cursor arrow, 0,0 at its tip, ~26 × 38 design px at scale 1 (macOS proportions). */
const ARROW = "M0 0 L0 30 L7.5 23.2 L12.6 35.2 L17.4 33.2 L12.4 21.6 L22.4 21.6 Z";

export type SceneApi = ReturnType<typeof createKit>["api"];

/** Build the kit for one scene page; `begin(t)` before each draw, `end()` after it. */
export function createKit(host: KitHost) {
  const { ctx, doc } = host;
  const W = host.designWidth;
  const H = host.designHeight;
  const palette: Palette = (() => {
    const p = host.params;
    const base = withAccent(PALETTES[(p.palette as PaletteName) ?? "light"] ?? PALETTES.light, typeof p.accent === "string" ? p.accent : undefined);
    return { ...base, ...(typeof p.paper === "string" ? { paper: p.paper } : {}), ...(typeof p.ink === "string" ? { ink: p.ink } : {}) };
  })();
  // The smallest readable text (scene/audit.ts): kit UI labels never go under it.
  const minText = H > W * 1.5 ? 32 : 22;
  const cueFrames = new Map(host.cues.map((c) => [c.name, c.frame]));
  const hits: Hit[] = host.cues.filter((c) => c.hit !== undefined && c.hit > 0).map((c) => ({ t: c.frame / host.fps, strength: c.hit!, ...(c.shake !== undefined ? { shake: c.shake } : {}), ...(c.flash !== undefined ? { flash: c.flash } : {}) }));
  const state: FrameState = { t: 0, boxes: [], camera: { zoom: 1, x: 0, y: 0, rotate: 0 }, hitFx: null, grain: null };
  const pathLengths = new Map<string, number>();
  const paths = new Map<string, Path2D>();
  let finish: FinishBuffers | undefined;
  let copy: HTMLCanvasElement | undefined;
  let noiseTile: HTMLCanvasElement | undefined;

  const frameOf = (when: When): number => {
    if (typeof when === "number") return when;
    const f = cueFrames.get(when);
    if (f === undefined) throw new Error(`unknown cue "${when}" (cues: ${[...cueFrames.keys()].join(", ") || "none"})`);
    return f;
  };
  const easeOf = (e: EaseSpec | undefined): Ease => {
    if (e === undefined) return EASES.out;
    if (typeof e === "function") return e;
    const named = EASES[e];
    if (!named) throw new Error(`unknown ease "${String(e)}" (eases: ${Object.keys(EASES).join(", ")})`);
    return named;
  };
  const prog = (from: When, dur: number, ease?: EaseSpec): number => {
    const u = dur <= 0 ? (state.t >= frameOf(from) ? 1 : 0) : clamp01((state.t - frameOf(from)) / dur);
    return easeOf(ease)(u);
  };

  const fontString = (o: { size: number; font: FontRole; weight: number; italic: boolean }): string => `${o.italic ? "italic " : ""}${o.weight} ${o.size}px ${FONT_STACKS[o.font]}`;

  /** The box drawn in local design px, as design px of the frame (the current transform applied). */
  const recordBox = (id: string, text: string, x: number, y: number, w: number, h: number, px: number, opacity: number, ui: boolean): void => {
    const m = ctx.getTransform();
    const s = host.scale;
    const corners = [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ].map(([cx, cy]) => [(m.a * cx! + m.c * cy! + m.e) / s, (m.b * cx! + m.d * cy! + m.f) / s] as const);
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const zoom = Math.hypot(m.a, m.b) / s;
    state.boxes.push({ id, text, x: left, y: top, w: Math.max(...xs) - left, h: Math.max(...ys) - top, px: px * zoom, opacity, ui });
  };

  const wrap = (text: string, maxWidth: number | undefined, tracking: number): string[] => {
    const out: string[] = [];
    for (const para of text.split("\n")) {
      if (!maxWidth) {
        out.push(para);
        continue;
      }
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(next).width + tracking * next.length > maxWidth) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  };

  /**
   * Draw text, optionally revealed word by word (cinetic's <Words>), and
   * record it for the layout audit. Returns its size, design px.
   */
  function text(str: string, o: TextOptions): { w: number; h: number } {
    const size = o.size ?? 64;
    const font = o.font ?? "sans";
    const weight = o.weight ?? (font === "display" ? 400 : 600);
    ctx.save();
    if (o.clip) {
      ctx.beginPath();
      ctx.rect(o.clip.x, o.clip.y, o.clip.w, o.clip.h);
      ctx.clip();
    }
    ctx.font = fontString({ size, font, weight, italic: o.italic === true });
    const trackPx = (o.tracking ?? (size >= 72 ? -0.025 : 0)) * size;
    ctx.letterSpacing = `${trackPx}px`;
    ctx.textBaseline = "alphabetic";
    const lines = wrap(str, o.maxWidth, trackPx);
    const leading = (o.leading ?? 1.12) * size;
    const widths = lines.map((l) => ctx.measureText(l).width);
    const blockW = Math.max(0, ...widths);
    const blockH = leading * (lines.length - 1) + size;
    const top = o.baseline === "top" ? o.y : o.baseline === "bottom" ? o.y - blockH : o.y - size / 2;
    const ascent = size * 0.76;
    const base = (o.opacity ?? 1) * ctx.globalAlpha;
    const rv = o.reveal;
    const per = rv?.per ?? "word";
    const stagger = rv?.stagger ?? (per === "char" ? 1 : 3);
    const dur = rv?.dur ?? 14;
    const ease = easeOf(rv?.ease);
    const rise = rv?.rise ?? size * 0.3;
    // Units in reading order across the lines: words, characters or whole lines.
    interface Unit {
      text: string;
      line: number;
      x: number;
    }
    const units: Unit[] = [];
    lines.forEach((l, i) => {
      const lx = o.align === "center" ? o.x - widths[i]! / 2 : o.align === "right" ? o.x - widths[i]! : o.x;
      if (!rv || per === "line") {
        units.push({ text: l, line: i, x: lx });
        return;
      }
      const parts = per === "char" ? [...l] : l.split(/(\s+)/);
      let cx = lx;
      for (const part of parts) {
        if (part.trim()) units.push({ text: part, line: i, x: cx });
        cx += ctx.measureText(part).width;
      }
    });
    const n = units.length;
    let readable: string[] = [];
    let maxAlpha = 0;
    ctx.textAlign = "left";
    units.forEach((u, i) => {
      let a = 1;
      let dy = 0;
      if (rv) {
        const p = ease(clamp01((state.t - frameOf(rv.at) - i * stagger) / dur));
        let q = 1;
        if (rv.out !== undefined) q = 1 - easeOf("in")(clamp01((state.t - frameOf(rv.out) - (n - 1 - i) * stagger) / dur));
        a = Math.min(p, q);
        dy = (1 - p) * rise - (1 - q) * rise * 0.6;
      }
      if (a <= 0.002) return;
      const alpha = base * a;
      ctx.globalAlpha = alpha;
      const y = top + ascent + u.line * leading + dy;
      if (o.outline) {
        ctx.lineJoin = "round";
        ctx.lineWidth = o.outline.width;
        ctx.strokeStyle = o.outline.color;
        ctx.strokeText(u.text, u.x, y);
      }
      if (o.color !== "none") {
        ctx.fillStyle = o.color ?? palette.ink;
        ctx.fillText(u.text, u.x, y);
      }
      maxAlpha = Math.max(maxAlpha, alpha);
      if (alpha >= 0.5) readable.push(u.text);
    });
    if (per === "char" && rv) readable = readable.length > 0 ? [readable.join("")] : [];
    let left = o.align === "center" ? o.x - blockW / 2 : o.align === "right" ? o.x - blockW : o.x;
    let right = left + blockW;
    let boxTop = top;
    let bottom = top + blockH;
    if (o.clip) {
      left = Math.max(left, o.clip.x);
      right = Math.min(right, o.clip.x + o.clip.w);
      boxTop = Math.max(boxTop, o.clip.y);
      bottom = Math.min(bottom, o.clip.y + o.clip.h);
    }
    if (maxAlpha > 0 && right > left && bottom > boxTop) recordBox(o.id ?? str.slice(0, 40), readable.join(" "), left, boxTop, right - left, bottom - boxTop, size, maxAlpha, o.ui === true);
    ctx.restore();
    return { w: blockW, h: blockH };
  }

  function measure(str: string, o: Omit<TextOptions, "x" | "y"> = {}): number {
    ctx.save();
    const size = o.size ?? 64;
    ctx.font = fontString({ size, font: o.font ?? "sans", weight: o.weight ?? 600, italic: o.italic === true });
    ctx.letterSpacing = `${(o.tracking ?? (size >= 72 ? -0.025 : 0)) * size}px`;
    const w = Math.max(0, ...str.split("\n").map((l) => ctx.measureText(l).width));
    ctx.restore();
    return w;
  }

  const paint = (path: Path2D, s: ShapeStyle, length?: number): void => {
    ctx.save();
    if (s.opacity !== undefined) ctx.globalAlpha *= s.opacity;
    if (s.shadow) {
      ctx.shadowBlur = s.shadow.blur * host.scale;
      ctx.shadowOffsetY = (s.shadow.y ?? 0) * host.scale;
      ctx.shadowColor = s.shadow.color ?? "rgba(0,0,0,0.18)";
    }
    if (s.fill) {
      ctx.fillStyle = s.fill;
      ctx.fill(path);
      ctx.shadowColor = "transparent";
    }
    if (s.stroke && (s.draw === undefined || s.draw > 0)) {
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = s.lineWidth ?? 3;
      ctx.lineCap = s.cap ?? "round";
      ctx.lineJoin = "round";
      if (s.draw !== undefined && s.draw < 1 && length) {
        ctx.setLineDash([length, length]);
        ctx.lineDashOffset = length * (1 - clamp01(s.draw));
      }
      ctx.stroke(path);
    }
    ctx.restore();
  };

  /** Length of an SVG path's outline (measured once by an SVG element the scene never sees). */
  const svgLength = (d: string): number => {
    let len = pathLengths.get(d);
    if (len === undefined) {
      const el = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      el.setAttribute("d", d);
      len = el.getTotalLength();
      pathLengths.set(d, len);
    }
    return len;
  };
  const path2d = (d: string): Path2D => {
    let p = paths.get(d);
    if (!p) {
      p = new Path2D(d);
      paths.set(d, p);
    }
    return p;
  };

  function rect(x: number, y: number, w: number, h: number, s: ShapeStyle & { radius?: number } = {}): void {
    const p = new Path2D();
    roundRectPath(p, x, y, w, h, s.radius ?? 0);
    paint(p, s, 2 * (w + h));
  }
  function circle(cx: number, cy: number, r: number, s: ShapeStyle = {}): void {
    const p = new Path2D();
    p.arc(cx, cy, Math.max(0, r), -Math.PI / 2, Math.PI * 1.5);
    paint(p, s, 2 * Math.PI * r);
  }
  /** An SVG path (`d`) or a polyline of points, filled and/or stroked, with draw-on. */
  function path(shape: string | readonly Pt[], s: ShapeStyle & { closed?: boolean } = {}): void {
    if (typeof shape === "string") return paint(path2d(shape), s, s.draw !== undefined ? svgLength(shape) : undefined);
    const pts = s.draw !== undefined && !s.fill ? polylineTo(shape, clamp01(s.draw)).pts : [...shape];
    const p = new Path2D();
    pts.forEach(([x, y], i) => (i === 0 ? p.moveTo(x, y) : p.lineTo(x, y)));
    if (s.closed) p.closePath();
    paint(p, { ...s, draw: undefined });
  }
  function line(x1: number, y1: number, x2: number, y2: number, s: ShapeStyle = {}): void {
    path(
      [
        [x1, y1],
        [x2, y2],
      ],
      { stroke: palette.ink, ...s },
    );
  }

  /** Fill a rect (default the frame) with a gradient, dithered so 8-bit steps do not band. */
  function gradient(spec: GradientSpec, r: Rect = { x: 0, y: 0, w: W, h: H }): void {
    let g: CanvasGradient;
    if (spec.radial) {
      const cx = r.x + r.w * (spec.radial.cx ?? 0.5);
      const cy = r.y + r.h * (spec.radial.cy ?? 0.5);
      g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(r.w, r.h) * (spec.radial.r ?? 0.75));
    } else {
      const a = ((spec.angle ?? 90) * Math.PI) / 180;
      const len = Math.abs(r.w * Math.cos(a)) + Math.abs(r.h * Math.sin(a));
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      g = ctx.createLinearGradient(cx - (Math.cos(a) * len) / 2, cy - (Math.sin(a) * len) / 2, cx + (Math.cos(a) * len) / 2, cy + (Math.sin(a) * len) / 2);
    }
    for (const [at, color] of spec.stops) g.addColorStop(clamp01(at), color);
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.restore();
    const amount = spec.dither ?? 1;
    if (amount > 0) noise(r, 0.045 * amount, false);
  }

  /** A seeded grey-noise tile (256 px), overlaid: dither on gradients, grain on the frame. */
  const tile = (): HTMLCanvasElement => {
    if (noiseTile) return noiseTile;
    const c = Object.assign(doc.createElement("canvas"), { width: 256, height: 256 });
    const g = c.getContext("2d")!;
    const img = g.createImageData(256, 256);
    const next = mulberry32(hashInts(host.seed, 7919));
    for (let i = 0; i < 256 * 256; i += 1) {
      const v = Math.round(next() * 255);
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    noiseTile = c;
    return c;
  };
  function noise(r: Rect, amount: number, animated: boolean): void {
    const pattern = ctx.createPattern(tile(), "repeat");
    if (!pattern) return;
    const frame = Math.floor(state.t);
    const ox = animated ? Math.floor(random01(host.seed, frame, 1) * 256) : 0;
    const oy = animated ? Math.floor(random01(host.seed, frame, 2) * 256) : 0;
    pattern.setTransform(new DOMMatrix([1 / host.scale, 0, 0, 1 / host.scale, ox / host.scale, oy / host.scale]));
    ctx.save();
    ctx.globalAlpha *= clamp01(amount);
    ctx.globalCompositeOperation = host.alpha ? "source-atop" : "overlay";
    ctx.fillStyle = pattern;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  const mediaRef = (name: string): SceneMediaRef => {
    const ref = host.media[name];
    if (!ref) throw new Error(`no media named "${name}" (media: ${Object.keys(host.media).join(", ") || "none"}; pass it in the tool's media)`);
    return ref;
  };
  const drawFit = (img: HTMLImageElement, iw: number, ih: number, x: number, y: number, w: number, h: number, o: { fit?: "cover" | "contain"; radius?: number; opacity?: number; zoom?: number; focus?: [number, number] }): void => {
    ctx.save();
    if (o.opacity !== undefined) ctx.globalAlpha *= o.opacity;
    if (o.radius) {
      ctx.beginPath();
      roundRectPath(ctx, x, y, w, h, o.radius);
      ctx.clip();
    }
    const k = (o.fit === "contain" ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih)) * (o.zoom ?? 1);
    const dw = iw * k;
    const dh = ih * k;
    const [fx, fy] = o.focus ?? [0.5, 0.5];
    ctx.drawImage(img, x + (w - dw) * fx, y + (h - dh) * fy, dw, dh);
    ctx.restore();
  };
  interface MediaOptions {
    fit?: "cover" | "contain";
    radius?: number;
    opacity?: number;
    /** Extra zoom on the picture inside its rect (a slow push: tween it). */
    zoom?: number;
    /** Which part stays in frame when cropping, 0..1 (default the centre). */
    focus?: [number, number];
  }
  /** A photo from the project's media, fitted into the rect. */
  function image(name: string, x: number, y: number, w: number, h: number, o: MediaOptions = {}): void {
    const ref = mediaRef(name);
    const url = ref.kind === "image" ? ref.url : ref.pattern.replace("{n}", "1".padStart(5, "0"));
    const img = host.image(url);
    if (img) drawFit(img, ref.width, ref.height, x, y, w, h, o);
  }
  /** The frame of a video shown at this time: it starts at `from` (default 0) and plays at `rate`. */
  function video(name: string, x: number, y: number, w: number, h: number, o: MediaOptions & { from?: When; rate?: number } = {}): void {
    const ref = mediaRef(name);
    if (ref.kind === "image") return image(name, x, y, w, h, o);
    const seconds = Math.max(0, (state.t - (o.from === undefined ? 0 : frameOf(o.from))) / host.fps) * (o.rate ?? 1);
    const n = Math.min(ref.frames - 1, Math.floor(seconds * ref.fps + 1e-6));
    const img = host.image(ref.pattern.replace("{n}", String(n + 1).padStart(5, "0")));
    if (img) drawFit(img, ref.width, ref.height, x, y, w, h, o);
  }

  /** The base camera for this frame: everything drawn in `layer` moves with it. */
  function camera(c: Partial<CameraState>): void {
    state.camera = { zoom: c.zoom ?? 1, x: c.x ?? 0, y: c.y ?? 0, rotate: c.rotate ?? 0 };
  }
  /**
   * Draw under the camera at a parallax depth: 1 moves with it, 0.3 is far
   * background, 0 is a HUD that never moves. Hit punches and shakes join
   * the camera when `hitFx` is on.
   */
  function layer(depth: number, fn: () => void): void {
    const cam = state.camera;
    let zoom = 1 + (cam.zoom - 1) * depth;
    let x = cam.x * depth;
    let y = cam.y * depth;
    if (state.hitFx) {
      const hc = hitCamera(hits, state.t / host.fps, HIT_LOOKS[state.hitFx.look].punch);
      zoom *= 1 + (hc.zoom - 1) * depth;
      x += hc.x * depth;
      y += hc.y * depth;
    }
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate((cam.rotate * depth * Math.PI) / 180);
    ctx.scale(zoom, zoom);
    ctx.translate(-W / 2 - x, -H / 2 - y);
    try {
      fn();
    } finally {
      ctx.restore();
    }
  }

  /** Press envelope of a click on `at`: 0 → 1 over 4 frames, back over 8 (cursor squash, button press). */
  const press = (at: When): number => {
    const u = state.t - frameOf(at);
    if (u < -4 || u > 8) return 0;
    return u < 0 ? 1 + u / 4 : 1 - u / 8;
  };
  /**
   * The part of `str` typed by now, from `from`: at `pace` characters a
   * second (default 18), or spread evenly to finish on a cue or frame
   * (`{ until: "click" }`), so the keys end where the typing cue ends.
   */
  const typed = (str: string, from: When, pace: number | { until: When } = 18): string => {
    const chars = [...str];
    const start = frameOf(from);
    const n = typeof pace === "number" ? Math.floor(Math.max(0, ((state.t - start) / host.fps) * pace)) : Math.floor(chars.length * clamp01((state.t - start) / Math.max(1, frameOf(pace.until) - start)));
    return chars.slice(0, n).join("");
  };

  const ui = {
    /** An app window: shadowed panel and a title bar with the three dots. Returns its content rect. */
    window(o: Rect & { title?: string; radius?: number; fill?: string; bar?: boolean; opacity?: number; dark?: boolean }): Rect {
      const radius = o.radius ?? 26;
      const fill = o.fill ?? palette.surface;
      rect(o.x, o.y, o.w, o.h, { radius, fill, shadow: { blur: 60, y: 24, color: "rgba(10,10,20,0.22)" }, opacity: o.opacity });
      rect(o.x, o.y, o.w, o.h, { radius, stroke: palette.line, lineWidth: 1.5, opacity: o.opacity });
      if (o.bar === false) return { x: o.x, y: o.y, w: o.w, h: o.h };
      const barH = 56;
      ["#FF5F57", "#FEBC2E", "#28C840"].forEach((c, i) => circle(o.x + 30 + i * 22, o.y + barH / 2, 7, { fill: c, opacity: o.opacity }));
      if (o.title) text(o.title, { x: o.x + o.w / 2, y: o.y + barH / 2, size: minText, weight: 600, align: "center", color: palette.muted, ui: true, id: `window:${o.title}`, opacity: o.opacity });
      line(o.x, o.y + barH, o.x + o.w, o.y + barH, { stroke: palette.line, lineWidth: 1.5, opacity: o.opacity });
      return { x: o.x, y: o.y + barH, w: o.w, h: o.h - barH };
    },
    card(o: Rect & { radius?: number; fill?: string; stroke?: string; opacity?: number; shadow?: boolean }): Rect {
      rect(o.x, o.y, o.w, o.h, { radius: o.radius ?? 28, fill: o.fill ?? palette.surface, opacity: o.opacity, ...(o.shadow === false ? {} : { shadow: { blur: 40, y: 16, color: "rgba(10,10,20,0.16)" } }) });
      if (o.stroke) rect(o.x, o.y, o.w, o.h, { radius: o.radius ?? 28, stroke: o.stroke, lineWidth: 1.5, opacity: o.opacity });
      return { x: o.x, y: o.y, w: o.w, h: o.h };
    },
    /** The pointer, its tip at x,y; `click` names the cue it clicks on (squash and a ring). */
    cursor(o: { x: number; y: number; click?: When; scale?: number; color?: string; opacity?: number }): void {
      const p = o.click !== undefined ? press(o.click) : 0;
      const s = (o.scale ?? 1.6) * (1 - 0.12 * p);
      if (o.click !== undefined) {
        const u = state.t - frameOf(o.click);
        if (u >= 0 && u < 18) circle(o.x, o.y, 10 + u * 3.2, { stroke: o.color ?? palette.accent, lineWidth: 3, opacity: (1 - u / 18) * 0.7 * (o.opacity ?? 1) });
      }
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.scale(s, s);
      paint(path2d(ARROW), { fill: o.color ?? "#0B0B0F", stroke: "#FFFFFF", lineWidth: 2.2, shadow: { blur: 10, y: 3, color: "rgba(0,0,0,0.28)" }, opacity: o.opacity });
      ctx.restore();
    },
    /** A switch; `on` is 0..1 (tween it from the click cue). */
    toggle(o: { x: number; y: number; on: number; w?: number; h?: number; accent?: string; opacity?: number }): void {
      const w = o.w ?? 104;
      const h = o.h ?? 60;
      const on = clamp01(o.on);
      rect(o.x, o.y, w, h, { radius: h / 2, fill: on > 0.5 ? (o.accent ?? palette.accent) : palette.line, opacity: o.opacity });
      const r = h / 2 - 5;
      circle(o.x + h / 2 + (w - h) * on, o.y + h / 2, r, { fill: "#FFFFFF", shadow: { blur: 8, y: 2 }, opacity: o.opacity });
    },
    /** A text field with typed text and a blinking caret (`typed(str, from)` gives the text so far). */
    field(o: Rect & { text: string; placeholder?: string; caret?: boolean; size?: number; radius?: number; font?: FontRole; opacity?: number }): void {
      rect(o.x, o.y, o.w, o.h, { radius: o.radius ?? o.h / 2, fill: palette.surface, shadow: { blur: 24, y: 8, color: "rgba(10,10,20,0.12)" }, opacity: o.opacity });
      rect(o.x, o.y, o.w, o.h, { radius: o.radius ?? o.h / 2, stroke: palette.line, lineWidth: 1.5, opacity: o.opacity });
      const size = o.size ?? Math.max(minText, Math.round(o.h * 0.36));
      const pad = Math.max(28, o.h * 0.4);
      const shown = o.text || o.placeholder || "";
      const font = o.font ?? "sans";
      // A line longer than the field scrolls, as a real input does: its end stays in view.
      const room = o.w - 2 * pad - 8;
      const full = shown ? measure(shown, { size, font, weight: 500 }) : 0;
      const tx = o.x + pad - Math.max(0, full - room);
      const w = shown ? text(shown, { x: tx, y: o.y + o.h / 2, size, font, weight: 500, color: o.text ? palette.ink : palette.muted, ui: true, id: "field", opacity: o.opacity, clip: { x: o.x + pad / 2, y: o.y, w: o.w - pad, h: o.h } }).w : 0;
      if (o.caret !== false && Math.floor(state.t / (host.fps * 0.5)) % 2 === 0) rect(tx + (o.text ? w + 4 : 0), o.y + o.h / 2 - size * 0.6, 3, size * 1.2, { fill: palette.accent, opacity: o.opacity });
    },
    /** Rows that arrive one after another from `from`, `gap` frames apart; `selected` highlights one. */
    list(o: { x: number; y: number; w: number; items: readonly string[]; from: When; gap?: number; rowH?: number; selected?: number; size?: number }): void {
      const rowH = o.rowH ?? 92;
      o.items.forEach((item, i) => {
        const p = prog(frameOf(o.from) + i * (o.gap ?? 5), 16);
        if (p <= 0) return;
        const y = o.y + i * rowH + (1 - p) * 24;
        rect(o.x, y, o.w, rowH - 14, { radius: 20, fill: i === o.selected ? palette.accent : palette.surface, opacity: p, shadow: { blur: 18, y: 6, color: "rgba(10,10,20,0.10)" } });
        text(item, { x: o.x + 32, y: y + (rowH - 14) / 2, size: o.size ?? Math.max(minText, 34), weight: 600, color: i === o.selected ? palette.paper : palette.ink, opacity: p, ui: true, id: `list:${i}` });
      });
    },
    /** Bars or a line growing to `values` (0..1 of the height) as `grow` goes 0 → 1. */
    chart(o: Rect & { values: readonly number[]; grow: number; kind?: "bar" | "line"; color?: string }): void {
      const n = o.values.length;
      if (n === 0) return;
      const color = o.color ?? palette.accent;
      if (o.kind === "line") {
        const pts = o.values.map((v, i): Pt => [o.x + (o.w * i) / Math.max(1, n - 1), o.y + o.h * (1 - clamp01(v))]);
        path(pts, { stroke: color, lineWidth: 6, draw: clamp01(o.grow) });
        return;
      }
      const gap = (o.w / n) * 0.28;
      const bw = o.w / n - gap;
      o.values.forEach((v, i) => {
        const p = EASES.out(clamp01(o.grow * 1.4 - (i / n) * 0.4));
        const bh = o.h * clamp01(v) * p;
        rect(o.x + i * (bw + gap) + gap / 2, o.y + o.h - bh, bw, bh, { radius: Math.min(14, bw / 2), fill: color });
      });
    },
    /** A number rolling from `from` to `to` as `progress` goes 0 → 1. */
    counter(o: TextOptions & NumberFormat & { from?: number; to: number; progress: number }): { w: number; h: number } {
      const v = lerp(o.from ?? 0, o.to, clamp01(o.progress));
      const str = formatNumber(v, { decimals: o.decimals ?? 0, prefix: o.prefix, suffix: o.suffix, separator: o.separator });
      return text(str, { ...o, id: o.id ?? "counter" });
    },
    button(o: Rect & { label: string; click?: When; fill?: string; color?: string; size?: number }): void {
      const p = o.click !== undefined ? press(o.click) : 0;
      const s = 1 - 0.06 * p;
      ctx.save();
      ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
      ctx.scale(s, s);
      rect(-o.w / 2, -o.h / 2, o.w, o.h, { radius: o.h / 2, fill: o.fill ?? palette.ink, shadow: { blur: 20, y: 8 } });
      text(o.label, { x: 0, y: 0, size: o.size ?? Math.max(minText, Math.round(o.h * 0.38)), weight: 600, align: "center", color: o.color ?? palette.paper, ui: true, id: `button:${o.label}` });
      ctx.restore();
    },
  };

  const api = Object.freeze({
    /** Design size: the shorter side is 1080. */
    W,
    H,
    portrait: H > W * 1.2,
    fps: host.fps,
    duration: host.duration,
    /** Title-safe insets, design px (9:16 keeps text out of the top 12 % and bottom 20 %). */
    safe: Object.freeze(safeArea(W, H)),
    /** The params (the tools' over the module's defaults). */
    p: Object.freeze({ ...host.params }) as Readonly<Record<string, unknown>>,
    palette: Object.freeze({ ...palette }),
    /** Frame of a cue. */
    cue: frameOf,
    /** Frames since a cue (negative before it). */
    since: (when: When): number => state.t - frameOf(when),
    /** Eased 0..1 progress from `from` over `dur` frames (default ease `out`). */
    prog,
    /** A number from a to b over [from, from + dur]. */
    tween: (from: When, dur: number, a: number, b: number, ease?: EaseSpec): number => lerp(a, b, prog(from, dur, ease)),
    /** Element i of a staggered group. */
    stagger: (i: number, from: When, gap: number, dur: number, ease?: EaseSpec): number => prog(frameOf(from) + i * gap, dur, ease),
    ease: (name: EaseName): Ease => easeOf(name),
    /** A spring that settles exactly at progress 1: mass, stiffness, damping. */
    spring: (o: SpringOptions = {}): Ease => springEase(o),
    /** A number in [0, 1) fixed by its keys (the same every frame and every render). */
    rng: (...keys: number[]): number => random01(host.seed, ...keys.map((k) => Math.round(k * 1000))),
    /** Smooth noise in [-1, 1]. */
    noise: (x: number, seed = 0): number => noise1(x, seed),
    press,
    typed,
    lerp,
    clamp01,
    text,
    measure,
    rect,
    circle,
    path,
    line,
    gradient,
    image,
    video,
    camera,
    layer,
    ui: Object.freeze(ui),
    /** Land the cues that carry `hit` with a punch-in, a shake, aberration, a flash and bloom (runtime/kinetic.ts). */
    hitFx: (o: { look?: HitLookName; bloom?: number } = {}): void => {
      state.hitFx = { look: o.look ?? "clean", bloom: o.bloom ?? 0 };
    },
    /** Film grain over the finished frame (0.04-0.1 reads as grain; animated by default). */
    grain: (amount = 0.06, animated = true): void => {
      state.grain = { amount, animated };
    },
  });

  return {
    api,
    /** Reset the canvas and the frame state for frame t (scene frames). */
    begin(t: number): void {
      ctx.reset();
      ctx.setTransform(host.scale, 0, 0, host.scale, 0, 0);
      if (!host.alpha) {
        ctx.fillStyle = palette.paper;
        ctx.fillRect(0, 0, W, H);
      }
      state.t = t;
      state.boxes = [];
      state.camera = { zoom: 1, x: 0, y: 0, rotate: 0 };
      state.hitFx = null;
      state.grain = null;
    },
    /** Apply the finish the scene asked for; the frame's text boxes. */
    end(): TextBox[] {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      if (state.hitFx) {
        const look = HIT_LOOKS[state.hitFx.look];
        const f = hitFinish(hits, state.t / host.fps, look, state.hitFx.bloom);
        // Aberration recomposes the channels over black: a transparent scene keeps only the flash and bloom.
        if (f.chroma > 0 || f.flash > 0.004 || f.bloom > 0.01) {
          const { width, height } = host.canvas;
          copy ??= Object.assign(doc.createElement("canvas"), { width, height });
          finish ??= finishBuffers(doc, width, height, host.alpha ? 0 : look.vignette);
          const cg = copy.getContext("2d")!;
          cg.globalCompositeOperation = "copy";
          cg.drawImage(host.canvas, 0, 0);
          cg.globalCompositeOperation = "source-over";
          ctx.clearRect(0, 0, width, height);
          applyFinish(ctx, copy, finish, { ...f, chroma: host.alpha ? 0 : f.chroma, lightGround: !palette.dark });
        }
      }
      if (state.grain) {
        ctx.setTransform(host.scale, 0, 0, host.scale, 0, 0);
        noise({ x: 0, y: 0, w: W, h: H }, state.grain.amount, state.grain.animated);
      }
      return state.boxes;
    },
  };
}
