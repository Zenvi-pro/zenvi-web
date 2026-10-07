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
import { fma } from "./fma.js";
import { grayRasterize } from "./gray-raster.js";
import { outlineContours, PainterPath } from "./path.js";
import { clipBoxFor, fillRectSpans, rasterizeLine, rasterizePolygonsAliased, type ClipBox } from "./rasterizer.js";
import { BUFFER_SIZE, ClipData, deliverSpans, handleSpans, maskSpans, type FetchRun, type Span } from "./spans.js";
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
  /** Path clip (`QPainter::setClipPath`, e.g. `roundedRectClip`), or none. */
  clip?: ClipData | null;
}

const FIXED = 65536;
const HALF = 32768;

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
  const f1 = fma(inv.m11, inv.m11, inv.m21 * inv.m21);
  const f2 = fma(inv.m12, inv.m12, inv.m22 * inv.m22);
  const fast = f1 < 1e4 && f2 < 1e4 && f1 > 1 / 65536 && f2 > 1 / 65536 && Math.abs(inv.dx) < 1e4 && Math.abs(inv.dy) < 1e4;
  return { m11: inv.m11, m12: inv.m12, m21: inv.m21, m22: inv.m22, dx: inv.dx, dy: inv.dy, fast };
}

/** `m21·cy + m11·cx + dx` as compiled (fused left product, qdrawhelper.cpp:3433). */
function sourceX(m: TextureMatrix, cx: number, cy: number): number {
  return fma(m.m21, cy, m.m11 * cx) + m.dx;
}

function sourceY(m: TextureMatrix, cx: number, cy: number): number {
  return fma(m.m22, cy, m.m12 * cx) + m.dy;
}

/** canUseFastMatrixPath (qdrawhelper.cpp:2081-2096). */
function fastPathFits(m: TextureMatrix, cx: number, cy: number, length: number): boolean {
  if (!m.fast) return false;
  let fx = sourceX(m, cx, cy) * FIXED;
  let fy = sourceY(m, cx, cy) * FIXED;
  let minc = Math.min(fx, fy);
  let maxc = Math.max(fx, fy);
  fx = fma(Math.trunc(m.m11 * FIXED), length, fx);
  fy = fma(Math.trunc(m.m12 * FIXED), length, fy);
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
    let fx = Math.trunc(sourceX(m, cx, cy) * FIXED) - HALF;
    let fy = Math.trunc(sourceY(m, cx, cy) * FIXED) - HALF;
    for (let i = 0; i < length; i += 1) {
      sampleBilinear(src, fx >> 16, fy >> 16, (fx & 0xffff) >> 8, (fy & 0xffff) >> 8, out, i * 4);
      fx = (fx + fdx) | 0;
      fy = (fy + fdy) | 0;
    }
    return;
  }
  // Float path (large or degenerate matrices).
  let fx = sourceX(m, cx, cy);
  let fy = sourceY(m, cx, cy);
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
    let fx = Math.trunc(sourceX(m, cx, cy) * FIXED);
    let fy = Math.trunc(sourceY(m, cx, cy) * FIXED);
    for (let i = 0; i < length; i += 1) {
      put(fx >> 16, fy >> 16, i);
      fx = (fx + fdx) | 0;
      fy = (fy + fdy) | 0;
    }
    return;
  }
  let fx = sourceX(m, cx, cy);
  let fy = sourceY(m, cx, cy);
  for (let i = 0; i < length; i += 1) {
    put(Math.trunc(fx) - (fx < 0 ? 1 : 0), Math.trunc(fy) - (fy < 0 ? 1 : 0), i);
    fx += m.m11;
    fy += m.m12;
  }
}

/** Spans of `fillRect_normalized` (qpaintengine_raster.cpp): the rect clipped to the clip's bounds or the device. */
function rectSpans(x: number, y: number, w: number, h: number, device: ClipBox, clip: ClipData | null | undefined): Span[] {
  const spans: Span[] = [];
  const sink = (sx: number, sy: number, len: number, coverage: number): void => {
    spans.push({ x: sx, y: sy, len, coverage });
  };
  if (clip) {
    const x1 = Math.max(x, clip.xmin);
    const x2 = Math.min(x + w, clip.xmax);
    const y1 = Math.max(y, clip.ymin);
    const y2 = Math.min(y + h, clip.ymax);
    if (x2 > x1 && y2 > y1) for (let row = y1; row < y2; row += 1) sink(x1, row, x2 - x1, 255);
    return spans;
  }
  fillRectSpans(x, y, w, h, device, sink);
  return spans;
}

/** `QRasterPaintEnginePrivate::initializeRasterizer`'s clip rect: the device, intersected with the clip's bounds. */
function rasterizerBox(device: ClipBox, clip: ClipData | null | undefined): ClipBox {
  if (!clip) return device;
  return {
    left: Math.max(device.left, clip.xmin),
    top: Math.max(device.top, clip.ymin),
    right: Math.min(device.right, clip.xmax - 1),
    bottom: Math.min(device.bottom, clip.ymax - 1),
  };
}

/** Draw `src` at the origin under `state` onto `dst`, like the Qt raster engine. */
export function drawImage(dst: PremulImage, src: PremulImage, state: PainterState): void {
  if (src.width <= 0 || src.height <= 0 || dst.width <= 0 || dst.height <= 0) return;
  const intOpacity = Math.trunc(Math.min(1, Math.max(0, state.opacity)) * 256);
  if (intOpacity === 0) return;
  const clip = state.clip ?? null;
  if (clip && clip.spans.length === 0) return;
  const t = state.transform;
  const type = t.type();
  const device: ClipBox = clipBoxFor(dst.width, dst.height);
  const compose = composerFor(state.mode);
  const process = (x: number, y: number, len: number, coverage: number, fetched: Uint8ClampedArray, offset: number): void => {
    if (coverage > 0) compose(dst.data, (y * dst.width + x) * 4, fetched, offset * 4, len, coverage);
  };

  if (type <= TxTranslate) {
    // drawImage(QPointF): integer placement at qRound(pt) (untransformed fetch).
    const ox = qRound(t.dx);
    const oy = qRound(t.dy);
    if (!state.smooth && state.mode === CompositionMode.SourceOver && !clip) {
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
    const fetch: FetchRun = (x, y, length) => {
      const from = ((y - oy) * src.width + (x - ox)) * 4;
      return src.data.subarray(from, from + length * 4);
    };
    deliverSpans(rectSpans(ox, oy, src.width, src.height, device, clip), clip, (chunk) => handleSpans(chunk, intOpacity, fetch, process));
    return;
  }

  const w = src.width;
  const h = src.height;

  if (w === 1 && h === 1 && type <= TxScale && !state.antialias) {
    // 1×1 source: Qt fills the mapped rect with the (opacity-scaled) color.
    const rr = t.mapRect(0, 0, 1, 1);
    const x1 = qRound(rr.x);
    const y1 = qRound(rr.y);
    const color = new Uint8ClampedArray(4);
    for (let c = 0; c < 4; c += 1) {
      const c16 = ((src.data[c]! * 257 * intOpacity) >> 8) >>> 0;
      color[c] = (c16 - (c16 >> 8) + 0x80) >> 8;
    }
    let solid = new Uint8ClampedArray(0);
    const fetch: FetchRun = (_x, _y, length) => {
      if (solid.length < length * 4) {
        solid = new Uint8ClampedArray(length * 4);
        for (let i = 0; i < length; i += 1) solid.set(color, i * 4);
      }
      return solid;
    };
    const spans = rectSpans(x1, y1, qRound(rr.x + rr.width) - x1, qRound(rr.y + rr.height) - y1, device, clip);
    deliverSpans(spans, clip, (chunk) => handleSpans(chunk, 256, fetch, process));
    return;
  }

  const m = setupMatrix(t);
  if (!m) return;

  let spans: Span[];
  const sink = (x: number, y: number, len: number, coverage: number): void => {
    spans.push({ x, y, len, coverage });
  };
  spans = [];
  if (!state.antialias && type === TxScale) {
    const rr = t.mapRect(0, 0, w, h);
    const x1 = qRound(rr.x);
    const y1 = qRound(rr.y);
    const x2 = qRound(rr.x + rr.width);
    const y2 = qRound(rr.y + rr.height);
    spans = rectSpans(x1, y1, x2 - x1, y2 - y1, device, clip);
  } else {
    const noShear = scaleIsUniform(t);
    if (noShear || type === TxScale) {
      const [ax, ay] = t.map(0, h * 0.5);
      const [bx, by] = t.map(w, h * 0.5);
      const width = noShear ? h / w : Math.abs((t.m22 * h) / (t.m11 * w));
      rasterizeLine(ax, ay, bx, by, width, state.antialias, rasterizerBox(device, clip), sink);
    } else if (state.antialias) {
      // fillPath → QOutlineMapper → gray raster (qpaintengine_raster.cpp fillPath).
      const path = new PainterPath();
      path.addRect(0, 0, w, h);
      const mask = grayRasterize(outlineContours(path, t), true, dst.width, dst.height);
      spans = mask ? maskSpans(mask) : [];
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
      rasterizePolygonsAliased([poly], true, rasterizerBox(device, clip), sink);
    }
  }

  const scratch = new Uint8ClampedArray(BUFFER_SIZE * 4);
  const sample = state.smooth ? fetchBilinear : fetchNearest;
  const fetch: FetchRun = (x, y, length) => {
    sample(src, m, x, y, length, scratch);
    return scratch;
  };
  deliverSpans(spans, clip, (chunk) => handleSpans(chunk, intOpacity, fetch, process));
}

/**
 * libopenshot's corner-radius clip (Clip.cpp:1415-1426):
 * `QPainterPath::addRoundedRect(QRectF(0, 0, w, h), radius, radius)` set
 * with `setClipPath` under `transform` with antialiasing, i.e. flattened by
 * the outline mapper and scan-converted by the gray raster.
 */
export function roundedRectClip(w: number, h: number, radius: number, transform: QTransform, width: number, height: number): ClipData {
  const path = new PainterPath();
  path.addRoundedRect(0, 0, w, h, radius, radius);
  return ClipData.fromMask(grayRasterize(outlineContours(path, transform), true, width, height));
}
