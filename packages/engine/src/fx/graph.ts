/**
 * Zenvi FX filtergraphs: one ffmpeg `-filter_complex` per FX stack.
 *
 * The graph reads input 0 (the source, already cut to the clip's range with
 * `-ss`/`-t`), works in planar RGB (`gbrp`, `gbrap` with alpha) so blends
 * mean what they say, chains the effects in order and ends in
 * `[vout]` (yuv422p10le, yuva444p10le with alpha: ProRes 422 HQ / 4444) and,
 * with audio, `[aout]`. Everything is built from the parsed stack and the
 * source's size, rate and length, nothing else (seeded effects use their
 * own PRNG): the same stack always builds the same text, so the text is part
 * of the render fingerprint. Bump FX_RENDERER_VERSION when a builder's
 * output changes for the same input.
 *
 * Pixel sizes are tuned at 1080 lines and scale with the short side.
 * Windowed effects run on [start - lookback, end) and are cut back in with
 * trim + concat, which keeps alpha and every frame exact.
 */

import { FX_INFO, slowmoSpeed, type FxEffect } from "./catalog.js";

export const FX_RENDERER_VERSION = 1;

export interface FxGraphInput {
  width: number;
  height: number;
  fps: { num: number; den: number };
  /** Seconds of source the graph reads. */
  duration: number;
  /** The source has an alpha channel (render ProRes 4444). */
  alpha: boolean;
  /** The source has audio (map it to `[aout]`). */
  audio: boolean;
  /** Sample aspect ratio (default 1:1). The graph works on square pixels and puts it back at the end. */
  sar?: { num: number; den: number };
}

export interface FxGraph {
  filterComplex: string;
  /** `[aout]` when the graph carries the audio, else null (copy input audio, if any). */
  audioLabel: string | null;
  /** Seconds the render lasts (longer than the source with slow motion). */
  duration: number;
  /** Output pixel format for the encoder. */
  pixelFormat: "yuv422p10le" | "yuva444p10le";
}

class Graph {
  readonly chains: string[] = [];
  private n = 0;
  constructor(readonly ctx: FxGraphInput) {}
  label(prefix = "v"): string {
    return `${prefix}${this.n++}`;
  }
  add(chain: string): void {
    this.chains.push(chain);
  }
  /** Fan `input` out to `count` new labels. */
  split(input: string, count: number): string[] {
    const outs = Array.from({ length: count }, () => this.label("s"));
    this.add(`[${input}]split=${count}${outs.map((o) => `[${o}]`).join("")}`);
    return outs;
  }
  get work(): string {
    return this.ctx.alpha ? "gbrap" : "gbrp";
  }
  /** Pixels per 1080p pixel. */
  get k(): number {
    return Math.min(this.ctx.width, this.ctx.height) / 1080;
  }
  get rate(): string {
    return `${this.ctx.fps.num}/${this.ctx.fps.den}`;
  }
  /** A generated layer (a solid of the frame's size) for `[start, end)` seconds. */
  solid(width: number, height: number, start: number, end: number): string {
    const out = this.label("c");
    const trim = start > 0 ? `,trim=start=${num(start)}` : "";
    this.add(`color=c=black:s=${width}x${height}:r=${this.rate}:d=${num(end)},format=gbrp${trim}[${out}]`);
    return out;
  }
  /** Blend `top` into `base` (first input wins outside the blend; alpha passes through). */
  blend(base: string, top: string, mode: string, opacity: number): string {
    const out = this.label();
    const keepAlpha = this.ctx.alpha ? ":c3_mode=normal:c3_opacity=0" : "";
    this.add(`[${base}][${top}]blend=all_mode=${mode}:all_opacity=${num(clamp(opacity, 0, 1))}${keepAlpha}:shortest=1[${out}]`);
    return out;
  }
  /** `chain` over the whole of `input`, then blended back with `amount` (1 = all effect). */
  mixed(input: string, amount: number, build: (src: string) => string): string {
    if (amount >= 0.999) return build(input);
    const [a, b] = this.split(input, 2);
    return this.blend(a!, build(b!), "normal", amount);
  }
}

/** Window the graph's effects see: `[from, to)` seconds of the stream. */
interface Span {
  from: number;
  to: number;
}

type Builder<F extends FxEffect["effect"]> = (g: Graph, input: string, effect: FxEffect<F>, span: Span) => string;

const BUILDERS: { [F in FxEffect["effect"]]: Builder<F> } = {
  radial_blur: radialBlur,
  directional_blur: (g, input, e) => {
    const out = g.label();
    const radius = (3 + 70 * e.amount) * g.k;
    g.add(`[${input}]dblur=angle=${num(e.params.angle)}:radius=${num(radius)}[${out}]`);
    return out;
  },
  echo: (g, input, e) => {
    const out = g.label();
    if (e.params.style === "trails") {
      g.add(`[${input}]lagfun=decay=${num(0.86 + 0.12 * e.amount)}[${out}]`);
      return out;
    }
    // tmix weights run oldest frame first: the current frame weighs most, older ones fade.
    const frames = 2 + Math.round(e.amount * 8);
    const decay = 0.45 + 0.35 * e.amount;
    const weights = Array.from({ length: frames }, (_, i) => num(decay ** (frames - 1 - i))).join(" ");
    g.add(`[${input}]tmix=frames=${frames}:weights='${weights}'[${out}]`);
    return out;
  },
  chromatic_aberration: chromaticAberration,
  bloom: bloom,
  glitch: glitch,
  pixel_sort: pixelSort,
  halftone: halftone,
  dither: dither,
  mirror: mirror,
  optical_flow_slowmo: (g, input, e) => {
    const out = g.label();
    const speed = slowmoSpeed(e);
    const interp =
      e.params.method === "flow" && !g.ctx.alpha
        ? `format=yuv444p,minterpolate=fps=${g.rate}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,format=${g.work}`
        : `framerate=fps=${g.rate}:interp_start=0:interp_end=255:scene=100`;
    g.add(`[${input}]setpts=PTS/${num(speed, 6)},${interp}[${out}]`);
    return out;
  },
  vignette: vignette,
  light_leak: lightLeak,
};

/** The filtergraph of a parsed FX stack (see the module comment). */
export function buildFxGraph(effects: readonly FxEffect[], ctx: FxGraphInput): FxGraph {
  const g = new Graph(ctx);
  let cur = g.label();
  g.add(`[0:v]setpts=PTS-STARTPTS,format=${g.work},setsar=1[${cur}]`);
  for (const effect of effects) cur = applyEffect(g, cur, effect);
  const pixelFormat = ctx.alpha ? "yuva444p10le" : "yuv422p10le";
  const sar = ctx.sar && ctx.sar.num > 0 && ctx.sar.den > 0 ? `${ctx.sar.num}/${ctx.sar.den}` : "1";
  g.add(`[${cur}]format=${pixelFormat},setsar=${sar}[vout]`);

  const slow = effects.find((e): e is FxEffect<"optical_flow_slowmo"> => e.effect === "optical_flow_slowmo");
  const speed = slow ? slowmoSpeed(slow) : 1;
  let audioLabel: string | null = null;
  if (ctx.audio && slow) {
    g.add(`[0:a]asetpts=PTS-STARTPTS,${atempoChain(speed)}[aout]`);
    audioLabel = "aout";
  }
  return { filterComplex: g.chains.join(";"), audioLabel, duration: round(ctx.duration / speed), pixelFormat };
}

function applyEffect(g: Graph, input: string, effect: FxEffect): string {
  const build = BUILDERS[effect.effect] as Builder<FxEffect["effect"]>;
  const { duration } = g.ctx;
  if (effect.start === undefined && effect.end === undefined) return build(g, input, effect, { from: 0, to: duration });
  const start = effect.start ?? 0;
  const end = Math.min(effect.end ?? duration, duration);
  const from = Math.max(0, start - FX_INFO[effect.effect].lookbackSeconds);
  const parts: string[] = [];
  const branches = g.split(input, 1 + (start > 0 ? 1 : 0) + (end < duration ? 1 : 0));
  let b = 0;
  if (start > 0) {
    const pre = g.label();
    g.add(`[${branches[b++]}]trim=end=${num(start)},setpts=PTS-STARTPTS[${pre}]`);
    parts.push(pre);
  }
  const fxIn = g.label();
  g.add(`[${branches[b++]}]trim=start=${num(from)}:end=${num(end)}[${fxIn}]`);
  const fxOut = build(g, fxIn, effect, { from, to: end });
  const mid = g.label();
  g.add(`[${fxOut}]trim=start=${num(start)},setpts=PTS-STARTPTS[${mid}]`);
  parts.push(mid);
  if (end < duration) {
    const post = g.label();
    g.add(`[${branches[b++]}]trim=start=${num(end)},setpts=PTS-STARTPTS[${post}]`);
    parts.push(post);
  }
  if (parts.length === 1) return parts[0]!;
  const out = g.label();
  g.add(`${parts.map((p) => `[${p}]`).join("")}concat=n=${parts.length}:v=1:a=0[${out}]`);
  return out;
}

/** Scale `input` up by `zoom` about (cx, cy) and crop back to the frame. */
function zoomed(g: Graph, input: string, zoom: number, cx: number, cy: number): string {
  const { width: w, height: h } = g.ctx;
  const sw = even(w * zoom);
  const sh = even(h * zoom);
  const out = g.label();
  g.add(`[${input}]scale=${sw}:${sh}:flags=bilinear,crop=${w}:${h}:${Math.round((sw - w) * cx)}:${Math.round((sh - h) * cy)},setsar=1[${out}]`);
  return out;
}

/**
 * Zoom blur by repeated halving: each pass averages the picture with itself
 * zoomed by the square root of the previous pass's zoom, so four passes
 * give 16 evenly spread taps for the cost of four scales.
 */
function radialBlur(g: Graph, input: string, e: FxEffect<"radial_blur">): string {
  const total = 1 + 0.2 * e.amount;
  let cur = input;
  for (let pass = 1; pass <= 4; pass++) {
    const zoom = total ** (1 / 2 ** pass);
    const [a, b] = g.split(cur, 2);
    const z = zoomed(g, b!, zoom, e.params.center_x, e.params.center_y);
    const out = g.label();
    g.add(`[${a}][${z}]blend=all_mode=average[${out}]`);
    cur = out;
  }
  return cur;
}

/** Red scaled out from the lens centre, green half as much, blue in place: fringes grow toward the edges. */
function chromaticAberration(g: Graph, input: string, e: FxEffect<"chromatic_aberration">): string {
  const s = 0.004 + 0.03 * e.amount;
  const { center_x: cx, center_y: cy } = e.params;
  const [gIn, bIn, rIn] = g.split(input, 3);
  const gs = zoomed(g, gIn!, 1 + s / 2, cx, cy);
  const rs = zoomed(g, rIn!, 1 + s, cx, cy);
  const out = g.label();
  // gbrp planes are G, B, R (+ A): G from the first input, B from the second, R from the third.
  const mapping = g.ctx.alpha ? "0x00112213" : "0x001122";
  g.add(`[${gs}][${bIn}][${rs}]mergeplanes=${mapping}:${g.work}[${out}]`);
  return out;
}

/** Highlights above the threshold, blurred at two sizes at quarter resolution, screened back over. */
function bloom(g: Graph, input: string, e: FxEffect<"bloom">): string {
  const { width: w, height: h } = g.ctx;
  const t = clamp(e.params.threshold, 0, 0.98);
  const qw = even(w / 4);
  const qh = even(h / 4);
  const sigma = (3 + 14 * e.params.radius) * g.k;
  const [base, hi] = g.split(input, 2);
  const lit = g.label();
  g.add(`[${hi}]format=gbrp,curves=all='0/0 ${num(t)}/0 1/1',scale=${qw}:${qh}:flags=area[${lit}]`);
  const [near, far] = g.split(lit, 2);
  const n = g.label();
  const f = g.label();
  g.add(`[${near}]gblur=sigma=${num(sigma)}[${n}]`);
  g.add(`[${far}]gblur=sigma=${num(sigma * 3.5)}[${f}]`);
  const glow = g.label();
  const gain = num(1 + 1.2 * e.amount);
  g.add(`[${n}][${f}]blend=all_mode=addition,colorchannelmixer=rr=${gain}:gg=${gain}:bb=${gain},scale=${w}:${h}:flags=bicubic${g.ctx.alpha ? ",format=gbrap" : ""}[${glow}]`);
  return g.blend(base!, glow, "screen", 0.5 + 0.5 * e.amount);
}

/**
 * Seeded bursts. Each burst shifts a few horizontal slices and blocks
 * sideways (a displacement map drawn by geq at 1/8 size, ±127 px is
 * displace's range) and some split the RGB channels.
 */
function glitch(g: Graph, input: string, e: FxEffect<"glitch">, span: Span): string {
  const { width: w, height: h } = g.ctx;
  const rand = mulberry32(e.params.seed);
  const frame = g.ctx.fps.den / g.ctx.fps.num;
  const length = span.to - span.from;
  const count = Math.max(1, Math.min(40, Math.round(length * e.params.rate)));
  const mw = Math.max(8, Math.round(w / 8));
  const mh = Math.max(8, Math.round(h / 8));
  const maxShift = Math.min(127, Math.round((40 + 110 * e.amount) * g.k));
  const xTerms: string[] = [];
  const yTerms: string[] = [];
  const splits: string[] = [];
  for (let i = 0; i < count; i++) {
    const t0 = span.from + rand() * length;
    const t1 = t0 + frame * (2 + Math.floor(rand() * 4));
    const when = `between(T,${num(t0)},${num(t1)})`;
    const slices = 2 + Math.floor(rand() * (2 + 5 * e.amount));
    for (let s = 0; s < slices; s++) {
      const block = rand() < 0.35;
      const y0 = Math.floor(rand() * mh);
      const y1 = Math.min(mh - 1, y0 + 1 + Math.floor(rand() * mh * (block ? 0.2 : 0.12)));
      const x0 = block ? Math.floor(rand() * mw * 0.8) : 0;
      const x1 = block ? Math.min(mw - 1, x0 + 2 + Math.floor(rand() * mw * 0.3)) : mw - 1;
      const dx = Math.round((rand() < 0.5 ? -1 : 1) * (0.35 + 0.65 * rand()) * maxShift);
      const rect = `${when}*between(X,${x0},${x1})*between(Y,${y0},${y1})`;
      xTerms.push(`${dx}*${rect}`);
      if (block) yTerms.push(`${Math.round((rand() * 2 - 1) * maxShift * 0.5)}*${rect}`);
    }
    if (rand() < 0.75) {
      const shift = Math.round((8 + 40 * e.amount) * g.k * (0.5 + rand()));
      splits.push(`rgbashift=rh=${shift}:bh=${-shift}:rv=${Math.round(shift / 4)}:enable='${when.replace("T", "t")}'`);
    }
  }
  const map = (terms: string[]): string => {
    const solid = g.solid(mw, mh, span.from, span.to);
    const out = g.label("m");
    const expr = terms.length > 0 ? `clip(128+${terms.join("+")},0,255)` : "128";
    g.add(`[${solid}]format=gray,geq=lum='${expr}',scale=${w}:${h}:flags=neighbor,format=${g.work}[${out}]`);
    return out;
  };
  const xm = map(xTerms);
  const ym = map(yTerms);
  const out = g.label();
  g.add(`[${input}][${xm}][${ym}]displace=edge=wrap${splits.length > 0 ? `,${splits.join(",")}` : ""}[${out}]`);
  return out;
}

/**
 * Approximate pixel sort: a one-way smear (bright pixels dragged along the
 * direction by a directional blur pushed ahead of itself) shown only where
 * the source is brighter than the threshold.
 */
function pixelSort(g: Graph, input: string, e: FxEffect<"pixel_sort">): string {
  const { width: w, height: h } = g.ctx;
  const len = Math.round((40 + 260 * e.amount) * g.k);
  const vertical = e.params.direction === "down" || e.params.direction === "up";
  const angle = { down: 90, up: 270, right: 0, left: 180 }[e.params.direction];
  // Shift the smear by half its length so it trails from the bright pixel instead of centring on it.
  const half = Math.round(len / 2);
  const shift = {
    down: `pad=${w}:${h + half}:0:${half},crop=${w}:${h}:0:0`,
    up: `pad=${w}:${h + half}:0:0,crop=${w}:${h}:0:${half}`,
    right: `pad=${w + half}:${h}:${half}:0,crop=${w}:${h}:0:0`,
    left: `pad=${w + half}:${h}:0:0,crop=${w}:${h}:${half}:0`,
  }[e.params.direction];
  const [base, src, key] = g.split(input, 3);
  const smear = g.label();
  g.add(`[${src}]dblur=angle=${angle}:radius=${len},${shift},eq=contrast=1.25:saturation=1.3[${smear}]`);
  const keyed = g.label();
  const t = clamp(e.params.threshold, 0.02, 0.98);
  // The mask also smears, so the sorted streaks run past the bright region's edge.
  g.add(
    `[${key}]format=gray,curves=all='0/0 ${num(t - 0.02)}/0 ${num(t + 0.02)}/1 1/1',` +
      `dblur=angle=${angle}:radius=${Math.round(len / 3)},${shift},curves=all='0/0 0.15/1 1/1'[${keyed}]`,
  );
  // Per-line strengths (a fixed hash of the column or row) give the streaks a sorted, striated grain.
  const lines = vertical ? `s=${w}x1` : `s=1x${h}`;
  const coord = vertical ? "X" : "Y";
  const grain = g.label("m");
  g.add(
    `color=c=black:${lines}:r=${g.rate}:d=${num(g.ctx.duration)},format=gray,` +
      `geq=lum='st(0,abs(sin(${coord}*12.9898+${num(t * 7)})*43758.5453));255*(0.15+0.85*(ld(0)-floor(ld(0))))',` +
      `scale=${w}:${h}:flags=neighbor[${grain}]`,
  );
  const mask = g.label();
  g.add(`[${keyed}][${grain}]blend=all_mode=multiply:shortest=1,format=${g.work}[${mask}]`);
  const out = g.label();
  g.add(`[${base}][${smear}][${mask}]maskedmerge[${out}]`);
  return out;
}

/** Dots on a 45-degree grid, area by darkness, anti-aliased (geq on the luma), coloured ink on paper. */
function halftone(g: Graph, input: string, e: FxEffect<"halftone">): string {
  return g.mixed(input, e.amount, (src) => {
    const cell = Math.max(3, e.params.cell * g.k);
    const c = Math.SQRT1_2;
    // Cell coordinates on the rotated grid, the cell's centre back in pixels, then distance to it.
    const u = `(X*${num(c)}+Y*${num(c)})/${num(cell)}`;
    const v = `(Y*${num(c)}-X*${num(c)})/${num(cell)}`;
    const expr =
      `st(0,floor(${u})+0.5);st(1,floor(${v})+0.5);` +
      `st(2,(ld(0)*${num(c)}-ld(1)*${num(c)})*${num(cell)});st(3,(ld(0)*${num(c)}+ld(1)*${num(c)})*${num(cell)});` +
      `st(4,${num(cell * 0.62)}*sqrt(1-lum(clip(ld(2),0,W-1),clip(ld(3),0,H-1))/255));` +
      `255*clip(hypot(X-ld(2),Y-ld(3))-ld(4)+0.5,0,1)`;
    const mask = g.label();
    g.add(`[${src}]format=gray,gblur=sigma=${num(cell / 3)},geq=lum='${expr}',format=${g.work}[${mask}]`);
    const [ink, paper] = [e.params.ink, e.params.paper].map((hexColor) => {
      const out = g.label("c");
      g.add(`color=c=0x${hexColor.slice(1)}:s=${g.ctx.width}x${g.ctx.height}:r=${g.rate}:d=${num(g.ctx.duration)},format=${g.work}[${out}]`);
      return out;
    });
    const out = g.label();
    g.add(`[${ink}][${paper}][${mask}]maskedmerge[${out}]`);
    return out;
  });
}

/** A per-frame palette of `colors`, ordered or diffusion dither, at chunky pixel size. */
function dither(g: Graph, input: string, e: FxEffect<"dither">): string {
  return g.mixed(input, e.amount, (src) => {
    const { width: w, height: h } = g.ctx;
    const px = Math.max(1, Math.round(e.params.pixel * g.k));
    const small = g.label();
    const mono = e.params.monochrome ? ",format=gray,format=gbrp" : "";
    g.add(`[${src}]scale=${even(w / px)}:${even(h / px)}:flags=area,format=gbrp${mono}[${small}]`);
    const [a, b] = g.split(small, 2);
    const palette = g.label("p");
    g.add(`[${a}]palettegen=max_colors=${e.params.colors}:stats_mode=single:reserve_transparent=0[${palette}]`);
    const out = g.label();
    const mode = e.params.pattern === "bayer" ? "bayer:bayer_scale=2" : "floyd_steinberg";
    g.add(`[${b}][${palette}]paletteuse=dither=${mode}:new=1,scale=${w}:${h}:flags=neighbor,format=${g.work}[${out}]`);
    return out;
  });
}

function mirror(g: Graph, input: string, e: FxEffect<"mirror">): string {
  return g.mixed(input, e.amount, (src) => {
    const { width: w, height: h } = g.ctx;
    const hw = Math.floor(w / 2);
    const hh = Math.floor(h / 2);
    const out = g.label();
    const fit = w % 2 || h % 2 ? `,scale=${w}:${h}` : "";
    switch (e.params.mode) {
      case "horizontal": {
        const [a, b] = g.split(src, 2);
        g.add(`[${a}]crop=${hw}:${h}:0:0[${a}c];[${b}]crop=${hw}:${h}:0:0,hflip[${b}c];[${a}c][${b}c]hstack${fit}[${out}]`);
        return out;
      }
      case "vertical": {
        const [a, b] = g.split(src, 2);
        g.add(`[${a}]crop=${w}:${hh}:0:0[${a}c];[${b}]crop=${w}:${hh}:0:0,vflip[${b}c];[${a}c][${b}c]vstack${fit}[${out}]`);
        return out;
      }
      case "quad": {
        const q = g.label();
        g.add(`[${src}]crop=${hw}:${hh}:0:0[${q}]`);
        const [a, b, c, d] = g.split(q, 4);
        g.add(
          `[${b}]hflip[${b}f];[${c}]vflip[${c}f];[${d}]hflip,vflip[${d}f];` +
            `[${a}][${b}f][${c}f][${d}f]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0${fit}[${out}]`,
        );
        return out;
      }
      case "kaleidoscope": {
        // Fold each pixel's angle around the centre into one wedge (mirrored at its edges), sample at 0.6× the
        // radius, reflect what falls outside the frame. The fold is fixed, so it is drawn once as remap maps.
        const seg = (2 * Math.PI) / e.params.segments;
        const cx = num(w / 2);
        const cy = num(h / 2);
        const fold =
          `st(0,atan2(Y-${cy},X-${cx})+PI);st(1,ld(0)-${num(seg)}*floor(ld(0)/${num(seg)}));` +
          `st(1,if(gt(ld(1),${num(seg / 2)}),${num(seg)}-ld(1),ld(1))-PI/2-${num(seg / 4)});st(2,0.6*hypot(X-${cx},Y-${cy}));`;
        const reflect = (v: string, size: number) => `${size - 1}-abs(mod(${v}+${8 * (size - 1)},${2 * (size - 1)})-${size - 1})`;
        const map = (coord: string, size: number) => {
          const m = g.label("m");
          g.add(
            `color=c=black:s=${w}x${h}:r=${g.rate}:d=${num(1 / rateOf(g))},format=gray16le,` +
              `geq=lum='${fold}${reflect(coord, size)}',loop=loop=-1:size=1,trim=end=${num(g.ctx.duration)}[${m}]`,
          );
          return m;
        };
        const xm = map(`${cx}+ld(2)*cos(ld(1))`, w);
        const ym = map(`${cy}+ld(2)*sin(ld(1))`, h);
        g.add(`[${src}][${xm}][${ym}]remap=format=color[${out}]`);
        return out;
      }
    }
  });
}

/** Corners darkened by a smooth radial mask (drawn at 1/8 size, scaled up) multiplied in. */
function vignette(g: Graph, input: string, e: FxEffect<"vignette">): string {
  const { width: w, height: h } = g.ctx;
  const mw = Math.max(8, Math.round(w / 8));
  const mh = Math.max(8, Math.round(h / 8));
  const inner = 0.75 - 0.6 * e.params.softness;
  const depth = 0.25 + 0.75 * e.amount;
  const solid = g.solid(mw, mh, 0, g.ctx.duration);
  const mask = g.label("m");
  // Normalised distance from the centre (1 at the corners), smoothstep from `inner` to 1.
  const r = `hypot((X+0.5)/${mw}-0.5,(Y+0.5)/${mh}-0.5)/0.7071`;
  const sm = `st(0,clip((${r}-${num(inner)})/${num(1 - inner)},0,1));ld(0)*ld(0)*(3-2*ld(0))`;
  g.add(`[${solid}]format=gray,geq=lum='255*(1-${num(depth)}*(${sm}))',scale=${w}:${h}:flags=bicubic,format=${g.work}[${mask}]`);
  return g.blend(input, mask, "multiply", 1);
}

/**
 * Procedural light leak: two or three soft colour blobs drifting along
 * seeded paths and breathing in and out (geq at 1/8 size, scaled up),
 * screened over. burn adds a hot white core that flares.
 */
function lightLeak(g: Graph, input: string, e: FxEffect<"light_leak">, span: Span): string {
  const { width: w, height: h } = g.ctx;
  const rand = mulberry32(e.params.seed);
  const mw = Math.max(8, Math.round(w / 8));
  const mh = Math.max(8, Math.round(h / 8));
  const [r0, g0, b0] = rgb(e.params.color);
  const burn = e.params.style === "burn";
  const terms = { r: [] as string[], g: [] as string[], b: [] as string[] };
  // Leaks come in from one side of the frame (seeded) as long soft streaks along that edge.
  const side = Math.floor(rand() * 4);
  const blobs = burn ? 4 : 3;
  for (let i = 0; i < blobs; i++) {
    const along = 0.15 + rand() * 0.7;
    const drift = 0.25 + rand() * 0.35;
    const speed = 0.7 + rand() * 1.1;
    const phase = rand() * Math.PI * 2;
    const pos = `(${num(along)}+${num(drift)}*sin(${num(speed)}*T+${num(phase)}))`;
    const depth = num(-0.05 + rand() * (burn ? 0.35 : 0.2));
    const vertical = side >= 2;
    const [bx, by] = [
      [pos, depth],
      [pos, `(1-${depth})`],
      [depth, pos],
      [`(1-${depth})`, pos],
    ][side]!;
    // Narrow across the edge, long along it.
    const across = (burn ? 0.22 : 0.16) + rand() * 0.14;
    const length = 0.35 + rand() * 0.35;
    const [sx, sy] = vertical ? [across, length] : [length, across];
    const pulse = `(0.7+0.5*sin(${num(0.9 + rand() * 1.8)}*T+${num(rand() * 6.28)}))`;
    const blob = `exp(-(pow((X/${mw}-${bx})*${num(w / h)}/${num(sx)},2)+pow((Y/${mh}-${by})/${num(sy)},2)))*${pulse}`;
    // The first streak takes the leak colour, the others rose and gold; the gain clips their cores toward yellow-white like overexposed film.
    const tint = [
      [r0, g0, b0],
      [255, 46, 77],
      [255, 194, 74],
      [255, 110, 30],
    ][i]!;
    const gain = burn ? 2.6 : 2;
    for (const [c, value] of [
      ["r", tint[0]!],
      ["g", tint[1]!],
      ["b", tint[2]!],
    ] as const) terms[c].push(`${num(value * gain)}*${blob}`);
  }
  if (burn) {
    const flare = `pow(max(0,sin(${num(1.3 + rand())}*T+${num(rand() * 6.28)})),2)`;
    const core = `exp(-(pow((X/${mw}-${num(0.2 + rand() * 0.6)})*${num(w / h)},2)+pow(Y/${mh}-${num(0.2 + rand() * 0.6)},2))/0.06)*${flare}`;
    for (const c of ["r", "g", "b"] as const) terms[c].push(`300*${core}`);
  }
  const solid = g.solid(mw, mh, span.from, span.to);
  const layer = g.label("l");
  const expr = (c: "r" | "g" | "b") => `clip(${terms[c].join("+")},0,255)`;
  g.add(`[${solid}]geq=r='${expr("r")}':g='${expr("g")}':b='${expr("b")}',scale=${w}:${h}:flags=bicubic,format=${g.work}[${layer}]`);
  return g.blend(input, layer, "screen", 0.35 + 0.65 * e.amount);
}

/** atempo takes 0.5-2 per stage: chain stages down to the speed. */
export function atempoChain(speed: number): string {
  const stages: string[] = [];
  let left = speed;
  while (left < 0.5) {
    stages.push("atempo=0.5");
    left /= 0.5;
  }
  stages.push(`atempo=${num(left, 6)}`);
  return stages.join(",");
}

/** Small deterministic PRNG (mulberry32): the same seed draws the same glitches on every surface. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rateOf(g: Graph): number {
  return g.ctx.fps.num / g.ctx.fps.den;
}

function rgb(hexColor: string): [number, number, number] {
  const v = parseInt(hexColor.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function even(value: number): number {
  return Math.max(2, 2 * Math.round(value / 2));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function round(value: number, digits = 4): number {
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}

/** Fixed-point text for the graph (stable across platforms, no exponent notation). */
function num(value: number, digits = 4): string {
  const text = value.toFixed(digits).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}

