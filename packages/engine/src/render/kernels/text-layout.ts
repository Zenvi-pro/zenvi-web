/**
 * Shared pieces of the text effects (Caption, Timer): Qt's color and solid-fill
 * semantics, the antialiased rounded background box, drawing host-rasterized
 * text onto a frame, and a built-in approximate font measurer for hosts that
 * provide no `TextRasterizer`.
 *
 * libopenshot paints these effects with a QPainter on the frame's
 * `Format_RGBA8888_Premultiplied` image with `Antialiasing` on
 * (src/effects/Caption.cpp:147-151, Timer.cpp:351-353). Glyph shapes come from
 * the host (`KernelContext.text`); everything else here follows Qt 5.15's
 * raster engine: `QPainter::drawRoundedRect` → `QPaintEngineEx::drawRoundedRect`
 * (qpaintengineex.cpp:770-807) → `QOutlineMapper` curve flattening → gray-raster
 * coverage → `blend_color_generic` + `comp_func_solid_SourceOver_neon`
 * (qdrawhelper.cpp:4493-4523, qdrawhelper_neon.cpp:802-843).
 */

import { byteMul, premultiply, type PremulImage } from "../pixels.js";
import { CompositionMode, composerFor } from "../qt/compose.js";
import { grayRasterize } from "../qt/gray-raster.js";
import { rasterizeLine, type ClipBox, type CoverageMask } from "../qt/rasterizer.js";
import type { RGBA, RgbaImage, TextFont, TextRasterizer, TextRect } from "../types.js";
import { getInt } from "./params.js";

/** The measuring half of `TextRasterizer` (layout never draws). */
export type TextMeasurer = Pick<TextRasterizer, "fontMetrics" | "advance" | "bounds" | "inkBounds">;

export type Rgb = [number, number, number];

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

const F64 = new Float64Array(1);
const U64 = new BigUint64Array(F64.buffer);

/** A finite double as `m · 2^e` with an integer mantissa (exact). */
function decompose(x: number): [bigint, number] {
  F64[0] = x;
  const bits = U64[0]!;
  const biased = Number((bits >> 52n) & 0x7ffn);
  let mant = bits & 0xfffffffffffffn;
  let exp = -1074;
  if (biased !== 0) {
    mant |= 1n << 52n;
    exp = biased - 1075;
  }
  return [bits >> 63n ? -mant : mant, exp];
}

/**
 * `fma(a, b, c)`: `a·b + c` rounded once, as the arm64 desktop build computes
 * the expressions clang contracts into `fmadd`/`fmsub` (e.g. Caption.cpp:180
 * `W - W*right`, Timer.cpp:338-339 offsets). JavaScript has no FMA, so the
 * exact sum is formed with BigInt and rounded to nearest-even by `Number()`.
 */
export function fusedMulAdd(a: number, b: number, c: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || a === 0 || b === 0) return a * b + c;
  if (c === 0) return a * b;
  const [ma, ea] = decompose(a);
  const [mb, eb] = decompose(b);
  const [mc, ec] = decompose(c);
  const ep = ea + eb;
  const e = Math.min(ep, ec);
  let sum = ((ma * mb) << BigInt(ep - e)) + (mc << BigInt(ec - e));
  if (sum === 0n) return 0;
  // Keep 64 significant bits plus a sticky bit so Number() rounds exactly once.
  const neg = sum < 0n;
  if (neg) sum = -sum;
  let shift = sum.toString(2).length - 64;
  if (shift > 0) {
    const sticky = (sum & ((1n << BigInt(shift)) - 1n)) !== 0n ? 1n : 0n;
    sum = (sum >> BigInt(shift)) | sticky;
  } else shift = 0;
  const v = Number(sum) * 2 ** (e + shift);
  return neg ? -v : v;
}

/** `QRectF::isEmpty()`: width or height not positive. */
export function isEmptyRect(r: TextRect): boolean {
  return !(r.width > 0) || !(r.height > 0);
}

// ---------------------------------------------------------------------------
// Colors (Color.cpp:47-55, qcolor.cpp:1365-1379, :1526-1535)
// ---------------------------------------------------------------------------

/**
 * `QColor(QString(Color::GetColorHex(n)))`: each channel is `Keyframe::GetInt`
 * (round half away). `QColor(r, g, b, a)` rejects any channel outside 0..255
 * (alpha included) and its `name()` is then "#000000", so an overshooting
 * keyframe turns the color black, not clamped. The alpha itself is dropped.
 */
export function hexColor(c: RGBA): Rgb {
  const r = getInt(c[0]);
  const g = getInt(c[1]);
  const b = getInt(c[2]);
  const a = getInt(c[3]);
  const ok = (v: number): boolean => v >= 0 && v <= 255;
  return ok(r) && ok(g) && ok(b) && ok(a) ? [r, g, b] : [0, 0, 0];
}

/** `QColor::setAlphaF`: clamped to [0, 1], stored as `qRound(alpha · 65535)`. */
export function alpha16(alphaF: number): number {
  if (Number.isNaN(alphaF)) return 0;
  const a = alphaF < 0 ? 0 : alphaF > 1 ? 1 : alphaF;
  return Math.floor(a * 65535 + 0.5);
}

/** `QRgba64::premultiplied()` on one 16-bit channel (qrgba64.h). */
function premul16(c: number, a: number): number {
  if (a === 65535) return c;
  if (a === 0) return 0;
  const t = c * a;
  return Math.floor((t + Math.floor(t / 65536) + 0x8000) / 65536);
}

/** `QRgba64::toArgb32()` rounding of one channel: ((x + 0x80) - ((x + 0x80) >> 8)) >> 8 (measured on 5.15.19). */
function to8(x: number): number {
  const t = x + 0x80;
  return (t - (t >> 8)) >> 8;
}

/**
 * The premultiplied 8-bit color the raster engine fills a solid brush with:
 * `qPremultiply(combineAlpha256(color.rgba64(), 256)).toArgb32()`
 * (qpaintengine_raster.cpp:4539-4545, qdrawhelper.cpp:4498).
 */
export function solidPremul(rgb: Rgb, a16: number): RGBA {
  return [to8(premul16(rgb[0] * 257, a16)), to8(premul16(rgb[1] * 257, a16)), to8(premul16(rgb[2] * 257, a16)), to8(a16)];
}

/** A straight 0..255 RGBA for the host rasterizer (the brush's 8-bit alpha). */
export function straightColor(rgb: Rgb, a16: number): RGBA {
  return [rgb[0], rgb[1], rgb[2], to8(a16)];
}

// ---------------------------------------------------------------------------
// Clip regions
// ---------------------------------------------------------------------------

/** Integer device region: pixels [x0, x1) × [y0, y1), optionally with antialiased coverage. */
export interface ClipRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Coverage of a path clip (`QPainter::setClipRect` with a non-rect QRectF); none = hard rect. */
  mask?: CoverageMask;
}

/** The whole image. */
export function imageRegion(width: number, height: number): ClipRegion {
  return { x0: 0, y0: 0, x1: width, y1: height };
}

function regionBox(region: ClipRegion): ClipBox {
  return { left: region.x0, top: region.y0, right: region.x1 - 1, bottom: region.y1 - 1 };
}

/**
 * `QPainter::setClipRect(QRectF)` on the raster engine (qpainter.cpp
 * setClipRect → qpaintengine_raster.cpp:1207-1240). A rectangle with positive
 * width and height becomes the hard clip `toAlignedRect()` (floor/ceil).
 * Anything else fails `QVectorPath::isRect()` and is rasterized as an
 * antialiased path clip: empty for zero width or height, the mirrored
 * rectangle for a negative width. Returns null when nothing is visible.
 */
export function clipRectRegion(x: number, y: number, w: number, h: number, width: number, height: number): ClipRegion | null {
  if (w > 0 && h > 0) {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(width, Math.ceil(x + w));
    const y1 = Math.min(height, Math.ceil(y + h));
    return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
  }
  if (w === 0 || h === 0 || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  const mask = grayRasterize([[x, y, x + w, y, x + w, y + h, x, y + h]], true, width, height);
  if (!mask) return null;
  return { x0: mask.x, y0: mask.y, x1: mask.x + mask.width, y1: mask.y + mask.height, mask };
}

/** `qt_div_255(coverage · clipCoverage)` (qpaintengine_raster.cpp:4127). */
function clipCoverage(region: ClipRegion, x: number, y: number, coverage: number): number {
  const m = region.mask;
  if (!m) return coverage;
  const c = m.data[(y - m.y) * m.width + (x - m.x)]!;
  const t = coverage * c;
  return (t + (t >> 8) + 0x80) >> 8;
}

// ---------------------------------------------------------------------------
// Solid fills
// ---------------------------------------------------------------------------

/** `comp_func_solid_SourceOver_neon` for one pixel at byte offset `i` with span coverage `cov`. */
function blendSolidPixel(d: Uint8ClampedArray, i: number, color: RGBA, cov: number): void {
  if (cov === 255 && color[3] === 255) {
    d[i] = color[0];
    d[i + 1] = color[1];
    d[i + 2] = color[2];
    d[i + 3] = 255;
    return;
  }
  let r = color[0];
  let g = color[1];
  let b = color[2];
  let a = color[3];
  if (cov !== 255) {
    r = byteMul(r, cov);
    g = byteMul(g, cov);
    b = byteMul(b, cov);
    a = byteMul(a, cov);
  }
  const ia = 255 - a;
  d[i] = r + byteMul(d[i]!, ia);
  d[i + 1] = g + byteMul(d[i + 1]!, ia);
  d[i + 2] = b + byteMul(d[i + 2]!, ia);
  d[i + 3] = a + byteMul(d[i + 3]!, ia);
}

export { grayRasterize };

/** QPainterPath KAPPA (qstroker_p.h QT_PATH_KAPPA). */
const KAPPA = 0.5522847498;

/**
 * `QBezier::addToPolygon` (qbezier.cpp): iterative de Casteljau subdivision,
 * at most 9 levels, a segment is flat when its control points are within
 * `threshold` of the chord. `QOutlineMapper` uses 0.25 at identity scale.
 * Appends the end points (not the start point) to `out`.
 */
export function flattenBezier(out: number[], x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number, threshold = 0.25): void {
  const bz = new Float64Array(80);
  const lvl = new Int32Array(10);
  bz.set([x1, y1, x2, y2, x3, y3, x4, y4], 0);
  lvl[0] = 9;
  let b = 0;
  while (b >= 0) {
    const o = b * 8;
    const bx1 = bz[o]!;
    const by1 = bz[o + 1]!;
    const bx2 = bz[o + 2]!;
    const by2 = bz[o + 3]!;
    const bx3 = bz[o + 4]!;
    const by3 = bz[o + 5]!;
    const bx4 = bz[o + 6]!;
    const by4 = bz[o + 7]!;
    const y4y1 = by4 - by1;
    const x4x1 = bx4 - bx1;
    let l = Math.abs(x4x1) + Math.abs(y4y1);
    let d: number;
    if (l > 1) {
      d = Math.abs(x4x1 * (by1 - by2) - y4y1 * (bx1 - bx2)) + Math.abs(x4x1 * (by1 - by3) - y4y1 * (bx1 - bx3));
    } else {
      d = Math.abs(bx1 - bx2) + Math.abs(by1 - by2) + Math.abs(bx1 - bx3) + Math.abs(by1 - by3);
      l = 1;
    }
    if (d < threshold * l || lvl[b] === 0) {
      out.push(bx4, by4);
      b -= 1;
    } else {
      // QBezier::split(firstHalf = b + 1, secondHalf = b): the first half is processed next.
      const f = o + 8;
      let c = (bx2 + bx3) * 0.5;
      const fx2 = (bx1 + bx2) * 0.5;
      const sx3 = (bx3 + bx4) * 0.5;
      const fx3 = (fx2 + c) * 0.5;
      const sx2 = (sx3 + c) * 0.5;
      const mx = (fx3 + sx2) * 0.5;
      c = (by2 + by3) / 2;
      const fy2 = (by1 + by2) * 0.5;
      const sy3 = (by3 + by4) * 0.5;
      const fy3 = (fy2 + c) * 0.5;
      const sy2 = (sy3 + c) * 0.5;
      const my = (fy3 + sy2) * 0.5;
      bz.set([bx1, by1, fx2, fy2, fx3, fy3, mx, my], f);
      bz.set([mx, my, sx2, sy2, sx3, sy3, bx4, by4], o);
      lvl[b] = lvl[b]! - 1;
      lvl[b + 1] = lvl[b]!;
      b += 1;
    }
  }
}

/**
 * The outline `QPaintEngineEx::drawRoundedRect(rect, r, r)` fills
 * (qpaintengineex.cpp:770-807): radii clamped to half the size, four cubic
 * quarter-circle approximations, flattened like the outline mapper.
 */
export function roundedRectPolygon(x: number, y: number, w: number, h: number, radius: number): number[] {
  const x1 = x;
  const x2 = x + w;
  const y1 = y;
  const y2 = y + h;
  const xr = Math.min(radius, w / 2);
  const yr = Math.min(radius, h / 2);
  const k = 1 - KAPPA;
  const pts: number[] = [x1 + xr, y1, x2 - xr, y1];
  flattenBezier(pts, x2 - xr, y1, x2 - k * xr, y1, x2, y1 + k * yr, x2, y1 + yr);
  pts.push(x2, y2 - yr);
  flattenBezier(pts, x2, y2 - yr, x2, y2 - k * yr, x2 - k * xr, y2, x2 - xr, y2);
  pts.push(x1 + xr, y2);
  flattenBezier(pts, x1 + xr, y2, x1 + k * xr, y2, x1, y2 - k * yr, x1, y2 - yr);
  pts.push(x1, y1 + yr);
  flattenBezier(pts, x1, y1 + yr, x1, y1 + k * yr, x1 + k * xr, y1, x1 + xr, y1);
  return pts;
}

/** An axis-aligned rectangle in pixels (QRectF). */
export interface RectF {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * `QPainter::drawRoundedRect(rect, radius, radius)` with a solid brush, no
 * pen, antialiasing on, SourceOver, clipped to `region`. A radius <= 0 draws a
 * plain rectangle (`drawRect` → `QRasterizer::rasterizeLine`,
 * qpaintengine_raster.cpp drawRects); otherwise the rounded path goes through
 * the antialiased polygon rasterizer. Non-positive sizes draw nothing (Qt
 * rasterizes a degenerate or self-intersecting path for negative sizes).
 */
export function fillRoundedRect(image: PremulImage, rect: RectF, radius: number, color: RGBA, region: ClipRegion): void {
  if (color[3] === 0 && color[0] === 0 && color[1] === 0 && color[2] === 0) return; // transparent brush: type None
  if (!(rect.width > 0) || !(rect.height > 0)) return;
  const box = regionBox(region);
  if (box.right < box.left || box.bottom < box.top) return;
  const d = image.data;
  const W = image.width;
  const put = (x: number, y: number, len: number, coverage: number): void => {
    const from = Math.max(x, region.x0);
    const to = Math.min(x + len, region.x1);
    if (y < region.y0 || y >= region.y1) return;
    for (let px = from; px < to; px += 1) {
      const cov = clipCoverage(region, px, y, coverage);
      if (cov > 0) blendSolidPixel(d, (y * W + px) * 4, color, cov);
    }
  };
  if (!(radius > 0)) {
    // drawRects: a = (topLeft + bottomLeft) * 0.5, b = (topRight + bottomRight) * 0.5.
    const ay = (rect.y + (rect.y + rect.height)) * 0.5;
    const right = rect.x + rect.width;
    rasterizeLine(rect.x, ay, right, ay, rect.height / rect.width, true, box, put);
    return;
  }
  const mask = grayRasterize([roundedRectPolygon(rect.x, rect.y, rect.width, rect.height, radius)], true, image.width, image.height);
  if (!mask) return;
  for (let row = 0; row < mask.height; row += 1) {
    const y = mask.y + row;
    for (let col = 0; col < mask.width; col += 1) {
      const c = mask.data[row * mask.width + col]!;
      if (c > 0) put(mask.x + col, y, 1, c);
    }
  }
}

// ---------------------------------------------------------------------------
// Host text drawing
// ---------------------------------------------------------------------------

/**
 * One `QPainter::drawPath` of a text path: the host rasterizes `text` into a
 * fresh transparent straight-RGBA layer around its ink (plus the stroke and an
 * antialiasing margin, limited to `region`), which is premultiplied and
 * composited SourceOver onto `image`. Separate calls compose in call order,
 * like consecutive `drawPath` calls. Text without ink draws nothing.
 */
export function drawTextPath(
  image: PremulImage,
  raster: TextRasterizer,
  text: string,
  x: number,
  y: number,
  font: TextFont,
  ink: TextRect,
  fill: RGBA,
  stroke: RGBA | null,
  strokeWidth: number,
  region: ClipRegion,
): void {
  if (text.length === 0 || isEmptyRect(ink)) return;
  const margin = Math.ceil(Math.max(0, strokeWidth)) + 2 + Math.ceil(font.pixelSize * 0.25);
  const x0 = Math.max(region.x0, Math.floor(x + ink.x) - margin);
  const y0 = Math.max(region.y0, Math.floor(y + ink.y) - margin);
  const x1 = Math.min(region.x1, Math.ceil(x + ink.x + ink.width) + margin);
  const y1 = Math.min(region.y1, Math.ceil(y + ink.y + ink.height) + margin);
  if (!(x1 > x0) || !(y1 > y0)) return;
  const lw = x1 - x0;
  const lh = y1 - y0;
  const layer: RgbaImage = { width: lw, height: lh, data: new Uint8ClampedArray(lw * lh * 4) };
  raster.drawText(layer, text, x - x0, y - y0, font, fill, stroke, stroke ? strokeWidth : 0);
  const src = premultiply(layer);
  const compose = composerFor(CompositionMode.SourceOver);
  const d = image.data;
  for (let row = 0; row < lh; row += 1) {
    const di = ((y0 + row) * image.width + x0) * 4;
    const si = row * lw * 4;
    if (!region.mask) {
      compose(d, di, src.data, si, lw, 255);
      continue;
    }
    for (let col = 0; col < lw; col += 1) {
      const cov = clipCoverage(region, x0 + col, y0 + row, 255);
      if (cov > 0) compose(d, di + col * 4, src.data, si + col * 4, 1, cov);
    }
  }
}

// ---------------------------------------------------------------------------
// Approximate metrics for hosts without a TextRasterizer
// ---------------------------------------------------------------------------

/** Helvetica/Arial advance widths for U+0020..U+007E in 1/1000 em. */
const ASCII_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278,
  278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556,
  556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    cp >= 0x1f300
  );
}

function charWidthEm(cp: number): number {
  if (cp >= 0x20 && cp <= 0x7e) return ASCII_WIDTHS[cp - 0x20]! / 1000;
  if (cp < 0x20 || (cp >= 0x300 && cp <= 0x36f) || cp === 0x200b || cp === 0xfeff) return 0;
  return isWide(cp) ? 1 : 0.556;
}

const INVISIBLE = /^[\s\u200b\ufeff]*$/u;
const TALL = /[^acegmnopqrsuvwxyz\s.,:;\-_~=+*'"`^]/u;
const DESCENDER = /[gjpqyQ,;()[\]{}|@$]/u;

function approximateAdvance(text: string, font: TextFont): number {
  let w = 0;
  for (const ch of text) w += charWidthEm(ch.codePointAt(0)!);
  return w * font.pixelSize;
}

/**
 * Deterministic Helvetica-like metrics (ascent .93, descent .23, line spacing
 * 1.16 em; Helvetica advances). Used only to place Caption/Timer backgrounds
 * when the host has no `TextRasterizer`: no glyphs are drawn then.
 */
export const approximateMetrics: TextMeasurer = {
  fontMetrics(font) {
    const px = font.pixelSize;
    return { ascent: px * 0.93, descent: px * 0.23, lineSpacing: px * 1.16 };
  },
  advance: approximateAdvance,
  bounds(text, font) {
    const px = font.pixelSize;
    return { x: 0, y: -px * 0.93, width: approximateAdvance(text, font), height: px * 1.16 };
  },
  inkBounds(text, font) {
    if (INVISIBLE.test(text)) return { x: 0, y: 0, width: 0, height: 0 };
    const px = font.pixelSize;
    const top = TALL.test(text) ? 0.716 : 0.519;
    const bottom = DESCENDER.test(text) ? 0.21 : 0.012;
    const adv = approximateAdvance(text, font);
    return { x: px * 0.05, y: -top * px, width: Math.max(0, adv - px * 0.1), height: (top + bottom) * px };
  },
};
