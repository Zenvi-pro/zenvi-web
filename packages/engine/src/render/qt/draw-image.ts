/**
 * `QPainter::drawImage(QPointF(0, 0), image)` on a premultiplied RGBA8
 * raster, as Qt 5.15's raster engine executes it (qtbase
 * src/gui/painting/qpaintengine_raster.cpp `QRasterPaintEngine::drawImage`
 * :2178-2530, qdrawhelper.cpp `handleSpans`, `fetchTransformed*`,
 * `fetchTransformedBilinear` :3416-3560). libopenshot draws every clip this
 * way (Clip::apply_keyframes, Clip.cpp:1384-1469), so the edge pixels, the
 * 16.16 sampling positions and the 8-bit bilinear weights all matter.
 */

import { qRound, type PremulImage } from "../pixels.js";
import { blendSourceOverFast, CompositionMode, composerFor } from "./compose.js";
import {
  clipBoxFor,
  fillRectSpans,
  maskSpans,
  rasterizeLine,
  rasterizePolygonsAA,
  rasterizePolygonsAliased,
  type ClipBox,
  type CoverageMask,
} from "./rasterizer.js";
import { QTransform, TxScale, TxTranslate, scaleIsUniform } from "./transform.js";

export interface PainterState {
  /** World transform (`QPainter::setTransform`). */
  transform: QTransform;
  /** `QPainter::SmoothPixmapTransform`: bilinear sampling. */
  smooth: boolean;
  /** `QPainter::Antialiasing`: antialiased image edges. */
  antialias: boolean;
  /** `QPainter::setOpacity` (clamped to [0, 1], quantized to 1/256). */
  opacity: number;
  /** `QPainter::CompositionMode` (libopenshot `composite`). */
  mode: number;
  /** Device-space clip coverage (`QPainter::setClipPath`), or none. */
  clip?: CoverageMask | null;
}

/** qdrawhelper.cpp BufferSize: spans are fetched in chunks of this many pixels. */
const BUFFER_SIZE = 2048;
const FIXED = 65536;
const HALF = 32768;

interface Run {
  x: number;
  len: number;
  /** Coverage per pixel of the run (0..255, already combined with the clip). */
  cov: Uint8Array;
}

/**
 * Collects spans per row, applies the clip mask (qt_div_255 of both
 * coverages, qpaintengine_raster.cpp:4127) and hands merged runs of adjacent
 * pixels to `flush`, like `handleSpans` merges adjacent spans before fetching.
 */
class RowCollector {
  private rows = new Map<number, [number, number, number][]>();

  constructor(private readonly clip: CoverageMask | null | undefined) {}

  add = (x: number, y: number, len: number, coverage: number): void => {
    let list = this.rows.get(y);
    if (!list) {
      list = [];
      this.rows.set(y, list);
    }
    list.push([x, len, coverage]);
  };

  forEachRun(fn: (y: number, run: Run) => void): void {
    const ys = [...this.rows.keys()].sort((a, b) => a - b);
    for (const y of ys) {
      const spans = this.rows.get(y)!;
      spans.sort((a, b) => a[0] - b[0]);
      let i = 0;
      while (i < spans.length) {
        const start = spans[i]![0];
        let end = start + spans[i]![1];
        let j = i + 1;
        while (j < spans.length && spans[j]![0] === end) {
          end += spans[j]![1];
          j += 1;
        }
        const cov = new Uint8Array(end - start);
        for (let k = i; k < j; k += 1) {
          const [sx, slen, sc] = spans[k]!;
          cov.fill(sc, sx - start, sx - start + slen);
        }
        this.applyClip(y, start, cov);
        fn(y, { x: start, len: end - start, cov });
        i = j;
      }
    }
  }

  private applyClip(y: number, x: number, cov: Uint8Array): void {
    const clip = this.clip;
    if (!clip) return;
    const row = y - clip.y;
    for (let i = 0; i < cov.length; i += 1) {
      const col = x + i - clip.x;
      const c = row >= 0 && row < clip.height && col >= 0 && col < clip.width ? clip.data[row * clip.width + col]! : 0;
      const v = cov[i]! * c;
      cov[i] = (v + (v >> 8) + 0x80) >> 8;
    }
  }
}

/** Inverse texture matrix (`QSpanData::setupMatrix`, qpaintengine_raster.cpp:4708-4738). */
interface TextureMatrix {
  m11: number;
  m12: number;
  m21: number;
  m22: number;
  dx: number;
  dy: number;
  fast: boolean;
}

function setupMatrix(t: QTransform): TextureMatrix | null {
  const delta = new QTransform().translate(1 / 65536, 1 / 65536);
  const inv = delta.multiply(t).inverted();
  if (!inv) return null;
  const f1 = inv.m11 * inv.m11 + inv.m21 * inv.m21;
  const f2 = inv.m12 * inv.m12 + inv.m22 * inv.m22;
  const fast = f1 < 1e4 && f2 < 1e4 && f1 > 1 / 65536 && f2 > 1 / 65536 && Math.abs(inv.dx) < 1e4 && Math.abs(inv.dy) < 1e4;
  return { m11: inv.m11, m12: inv.m12, m21: inv.m21, m22: inv.m22, dx: inv.dx, dy: inv.dy, fast };
}

/** canUseFastMatrixPath (qdrawhelper.cpp:2081-2096). */
function fastPathFits(m: TextureMatrix, cx: number, cy: number, length: number): boolean {
  if (!m.fast) return false;
  let fx = (m.m21 * cy + m.m11 * cx + m.dx) * FIXED;
  let fy = (m.m22 * cy + m.m12 * cx + m.dy) * FIXED;
  let minc = Math.min(fx, fy);
  let maxc = Math.max(fx, fy);
  fx += Math.trunc(m.m11 * FIXED) * length;
  fy += Math.trunc(m.m12 * FIXED) * length;
  minc = Math.min(minc, Math.min(fx, fy));
  maxc = Math.max(maxc, Math.max(fx, fy));
  return minc >= -2147483648 && maxc <= 2147483647;
}

/**
 * Bilinear sample of the 2×2 block at (x1, y1) with 8-bit weights, clamped
 * to the image: vertical pass then horizontal, each truncating
 * (interpolate_4_pixels NEON/SSE2 and the simple-scale helper agree).
 */
function sampleBilinear(src: PremulImage, x1: number, y1: number, distx: number, disty: number, out: Uint8ClampedArray, o: number): void {
  const w = src.width;
  const h = src.height;
  let xa: number;
  let xb: number;
  if (x1 < 0) xa = xb = 0;
  else if (x1 >= w - 1) xa = xb = w - 1;
  else {
    xa = x1;
    xb = x1 + 1;
  }
  let ya: number;
  let yb: number;
  if (y1 < 0) ya = yb = 0;
  else if (y1 >= h - 1) ya = yb = h - 1;
  else {
    ya = y1;
    yb = y1 + 1;
  }
  const s = src.data;
  const tl = (ya * w + xa) * 4;
  const tr = (ya * w + xb) * 4;
  const bl = (yb * w + xa) * 4;
  const br = (yb * w + xb) * 4;
  const idy = 256 - disty;
  const idx = 256 - distx;
  for (let c = 0; c < 4; c += 1) {
    const left = (s[tl + c]! * idy + s[bl + c]! * disty) >> 8;
    const right = (s[tr + c]! * idy + s[br + c]! * disty) >> 8;
    out[o + c] = (left * idx + right * distx) >> 8;
  }
}

/** fetchTransformedBilinear<BlendTransformedBilinear, BPP32> for one chunk. */
function fetchBilinear(src: PremulImage, m: TextureMatrix, x: number, y: number, length: number, out: Uint8ClampedArray): void {
  const cx = x + 0.5;
  const cy = y + 0.5;
  if (fastPathFits(m, cx, cy, length)) {
    const fdx = Math.trunc(m.m11 * FIXED);
    const fdy = Math.trunc(m.m12 * FIXED);
    let fx = Math.trunc((m.m21 * cy + m.m11 * cx + m.dx) * FIXED) - HALF;
    let fy = Math.trunc((m.m22 * cy + m.m12 * cx + m.dy) * FIXED) - HALF;
    for (let i = 0; i < length; i += 1) {
      sampleBilinear(src, fx >> 16, fy >> 16, (fx & 0xffff) >> 8, (fy & 0xffff) >> 8, out, i * 4);
      fx = (fx + fdx) | 0;
      fy = (fy + fdy) | 0;
    }
    return;
  }
  // Float path (large or degenerate matrices).
  let fx = m.m21 * cy + m.m11 * cx + m.dx;
  let fy = m.m22 * cy + m.m12 * cx + m.dy;
  for (let i = 0; i < length; i += 1) {
    const px = fx - 0.5;
    const py = fy - 0.5;
    const x1 = Math.trunc(px) - (px < 0 ? 1 : 0);
    const y1 = Math.trunc(py) - (py < 0 ? 1 : 0);
    const distx = Math.trunc((px - x1) * 256);
    const disty = Math.trunc((py - y1) * 256);
    sampleBilinear(src, x1, y1, distx, disty, out, i * 4);
    fx += m.m11;
    fy += m.m12;
  }
}

/** fetchTransformed<BlendTransformed, BPP32> (nearest, clamped) for one chunk. */
function fetchNearest(src: PremulImage, m: TextureMatrix, x: number, y: number, length: number, out: Uint8ClampedArray): void {
  const w = src.width;
  const h = src.height;
  const s = src.data;
  const cx = x + 0.5;
  const cy = y + 0.5;
  const put = (px: number, py: number, i: number): void => {
    const sx = px < 0 ? 0 : px > w - 1 ? w - 1 : px;
    const sy = py < 0 ? 0 : py > h - 1 ? h - 1 : py;
    const si = (sy * w + sx) * 4;
    out[i * 4] = s[si]!;
    out[i * 4 + 1] = s[si + 1]!;
    out[i * 4 + 2] = s[si + 2]!;
    out[i * 4 + 3] = s[si + 3]!;
  };
  if (fastPathFits(m, cx, cy, length)) {
    const fdx = Math.trunc(m.m11 * FIXED);
    const fdy = Math.trunc(m.m12 * FIXED);
    let fx = Math.trunc((m.m21 * cy + m.m11 * cx + m.dx) * FIXED);
    let fy = Math.trunc((m.m22 * cy + m.m12 * cx + m.dy) * FIXED);
    for (let i = 0; i < length; i += 1) {
      put(fx >> 16, fy >> 16, i);
      fx = (fx + fdx) | 0;
      fy = (fy + fdy) | 0;
    }
    return;
  }
  let fx = m.m21 * cy + m.m11 * cx + m.dx;
  let fy = m.m22 * cy + m.m12 * cx + m.dy;
  for (let i = 0; i < length; i += 1) {
    put(Math.trunc(fx) - (fx < 0 ? 1 : 0), Math.trunc(fy) - (fy < 0 ? 1 : 0), i);
    fx += m.m11;
    fy += m.m12;
  }
}

/** Compose a fetched chunk into `dst` row `y`, pixel by coverage run. */
function composeChunk(
  dst: PremulImage,
  mode: number,
  y: number,
  x: number,
  length: number,
  fetched: Uint8ClampedArray,
  cov: Uint8Array,
  covOffset: number,
  intOpacity: number,
): void {
  const compose = composerFor(mode);
  const rowBase = y * dst.width * 4;
  let i = 0;
  while (i < length) {
    const c = cov[covOffset + i]!;
    let j = i + 1;
    while (j < length && cov[covOffset + j] === c) j += 1;
    // handleSpans: coverage = (span coverage * const_alpha) >> 8.
    const ca = (c * intOpacity) >> 8;
    if (c > 0) compose(dst.data, rowBase + (x + i) * 4, fetched, i * 4, j - i, ca);
    i = j;
  }
}

let scratch = new Uint8ClampedArray(BUFFER_SIZE * 4);

/** Draw `src` at the origin under `state` onto `dst`, like the Qt raster engine. */
export function drawImage(dst: PremulImage, src: PremulImage, state: PainterState): void {
  if (src.width <= 0 || src.height <= 0 || dst.width <= 0 || dst.height <= 0) return;
  const intOpacity = Math.trunc(Math.min(1, Math.max(0, state.opacity)) * 256);
  if (intOpacity === 0) return;
  const t = state.transform;
  const type = t.type();
  const clipBox: ClipBox = clipBoxFor(dst.width, dst.height);
  const rows = new RowCollector(state.clip);

  if (type <= TxTranslate) {
    // drawImage(QPointF): integer placement at qRound(pt) (untransformed fetch).
    const ox = qRound(t.dx);
    const oy = qRound(t.dy);
    if (!state.smooth && state.mode === CompositionMode.SourceOver && !state.clip) {
      // canUseFastImageBlending → qBlendFunctions (qpaintengine_raster.cpp:2206).
      const x0 = Math.max(0, ox);
      const x1 = Math.min(dst.width, ox + src.width);
      const y0 = Math.max(0, oy);
      const y1 = Math.min(dst.height, oy + src.height);
      if (x1 <= x0) return;
      for (let y = y0; y < y1; y += 1) {
        const di = (y * dst.width + x0) * 4;
        const si = ((y - oy) * src.width + (x0 - ox)) * 4;
        blendSourceOverFast(dst.data, di, src.data, si, x1 - x0, intOpacity);
      }
      return;
    }
    fillRectSpans(ox, oy, src.width, src.height, clipBox, rows.add);
    rows.forEachRun((y, run) => {
      const sy = y - oy;
      for (let start = 0; start < run.len; start += BUFFER_SIZE) {
        const len = Math.min(BUFFER_SIZE, run.len - start);
        const sx = run.x + start - ox;
        const from = (sy * src.width + sx) * 4;
        const fetched = src.data.subarray(from, from + len * 4);
        composeChunk(dst, state.mode, y, run.x + start, len, fetched, run.cov, start, intOpacity);
      }
    });
    return;
  }

  const w = src.width;
  const h = src.height;

  if (w === 1 && h === 1 && type <= TxScale && !state.antialias) {
    // 1×1 source: Qt fills the mapped rect with the (opacity-scaled) color.
    const rr = t.mapRect(0, 0, 1, 1);
    const x1 = qRound(rr.x);
    const y1 = qRound(rr.y);
    fillRectSpans(x1, y1, qRound(rr.x + rr.width) - x1, qRound(rr.y + rr.height) - y1, clipBox, rows.add);
    const color = new Uint8ClampedArray(4);
    for (let c = 0; c < 4; c += 1) {
      const c16 = ((src.data[c]! * 257 * intOpacity) >> 8) >>> 0;
      color[c] = (c16 - (c16 >> 8) + 0x80) >> 8;
    }
    rows.forEachRun((y, run) => {
      if (scratch.length < run.len * 4) scratch = new Uint8ClampedArray(run.len * 4);
      for (let i = 0; i < run.len; i += 1) scratch.set(color, i * 4);
      composeChunk(dst, state.mode, y, run.x, run.len, scratch, run.cov, 0, 256);
    });
    return;
  }

  const m = setupMatrix(t);
  if (!m) return;

  if (!state.antialias && type === TxScale) {
    const rr = t.mapRect(0, 0, w, h);
    const x1 = qRound(rr.x);
    const y1 = qRound(rr.y);
    const x2 = qRound(rr.x + rr.width);
    const y2 = qRound(rr.y + rr.height);
    fillRectSpans(x1, y1, x2 - x1, y2 - y1, clipBox, rows.add);
  } else {
    const noShear = scaleIsUniform(t);
    if (noShear || type === TxScale) {
      const [ax, ay] = t.map(0, h * 0.5);
      const [bx, by] = t.map(w, h * 0.5);
      const width = noShear ? h / w : Math.abs((t.m22 * h) / (t.m11 * w));
      rasterizeLine(ax, ay, bx, by, width, state.antialias, clipBox, rows.add);
    } else {
      const poly: number[] = [];
      for (const [px, py] of [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
        [0, 0],
      ] as const) {
        const [mx, my] = t.map(px, py);
        poly.push(mx, my);
      }
      if (state.antialias) {
        const mask = rasterizePolygonsAA([poly], clipBox);
        if (mask) maskSpans(mask, rows.add);
      } else {
        rasterizePolygonsAliased([poly], true, clipBox, rows.add);
      }
    }
  }

  const fetch = state.smooth ? fetchBilinear : fetchNearest;
  rows.forEachRun((y, run) => {
    for (let start = 0; start < run.len; start += BUFFER_SIZE) {
      const len = Math.min(BUFFER_SIZE, run.len - start);
      fetch(src, m, run.x + start, y, len, scratch);
      composeChunk(dst, state.mode, y, run.x + start, len, scratch, run.cov, start, intOpacity);
    }
  });
}

/**
 * Antialiased clip for `QPainterPath::addRoundedRect(QRectF(0, 0, w, h), r, r)`
 * mapped by `transform` (libopenshot corner_radius, Clip.cpp:1416-1426).
 */
export function roundedRectClip(w: number, h: number, radius: number, transform: QTransform, width: number, height: number): CoverageMask | null {
  const rx = Math.min(radius, w / 2);
  const ry = Math.min(radius, h / 2);
  const pts: number[] = [];
  const steps = Math.max(8, Math.ceil(Math.sqrt(Math.max(rx, ry)) * 6));
  const corner = (cx: number, cy: number, fromDeg: number): void => {
    for (let i = 0; i <= steps; i += 1) {
      const a = ((fromDeg + (90 * i) / steps) * Math.PI) / 180;
      const [mx, my] = transform.map(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
      pts.push(mx, my);
    }
  };
  // Clockwise on screen (y down): top-left, top-right, bottom-right, bottom-left.
  corner(rx, ry, 180);
  corner(w - rx, ry, 270);
  corner(w - rx, h - ry, 0);
  corner(rx, h - ry, 90);
  return rasterizePolygonsAA([pts], clipBoxFor(width, height));
}
