/**
 * The QPainter subset AudioVisualization draws with, on a premultiplied
 * RGBA8888 canvas, following qtbase 5.15's raster engine:
 *
 * - Brushes (qpaintengine_raster.cpp `QSpanData::setup` :4534-4661): solid
 *   colors premultiplied in 16 bits (`QRgba64`), gradient color tables
 *   (`QGradientCache::generateGradientColorTable` :4325-4505, 1024 entries,
 *   color interpolation), and the fetchers of qdrawhelper.cpp (linear
 *   fixed-point :4102-4170, the vertical fast path :5476-5525, conical
 *   :4256-4304) and qdrawhelper_p.h (radial, arm64 NEON float version with
 *   the vrsqrte/vrsqrts square root :421-640).
 * - Span blending: SourceOver, or Source for opaque brushes (`getOperator`),
 *   with `comp_func_solid_*` for colors and the texture composers of
 *   `qt/compose.ts` for gradients.
 * - Rects (`fillRect` :1792-1831): `fillRect_normalized` when aliased,
 *   `QRasterizer::rasterizeLine` when antialiased.
 * - Paths: QStroker outlines or flattened paths, rounded to 26.6 like
 *   QOutlineMapper, filled by the qgrayraster port (`qt/gray-raster.ts`,
 *   antialiased) or Qt's aliased scan converter; pens of width <= 1 use the
 *   cosmetic stroker (`fast_pen`).
 * - Span batching: the blend function sees spans in the producer's batches
 *   (QSpanBuffer 256, qgrayraster 256, QCosmeticStroker 255) and gradients
 *   are fetched once per run of adjacent spans (`handleSpans`), because the
 *   linear fixed-point and NEON radial fetchers depend on the fetch start.
 *
 * Checked pixel for pixel against Qt 5.15.19 with random polylines, paths,
 * lines, ellipses and gradient pens (aliased and antialiased) and against
 * libopenshot's own renders (fx-kernels.test.ts).
 */

import { blendSourceOverFast, CompositionMode, composerFor } from "../qt/compose.js";
import { grayRasterize } from "../qt/gray-raster.js";
import { clipBoxFor, maskSpans, rasterizeLine, rasterizePolygonsAliased, type ClipBox, type SpanSink } from "../qt/rasterizer.js";
import type { PremulImage } from "../pixels.js";
import { byteMul } from "../pixels.js";
import { f32 } from "./audio-visualization-analysis.js";
import { div257, type GradientStop, type QtColor } from "./audio-visualization-color.js";
import { CosmeticStroker } from "./audio-visualization-cosmetic.js";
import { curvesForArc, flattenPath, LINE_TO, MOVE_TO, CURVE_TO, CURVE_DATA, strokePath, type Cap, type Join, type Path } from "./audio-visualization-stroke.js";

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

/** `QRgba64::premultiplied()` → `toArgb32()` as premultiplied [r, g, b, a] bytes. */
export function premultipliedBytes(c: QtColor): [number, number, number, number] {
  const a = c.a;
  if (a === 65535) return [div257(c.r), div257(c.g), div257(c.b), 255];
  if (a === 0) return [0, 0, 0, 0];
  const pm = (x: number): number => {
    const t = x * a;
    return Math.floor((t + Math.floor(t / 65536) + 0x8000) / 65536);
  };
  return [div257(pm(c.r)), div257(pm(c.g)), div257(pm(c.b)), div257(a)];
}

/** 16-bit premultiplied channels (`QRgba64::premultiplied`). */
function premul64(c: QtColor): [number, number, number, number] {
  const a = c.a;
  if (a === 65535) return [c.r, c.g, c.b, a];
  if (a === 0) return [0, 0, 0, 0];
  const pm = (x: number): number => {
    const t = x * a;
    return Math.floor((t + Math.floor(t / 65536) + 0x8000) / 65536);
  };
  return [pm(c.r), pm(c.g), pm(c.b), a];
}

/** `qRound(double)`. */
function qRound(d: number): number {
  if (d >= 0) return Math.trunc(d + 0.5);
  const i = Math.trunc(d - 1);
  return Math.trunc(d - i + 0.5) + i;
}

// ---------------------------------------------------------------------------
// Brushes
// ---------------------------------------------------------------------------

export type Brush =
  | { kind: "solid"; color: QtColor }
  | { kind: "linear"; x1: number; y1: number; x2: number; y2: number; stops: GradientStop[] }
  | { kind: "radial"; cx: number; cy: number; radius: number; stops: GradientStop[] }
  | { kind: "conical"; cx: number; cy: number; angle: number; stops: GradientStop[] };

const TABLE = 1024;

/** `generateGradientColorTable` (opacity 256, ColorInterpolation): premultiplied RGBA bytes. */
export function gradientTable(stopsIn: readonly GradientStop[]): Uint8Array {
  const stops = stopsIn.length > 0 ? stopsIn : [{ pos: 0, color: { r: 0, g: 0, b: 0, a: 65535 } }, { pos: 1, color: { r: 65535, g: 65535, b: 65535, a: 65535 } }];
  // Entries are converted to bytes as they are produced (the 64-bit table is never read back).
  const out = new Uint8Array(TABLE * 4);
  const put = (i: number, v: readonly number[]): void => {
    out[i * 4] = div257(v[0]!);
    out[i * 4 + 1] = div257(v[1]!);
    out[i * 4 + 2] = div257(v[2]!);
    out[i * 4 + 3] = div257(v[3]!);
  };
  const putRange = (from: number, toIn: number, v: readonly number[]): void => {
    const to = Math.min(toIn, TABLE);
    if (from >= to) return;
    put(from, v);
    for (let i = from + 1; i < to; i += 1) out.copyWithin(i * 4, from * 4, from * 4 + 4);
  };
  if (stops.length === 2) {
    let first = premul64(stops[0]!.color);
    let second = premul64(stops[1]!.color);
    let firstStop = stops[0]!.pos;
    let secondStop = stops[1]!.pos;
    if (secondStop < firstStop) {
      [first, second] = [second, first];
      [firstStop, secondStop] = [secondStop, firstStop];
    }
    const firstIndex = qRound(firstStop * (TABLE - 1));
    const secondIndex = qRound(secondStop * (TABLE - 1));
    const f = first.map((v) => v * 65536);
    const s = second.map((v) => v * 65536);
    let i = Math.max(0, Math.min(TABLE, firstIndex) + 1);
    putRange(0, i, first);
    if (i < secondIndex) {
      const reciprocal = 1 / (secondIndex - firstIndex);
      const delta = [0, 1, 2, 3].map((c) => qRound((s[c]! - f[c]!) * reciprocal));
      const cur = f.map((v) => v + (1 << 15));
      for (; i < Math.min(TABLE, secondIndex); i += 1) {
        for (let c = 0; c < 4; c += 1) cur[c] = (cur[c]! + delta[c]!) >>> 0;
        put(i, [(cur[0]! >>> 16) & 0xffff, (cur[1]! >>> 16) & 0xffff, (cur[2]! >>> 16) & 0xffff, (cur[3]! >>> 16) & 0xffff]);
      }
    }
    putRange(i, TABLE, second);
  } else if (stops.length === 1) {
    putRange(0, TABLE, premul64(stops[0]!.color));
  } else {
    const interpolate = (x: number[], a1: number, y: number[], a2: number): [number, number, number, number] => [
      ((x[0]! * a1) >> 8) + ((y[0]! * a2) >> 8),
      ((x[1]! * a1) >> 8) + ((y[1]! * a2) >> 8),
      ((x[2]! * a1) >> 8) + ((y[2]! * a2) >> 8),
      ((x[3]! * a1) >> 8) + ((y[3]! * a2) >> 8),
    ];
    const beginPos = stops[0]!.pos;
    const endPos = stops[stops.length - 1]!.pos;
    let pos = 0;
    const incr = 1 / TABLE;
    let dpos = 1.5 * incr;
    let current: number[] = stops[0]!.color ? premul64(stops[0]!.color) : [0, 0, 0, 0];
    put(pos++, current);
    while (dpos <= beginPos) {
      out.copyWithin(pos * 4, (pos - 1) * 4, pos * 4);
      pos += 1;
      dpos += incr;
    }
    let cs = 0;
    if (dpos < endPos) {
      while (dpos > stops[cs + 1]!.pos) cs += 1;
      current = premul64(stops[cs]!.color);
      let next = premul64(stops[cs + 1]!.color);
      let diff = stops[cs + 1]!.pos - stops[cs]!.pos;
      let c = diff === 0 ? 0 : 256 / diff;
      let t = (dpos - stops[cs]!.pos) * c;
      let tDelta = incr * c;
      for (;;) {
        const dist = qRound(t);
        put(pos, interpolate(current, 256 - dist, next, dist));
        pos += 1;
        dpos += incr;
        if (dpos >= endPos) break;
        t += tDelta;
        let skip = 0;
        while (dpos > stops[cs + skip + 1]!.pos) skip += 1;
        if (skip !== 0) {
          cs += skip;
          current = skip === 1 ? next : premul64(stops[cs]!.color);
          next = premul64(stops[cs + 1]!.color);
          diff = stops[cs + 1]!.pos - stops[cs]!.pos;
          c = diff === 0 ? 0 : 256 / diff;
          t = (dpos - stops[cs]!.pos) * c;
          tDelta = incr * c;
        }
      }
    }
    const last = premul64(stops[stops.length - 1]!.color);
    putRange(pos, TABLE, last);
  }
  return out;
}

/** `qt_gradient_clamp`: pad, or repeat (conical). */
function clampIndex(ipos: number, repeat: boolean): number {
  if (ipos < 0 || ipos >= TABLE) {
    if (repeat) {
      ipos %= TABLE;
      if (ipos < 0) ipos += TABLE;
    } else ipos = ipos < 0 ? 0 : TABLE - 1;
  }
  return ipos;
}

const FIXPT_MAX = 2147483647 >> 9;

// FRSQRTE (Arm ARM `FPRSqrtEstimate` / `RecipSqrtEstimate`) for positive normal floats.
const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);

function recipSqrtEstimate(aIn: number): number {
  let a = aIn;
  if (a < 256) a = a * 2 + 1;
  else {
    a = (a >> 1) << 1;
    a = (a + 1) * 2;
  }
  let b = 512;
  while (a * (b + 1) * (b + 1) < 268435456) b += 1;
  return (b + 1) >> 1;
}

function frsqrte(x: number): number {
  F32[0] = x;
  const bits = U32[0]!;
  let exp = (bits >>> 23) & 0xff;
  let fraction = bits & 0x7fffff;
  if (exp === 0) {
    if (fraction === 0) return Infinity;
    while ((fraction & 0x400000) === 0) {
      fraction <<= 1;
      exp -= 1;
    }
    fraction = (fraction << 1) & 0x7fffff;
  }
  const scaled = exp & 1 ? 128 | (fraction >> 16) : 256 | (fraction >> 15);
  const resultExp = Math.floor((380 - exp) / 2);
  const estimate = recipSqrtEstimate(scaled);
  U32[0] = ((resultExp & 0xff) << 23) | ((estimate & 0xff) << 15);
  return F32[0]!;
}

/** The NEON `v_sqrt`: one Newton step on the estimate (`vrsqrts` is fused). */
function neonSqrt(x: number): number {
  const y0 = frsqrte(x);
  const step = f32((3 - x * f32(y0 * y0)) / 2);
  return f32(x * f32(y0 * step));
}

const FLT_EPSILON = 1.1920928955078125e-7;

/** A brush ready for span filling. */
interface Prepared {
  /** Opaque brushes composite with Source, others with SourceOver (`getOperator`). */
  opaque: boolean;
  solid: [number, number, number, number] | null;
  table: Uint8Array | null;
  /** Fills `out[0 .. len*4)` with the gradient for pixels (x .. x+len-1, y). */
  fetch: ((x: number, y: number, len: number, out: Uint8ClampedArray) => void) | null;
  /** Vertical linear gradient: one table index per row (`blend_vertical_gradient`). */
  rowIndex: ((y: number) => number) | null;
}

function stopsOpaque(stops: readonly GradientStop[]): boolean {
  return stops.every((s) => div257(s.color.a) === 255);
}

function prepare(brush: Brush): Prepared {
  if (brush.kind === "solid") {
    const c = premultipliedBytes(brush.color);
    return { opaque: c[3] === 255, solid: c, table: null, fetch: null, rowIndex: null };
  }
  const table = gradientTable(brush.stops);
  const opaque = stopsOpaque(brush.stops);
  const put = (out: Uint8ClampedArray, i: number, idx: number): void => {
    out[i * 4] = table[idx * 4]!;
    out[i * 4 + 1] = table[idx * 4 + 1]!;
    out[i * 4 + 2] = table[idx * 4 + 2]!;
    out[i * 4 + 3] = table[idx * 4 + 3]!;
  };
  if (brush.kind === "linear") {
    let dx = brush.x2 - brush.x1;
    let dy = brush.y2 - brush.y1;
    const l = dx * dx + dy * dy;
    let off = 0;
    if (l !== 0) {
      dx /= l;
      dy /= l;
      off = -dx * brush.x1 - dy * brush.y1;
    }
    if (brush.x2 === brush.x1) {
      const yinc = Math.trunc(dy * 1 * (TABLE - 1) * 256);
      const offFixed = Math.trunc((dy * (1 * 0.5 + 0) + off) * (TABLE - 1) * 256);
      return { opaque, solid: null, table, fetch: null, rowIndex: (y) => clampIndex((yinc * y + offFixed + 128) >> 8, false) };
    }
    const fetch = (x: number, y: number, len: number, out: Uint8ClampedArray): void => {
      if (l === 0) {
        for (let i = 0; i < len; i += 1) put(out, i, clampIndex(0, false));
        return;
      }
      const rx = x + 0.5;
      const ry = y + 0.5;
      const t = (dx * rx + dy * ry + off) * (TABLE - 1);
      const inc = dx * (TABLE - 1);
      if (inc > -1e-5 && inc < 1e-5) {
        const idx = Math.abs(t) < FIXPT_MAX ? clampIndex((Math.trunc(t * 256) + 128) >> 8, false) : clampIndex(Math.trunc((t / TABLE) * (TABLE - 1) + 0.5), false);
        for (let i = 0; i < len; i += 1) put(out, i, idx);
      } else if (Math.abs(t) < FIXPT_MAX && Math.abs(inc) < FIXPT_MAX && Math.abs(t + inc * len) < FIXPT_MAX) {
        let tFixed = Math.trunc(t * 256);
        const incFixed = Math.trunc(inc * 256);
        for (let i = 0; i < len; i += 1) {
          put(out, i, clampIndex((tFixed + 128) >> 8, false));
          tFixed = (tFixed + incFixed) | 0;
        }
      } else {
        let tt = t;
        for (let i = 0; i < len; i += 1) {
          put(out, i, clampIndex(Math.trunc((tt / TABLE) * (TABLE - 1) + 0.5), false));
          tt += inc;
        }
      }
    };
    return { opaque, solid: null, table, fetch, rowIndex: null };
  }
  if (brush.kind === "radial") {
    // Focal point = center, focal radius 0 (QRadialGradient(center, radius)).
    const a = brush.radius * brush.radius;
    const dr = brush.radius;
    const fetch = (x: number, y: number, len: number, out: Uint8ClampedArray): void => {
      if (Math.abs(a) <= 1e-12) {
        out.fill(0, 0, len * 4);
        return;
      }
      const rx = x + 0.5 - brush.cx;
      const ry = y + 0.5 - brush.cy;
      let invA = 1 / (2 * a);
      let b = 0;
      invA *= invA;
      const rxrxryry = rx * rx + ry * ry;
      let det = (0 - 4 * a * (0 - rxrxryry)) * invA;
      let deltaDet = (0 + 0 + 4 * a * (2 * rx + 1)) * invA;
      const deltaDeltaDet = (0 + 4 * a * 2) * invA;
      const detVec = [0, 0, 0, 0];
      const delta4 = [0, 0, 0, 0];
      const bVec = [0, 0, 0, 0];
      for (let i = 0; i < 4; i += 1) {
        detVec[i] = f32(det);
        delta4[i] = f32(4 * deltaDet);
        bVec[i] = f32(b);
        det += deltaDet;
        deltaDet += deltaDeltaDet;
        b += 0;
      }
      const dd16 = f32(16 * deltaDeltaDet);
      const dd6 = f32(6 * deltaDeltaDet);
      const db4 = f32(0);
      const vmax = 1023;
      for (let base = 0; base < len; base += 4) {
        for (let lane = 0; lane < 4; lane += 1) {
          const d = detVec[lane]!;
          const local = f32(neonSqrt(d > FLT_EPSILON ? d : FLT_EPSILON) - bVec[lane]!);
          const index = f32(f32(local * vmax) + 0.5);
          const clamped = index < vmax ? (index > FLT_EPSILON ? index : FLT_EPSILON) : vmax;
          const idx = Math.trunc(clamped);
          if (base + lane < len) put(out, base + lane, idx);
          detVec[lane] = f32(f32(d + delta4[lane]!) + dd6);
          delta4[lane] = f32(delta4[lane]! + dd16);
          bVec[lane] = f32(bVec[lane]! + db4);
        }
      }
      void dr;
    };
    return { opaque: false, solid: null, table, fetch, rowIndex: null };
  }
  const angle = brush.angle * (Math.PI / 180);
  const inv2pi = 1 / Math.PI / 2;
  const fetch = (x: number, y: number, len: number, out: Uint8ClampedArray): void => {
    let rx = x + 0.5 - brush.cx;
    const ry = y + 0.5 - brush.cy;
    for (let i = 0; i < len; i += 1) {
      const a = Math.atan2(ry, rx) + angle;
      put(out, i, clampIndex(Math.trunc((1 - a * inv2pi) * (TABLE - 1) + 0.5), true));
      rx += 1;
    }
  };
  return { opaque, solid: null, table, fetch, rowIndex: null };
}

// ---------------------------------------------------------------------------
// Span batches (the blend callback sees spans in the producer's batches)
// ---------------------------------------------------------------------------

/** How a span producer batches spans before calling the blend function. */
const enum Batching {
  /** `QSpanBuffer` (qrasterizer.cpp): flush every 256 spans. */
  Rasterizer,
  /** qgrayraster `gray_hline`: merge equal-coverage neighbours, flush when a 257th span is needed. */
  Gray,
  /** QCosmeticStroker: 255 spans, flush when a pixel is left of or above the last span's end. */
  Cosmetic,
}

class SpanBatch {
  readonly xs: number[] = [];
  readonly ys: number[] = [];
  readonly lens: number[] = [];
  readonly covs: number[] = [];

  constructor(
    private readonly mode: Batching,
    private readonly flushFn: (batch: SpanBatch) => void,
  ) {}

  get count(): number {
    return this.xs.length;
  }

  add(x: number, y: number, len: number, coverage: number): void {
    if (len <= 0) return;
    const n = this.xs.length;
    if (this.mode === Batching.Gray) {
      if (n > 0 && this.ys[n - 1] === y && this.xs[n - 1]! + this.lens[n - 1]! === x && this.covs[n - 1] === coverage) {
        this.lens[n - 1] = this.lens[n - 1]! + len;
        return;
      }
      if (n >= 256) this.flush();
    } else if (this.mode === Batching.Cosmetic && n > 0) {
      const lastX = this.xs[n - 1]! + this.lens[n - 1]!;
      const lastY = this.ys[n - 1]!;
      if (n === 255 || y < lastY || (y === lastY && x < lastX)) this.flush();
    }
    this.xs.push(x);
    this.ys.push(y);
    this.lens.push(len);
    this.covs.push(coverage);
    if (this.mode === Batching.Rasterizer && this.xs.length === 256) this.flush();
  }

  flush(): void {
    if (this.xs.length > 0) this.flushFn(this);
    this.xs.length = 0;
    this.ys.length = 0;
    this.lens.length = 0;
    this.covs.length = 0;
  }
}

/** qdrawhelper's BufferSize: fetches cover at most this many pixels. */
const BUFFER_SIZE = 2048;

// ---------------------------------------------------------------------------
// The painter
// ---------------------------------------------------------------------------

export interface Pen {
  brush: Brush;
  width: number;
  cap: Cap;
  join: Join;
}

const SOURCE = composerFor(CompositionMode.Source);
const SOURCE_OVER = composerFor(CompositionMode.SourceOver);
const DESTINATION_IN = composerFor(CompositionMode.DestinationIn);

export class Painter {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  private readonly clip: ClipBox;
  private readonly scratch: Uint8ClampedArray;
  /** `QPainter::Antialiasing`. */
  antialias = false;

  constructor(image: PremulImage) {
    this.width = image.width;
    this.height = image.height;
    this.data = image.data;
    this.clip = clipBoxFor(image.width, image.height);
    this.scratch = new Uint8ClampedArray(BUFFER_SIZE * 4);
  }

  /** A span sink that batches like `mode` and blends each batch (`handleSpans`). */
  private batched(p: Prepared, mode: Batching): { sink: SpanSink; end: () => void } {
    const batch = new SpanBatch(mode, (b) => this.blendBatch(b, p));
    return { sink: (x, y, len, coverage) => batch.add(x, y, len, coverage), end: () => batch.flush() };
  }

  /**
   * One blend call: colors span by span; gradients like `handleSpans`
   * (qdrawhelper.cpp:4679-4728) — one fetch per run of adjacent spans on a
   * row, in chunks of BufferSize, each span composited with its coverage.
   */
  private blendBatch(b: SpanBatch, p: Prepared): void {
    const n = b.count;
    if (!p.fetch) {
      for (let i = 0; i < n; i += 1) this.blend(b.xs[i]!, b.ys[i]!, b.lens[i]!, b.covs[i]!, p);
      return;
    }
    const compose = p.opaque ? SOURCE : SOURCE_OVER;
    let i = 0;
    while (i < n) {
      if (!b.lens[i]) {
        i += 1;
        continue;
      }
      let x = b.xs[i]!;
      const y = b.ys[i]!;
      let right = x + b.lens[i]!;
      for (let j = i + 1; j < n && b.ys[j] === y && b.xs[j] === right; j += 1) right += b.lens[j]!;
      let length = right - x;
      while (length) {
        let l = Math.min(BUFFER_SIZE, length);
        length -= l;
        p.fetch(x, y, l, this.scratch);
        let offset = 0;
        while (l > 0) {
          const spanRight = b.xs[i]! + b.lens[i]!;
          const len = Math.min(l, spanRight - x);
          compose(this.data, (y * this.width + x) * 4, this.scratch, offset * 4, len, b.covs[i]!);
          l -= len;
          x += len;
          offset += len;
          if (x === spanRight) i += 1;
        }
      }
    }
  }

  /** Blend one span (x .. x+len-1, y) with coverage 1..255. */
  private blend(x: number, y: number, len: number, coverage: number, p: Prepared): void {
    if (len <= 0) return;
    const d = this.data;
    const di = (y * this.width + x) * 4;
    let color = p.solid;
    if (p.rowIndex && p.table) {
      const idx = p.rowIndex(y) * 4;
      color = [p.table[idx]!, p.table[idx + 1]!, p.table[idx + 2]!, p.table[idx + 3]!];
    }
    if (color) {
      if (p.opaque) {
        // comp_func_solid_Source.
        if (coverage === 255) {
          for (let i = 0; i < len; i += 1) d.set(color, di + i * 4);
          return;
        }
        const ia = 255 - coverage;
        const s0 = byteMul(color[0], coverage);
        const s1 = byteMul(color[1], coverage);
        const s2 = byteMul(color[2], coverage);
        const s3 = byteMul(color[3], coverage);
        for (let i = 0, o = di; i < len; i += 1, o += 4) {
          d[o] = s0 + byteMul(d[o]!, ia);
          d[o + 1] = s1 + byteMul(d[o + 1]!, ia);
          d[o + 2] = s2 + byteMul(d[o + 2]!, ia);
          d[o + 3] = s3 + byteMul(d[o + 3]!, ia);
        }
        return;
      }
      // comp_func_solid_SourceOver (NEON: the same integer math).
      let c0 = color[0];
      let c1 = color[1];
      let c2 = color[2];
      let c3 = color[3];
      if (coverage !== 255) {
        c0 = byteMul(c0, coverage);
        c1 = byteMul(c1, coverage);
        c2 = byteMul(c2, coverage);
        c3 = byteMul(c3, coverage);
      }
      const ia = 255 - c3;
      for (let i = 0, o = di; i < len; i += 1, o += 4) {
        d[o] = c0 + byteMul(d[o]!, ia);
        d[o + 1] = c1 + byteMul(d[o + 1]!, ia);
        d[o + 2] = c2 + byteMul(d[o + 2]!, ia);
        d[o + 3] = c3 + byteMul(d[o + 3]!, ia);
      }
      return;
    }
    if (!p.fetch) return;
    p.fetch(x, y, len, this.scratch);
    (p.opaque ? SOURCE : SOURCE_OVER)(d, di, this.scratch, 0, len, coverage);
  }

  /** `fillRect_normalized` over the integer rect (x, y, w, h). */
  private fillNormalized(x: number, y: number, w: number, h: number, p: Prepared): void {
    const x1 = Math.max(x, 0);
    const x2 = Math.min(x + w, this.width);
    const y1 = Math.max(y, 0);
    const y2 = Math.min(y + h, this.height);
    if (x2 <= x1 || y2 <= y1) return;
    for (let row = y1; row < y2; row += 1) this.blend(x1, row, x2 - x1, 255, p);
  }

  /** `QPainter::fillRect(QRectF, brush)` (QRect arguments convert to QRectF). */
  fillRect(x: number, y: number, w: number, h: number, brush: Brush): void {
    const p = prepare(brush);
    if (!p.opaque && p.solid && p.solid[3] === 0) return;
    if (!this.antialias) {
      // toNormalizedFillRect: qRound of each edge.
      let x1 = qRound(x);
      let y1 = qRound(y);
      let x2 = qRound(x + w);
      let y2 = qRound(y + h);
      if (x2 < x1) [x1, x2] = [x2, x1];
      if (y2 < y1) [y1, y2] = [y2, y1];
      this.fillNormalized(x1, y1, x2 - x1, y2 - y1, p);
      return;
    }
    let nx = x;
    let ny = y;
    let nw = w;
    let nh = h;
    if (nw < 0) {
      nx += nw;
      nw = -nw;
    }
    if (nh < 0) {
      ny += nh;
      nh = -nh;
    }
    if (!(nw > 0 && nh > 0)) return;
    const my = (ny + (ny + nh)) * f32(0.5);
    const ax = (nx + nx) * f32(0.5);
    const bx = (nx + nw + (nx + nw)) * f32(0.5);
    const out = this.batched(p, Batching.Rasterizer);
    rasterizeLine(ax, my, bx, my, nh / nw, true, this.clip, out.sink);
    out.end();
  }

  /** `QPainter::drawRect(QRect)` with no pen, aliased (`drawRects` → `fillRect_normalized`). */
  drawRectI(x: number, y: number, w: number, h: number, brush: Brush): void {
    const p = prepare(brush);
    // qrect_normalized on QRect(x, y, w, h): x2 = x + w - 1, y2 = y + h - 1.
    let x1 = x;
    let x2 = x + w - 1;
    let y1 = y;
    let y2 = y + h - 1;
    if (x2 < x1) [x1, x2] = [x2, x1];
    if (y2 < y1) [y1, y2] = [y2, y1];
    this.fillNormalized(x1, y1, x2 - x1 + 1, y2 - y1 + 1, p);
  }

  /**
   * Fill a path outline with the winding (default) or odd-even rule:
   * QOutlineMapper rounds to 26.6 (`qRound(v * 64)`, qoutlinemapper.cpp:51),
   * then qgrayraster (antialiased; its spans are the runs of equal coverage,
   * flushed every 256) or QRasterizer's scan converter (aliased).
   */
  fillPath(path: Path, brush: Brush, evenOdd: boolean): void {
    const contours = flattenPath(path, this);
    if (contours.length === 0) return;
    const p = prepare(brush);
    if (this.antialias) {
      const mask = grayRasterize(contours, evenOdd, this.width, this.height);
      if (!mask) return;
      const out = this.batched(p, Batching.Gray);
      maskSpans(mask, out.sink);
      out.end();
    } else {
      const fixed = contours.map((c) => c.map((v) => Math.floor(v * 64 + 0.5) / 64));
      const out = this.batched(p, Batching.Rasterizer);
      rasterizePolygonsAliased(fixed, evenOdd, this.clip, out.sink);
      out.end();
    }
  }

  /** Run `draw` with a cosmetic stroker for `pen`; its spans are blended in Qt's batches. */
  private cosmetic(pen: Pen, draw: (stroker: CosmeticStroker) => void): void {
    const out = this.batched(prepare(pen.brush), Batching.Cosmetic);
    draw(new CosmeticStroker(this.width, this.height, this.antialias, pen.width, pen.cap !== "flat", (x, y, coverage) => out.sink(x, y, 1, coverage)));
    out.end();
  }

  /** `QPainter::drawPolyline`. */
  drawPolyline(points: readonly number[], pen: Pen): void {
    if (points.length < 4) return;
    if (pen.width <= 1) {
      this.cosmetic(pen, (c) => c.drawPolygon(points, false));
      return;
    }
    const path: Path = { types: [], pts: [] };
    for (let i = 0; i < points.length; i += 2) {
      path.types.push(i === 0 ? MOVE_TO : LINE_TO);
      path.pts.push(points[i]!, points[i + 1]!);
    }
    this.fillPath(strokePath(path, pen, true), pen.brush, false);
  }

  /** `QPainter::drawPath` with no brush. */
  drawPath(path: Path, pen: Pen): void {
    if (path.types.length === 0) return;
    if (pen.width <= 1) {
      this.cosmetic(pen, (c) => c.drawPath(path));
      return;
    }
    this.fillPath(strokePath(path, pen, false), pen.brush, false);
  }

  /** `QPainter::drawLine(QPointF, QPointF)`. */
  drawLine(x1: number, y1: number, x2: number, y2: number, pen: Pen): void {
    if (pen.width <= 1) {
      this.cosmetic(pen, (c) => c.drawLine(x1, y1, x2, y2));
      return;
    }
    // Wide round-cap lines go through QStroker. (Qt rasterizes wide flat/square-cap
    // lines directly with QRasterizer::rasterizeLine; AudioVisualization draws none,
    // and the stroker outline is the same rectangle.)
    const path: Path = { types: [MOVE_TO, LINE_TO], pts: [x1, y1, x2, y2] };
    this.fillPath(strokePath(path, pen, false), pen.brush, false);
  }

  /** `QPainter::drawEllipse(center, rx, ry)` with no pen. */
  fillEllipse(cx: number, cy: number, rx: number, ry: number, brush: Brush): void {
    let x = cx - rx;
    let y = cy - ry;
    let w = 2 * rx;
    let h = 2 * ry;
    if (w < 0) {
      x += w;
      w = -w;
    }
    if (h < 0) {
      y += h;
      h = -h;
    }
    const arc = curvesForArc(x, y, w, h, 0, -360);
    if (arc.curves.length === 0) return;
    const path: Path = { types: [MOVE_TO], pts: [arc.sx, arc.sy] };
    for (let i = 0; i < arc.curves.length; i += 6) {
      path.types.push(CURVE_TO, CURVE_DATA, CURVE_DATA);
      path.pts.push(...arc.curves.slice(i, i + 6));
    }
    // An ellipse path is not WindingFill: odd-even.
    this.fillPath(path, brush, true);
  }

  /** `drawImage(0, 0, image)` with SourceOver (the `qBlendFunctions` fast path). */
  drawImageSourceOver(image: PremulImage): void {
    const w = Math.min(this.width, image.width);
    const h = Math.min(this.height, image.height);
    for (let y = 0; y < h; y += 1) blendSourceOverFast(this.data, y * this.width * 4, image.data, y * image.width * 4, w, 256);
  }

  /** `drawImage(0, 0, image)` with CompositionMode_DestinationIn (texture spans). */
  drawImageDestinationIn(image: PremulImage): void {
    const w = Math.min(this.width, image.width);
    const h = Math.min(this.height, image.height);
    for (let y = 0; y < h; y += 1) DESTINATION_IN(this.data, y * this.width * 4, image.data, y * image.width * 4, w, 255);
  }
}
