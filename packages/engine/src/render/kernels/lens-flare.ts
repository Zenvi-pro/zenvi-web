/**
 * Lens Flare, ported from libopenshot src/effects/LensFlare.cpp:83-362 (after
 * GIMP FlareFX): five concentric layers (core, glow, inner ring, outer ring,
 * halo) plus 19 reflectors are accumulated into a straight-alpha ARGB32
 * overlay with `a = max(r, g, b)`, drawn onto the frame with QPainter
 * `CompositionMode_Plus` at opacity `brightness`, and the frame's alpha is
 * rebuilt as `max(original, overlay * brightness)` through
 * `QImage::setAlphaChannel`, which multiplies all four premultiplied bytes.
 *
 * Colors go through QColor exactly: `fromRgbF` quantizes to 16 bits per
 * channel, and the reflector tint is an HSV shift whose `QColor::toRgb` uses
 * a fused `1 - s*f` in the arm64 Qt 5.15 build (qcolor.cpp:2069-2092,
 * checked in the PyQt5 5.15.19 QtGui binary).
 *
 * Divergence (docs/PARITY.md): tint channels outside 0..255 are clamped. The
 * C++ divides them by 255 and passes them to `QColor::fromRgbF` unclamped
 * (LensFlare.cpp:244-249). There they become an ExtendedRgb float16 color, or
 * an invalid black tint when alpha is out of range.
 *
 * This module also hosts the float helpers the light kernels share (`fmaf`,
 * `fmaExact`).
 */

import { byteMul, qRound, type PremulImage } from "../pixels.js";
import { CompositionMode, composerFor } from "../qt/compose.js";
import { fma, fmaf } from "../qt/fma.js";
import { fuzzyCompare, fuzzyIsNull } from "../qt/transform.js";
import { color, num } from "./params.js";
import type { KernelSpec, Params } from "./types.js";

const f32 = Math.fround;

// ---------------------------------------------------------------------------
// Float helpers shared by the light kernels
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// QColor (qtbase 5.15 src/gui/painting/qcolor.cpp), the parts LensFlare uses
// ---------------------------------------------------------------------------

const USHRT_MAX = 65535;

/** A QColor in the Rgb spec: 16-bit channels (`ct.argb`). */
interface Rgb16 {
  a: number;
  r: number;
  g: number;
  b: number;
}

/** A QColor in the Hsv spec: hue in 1/100 degree (65535 = achromatic), 16-bit s, v (`ct.ahsv`). */
interface Hsv16 {
  a: number;
  h: number;
  s: number;
  v: number;
}

/** `QColor::fromRgbF` for in-range components (qcolor.cpp:2442-2470). */
function fromRgbF(r: number, g: number, b: number, a: number): Rgb16 {
  return { a: qRound(a * USHRT_MAX), r: qRound(r * USHRT_MAX), g: qRound(g * USHRT_MAX), b: qRound(b * USHRT_MAX) };
}

/** `QColor::toHsv` from Rgb (qcolor.cpp:2203-2244). */
function toHsv(c: Rgb16): Hsv16 {
  const r = c.r / USHRT_MAX;
  const g = c.g / USHRT_MAX;
  const b = c.b / USHRT_MAX;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const v = qRound(max * USHRT_MAX);
  if (fuzzyIsNull(delta)) return { a: c.a, h: USHRT_MAX, s: 0, v };
  const s = qRound((delta / max) * USHRT_MAX);
  let hue = 0;
  if (fuzzyCompare(r, max)) hue = (g - b) / delta;
  else if (fuzzyCompare(g, max)) hue = 2 + (b - r) / delta;
  else if (fuzzyCompare(b, max)) hue = 4 + (r - g) / delta;
  hue *= 60;
  if (hue < 0) hue += 360;
  return { a: c.a, h: qRound(hue * 100), s, v };
}

/** `QColor::setHsvF` for in-range components (qcolor.cpp:1085-1102). */
function fromHsvF(h: number, s: number, v: number, a: number): Hsv16 {
  return { a: qRound(a * USHRT_MAX), h: h === -1 ? USHRT_MAX : qRound(h * 36000), s: qRound(s * USHRT_MAX), v: qRound(v * USHRT_MAX) };
}

/** `QColor::toRgb` from Hsv (qcolor.cpp:2050-2117); `1 - s*f` is fused in the arm64 build. */
function hsvToRgb(c: Hsv16): Rgb16 {
  if (c.s === 0 || c.h === USHRT_MAX) return { a: c.a, r: c.v, g: c.v, b: c.v };
  const h = c.h === 36000 ? 0 : c.h / 6000;
  const s = c.s / USHRT_MAX;
  const v = c.v / USHRT_MAX;
  const i = Math.trunc(h);
  const f = h - i;
  const p = qRound(v * (1 - s) * USHRT_MAX);
  const vv = qRound(v * USHRT_MAX);
  if (i & 1) {
    const q = qRound(v * fma(-s, f, 1) * USHRT_MAX);
    if (i === 1) return { a: c.a, r: q, g: vv, b: p };
    if (i === 3) return { a: c.a, r: p, g: q, b: vv };
    return { a: c.a, r: vv, g: p, b: q };
  }
  const t = qRound(v * fma(-s, 1 - f, 1) * USHRT_MAX);
  if (i === 0) return { a: c.a, r: vv, g: t, b: p };
  if (i === 2) return { a: c.a, r: p, g: vv, b: t };
  return { a: c.a, r: t, g: p, b: vv };
}

/** `redF()`, `greenF()`, `blueF()` of an Rgb color. */
function channelsF(c: Rgb16): [number, number, number] {
  return [c.r / USHRT_MAX, c.g / USHRT_MAX, c.b / USHRT_MAX];
}

/** `shifted_hsv` (LensFlare.cpp:106-127). The scale arguments arrive as floats. */
function shiftedHsv(base: Rgb16, hShift: number, sScale: number, vScale: number, aScale: number): Hsv16 {
  const hsv = toHsv(base);
  let h = hsv.h === USHRT_MAX ? -1 : hsv.h / 36000;
  const s = hsv.s / USHRT_MAX;
  const v = hsv.v / USHRT_MAX;
  const a = hsv.a / USHRT_MAX;
  if (s === 0) h = 0;
  h = (h + hShift + 1) % 1;
  const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
  return fromHsvF(h, clamp01(s * sScale), clamp01(v * vScale), clamp01(a * aScale));
}

// ---------------------------------------------------------------------------
// The flare
// ---------------------------------------------------------------------------

/** Reflector table (LensFlare.cpp:138-159): type, position factor (fx == fy), size factor, base color. */
const REFLECTORS: readonly (readonly [number, number, number, number, number, number])[] = [
  [1, 0.6699, 0.027, 0, 14, 113],
  [1, 0.2692, 0.01, 90, 181, 142],
  [1, -0.0112, 0.005, 56, 140, 106],
  [2, 0.649, 0.031, 9, 29, 19],
  [2, 0.4696, 0.015, 24, 14, 0],
  [2, 0.4087, 0.037, 24, 14, 0],
  [2, -0.2003, 0.022, 42, 19, 0],
  [2, -0.4103, 0.025, 0, 9, 17],
  [2, -0.4503, 0.058, 10, 4, 0],
  [2, -0.5112, 0.017, 5, 5, 14],
  [2, -1.496, 0.2, 9, 4, 0],
  [2, -1.496, 0.5, 9, 4, 0],
  [3, 0.4487, 0.075, 34, 19, 0],
  [3, 1.0, 0.1, 14, 26, 0],
  [3, -1.301, 0.039, 10, 25, 13],
  [4, 1.309, 0.19, 9, 0, 17],
  [4, 1.309, 0.195, 9, 16, 5],
  [4, 1.309, 0.2, 17, 4, 0],
  [4, -1.301, 0.038, 17, 4, 0],
];

/**
 * The reflectors in struct-of-arrays form for the pixel loop. `den` is the
 * weight's denominator per type and `bound` a cull radius: a pixel whose
 * `|dx|` or `|dy|` reaches it cannot contribute (`hypotf(dx, dy) >= |dx|`
 * exactly in float). Types 1-3 need `d < size`. Type 4 needs
 * `|d - size| < 0.04 size`, culled with a 5% margin. Culling is off for
 * `size <= 0`, where the C++ weights do not vanish.
 */
interface Reflectors {
  type: Int8Array;
  x: Float64Array;
  y: Float64Array;
  size: Float64Array;
  den: Float64Array;
  bound: Float64Array;
  r: Float64Array;
  g: Float64Array;
  b: Float64Array;
}

/** `x / 255.0f` of an integer constant: a float quotient. */
function byteF(x: number): number {
  return f32(x / 255);
}

/** `int d = (255 - c) * p * colorF; clamp(c + d, 0, 255)` (blendAdd, LensFlare.cpp:91-103). */
function addChannel(c: number, p: number, cf: number): number {
  const v = c + Math.trunc(f32((255 - c) * p) * cf);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

const F0_15 = f32(0.15);
const F0_12 = f32(0.12);
const F0_04 = f32(0.04);
const F0_07 = f32(0.07);

/** LensFlare::GetFrame (LensFlare.cpp:222-362). */
function lensFlareKernel(image: PremulImage, params: Params): void {
  const w = image.width;
  const h = image.height;
  if (w <= 0 || h <= 0) return;
  const X = f32(num(params, "x", -0.5));
  const Y = f32(num(params, "y", -0.5));
  const I = f32(num(params, "brightness", 1));
  const S = f32(num(params, "size", 1));
  const SP = f32(num(params, "spread", 1));

  const halfW = f32(w * 0.5);
  const halfH = f32(h * 0.5);
  const px = f32(fmaf(X, 0.5, 0.5) * w);
  const py = f32(fmaf(Y, 0.5, 0.5) * h);
  const DX = f32(f32(halfW - px) * SP);
  const DY = f32(f32(halfH - py) * SP);

  const c = color(params, "color", [255, 255, 255, 255]);
  const ch = (v: number): number => Math.min(255, Math.max(0, v)) / 255;
  const tint = fromRgbF(ch(c[0]), ch(c[1]), ch(c[2]), ch(c[3]));
  const [tr, tg, tb] = channelsF(tint);
  const ta = tint.a / USHRT_MAX;

  const matt = w;
  const scolor = f32(f32(matt * f32(0.0375)) * S);
  const sglow = f32(f32(matt * 0.078125) * S);
  const sinner = f32(f32(matt * 0.1796875) * S);
  const souter = f32(f32(matt * 0.3359375) * S);
  const shalo = f32(f32(matt * f32(0.084375)) * S);
  const shaloWidth = f32(shalo * F0_07);

  const tintify = (br: number, bg: number, bb: number): [number, number, number] => channelsF(fromRgbF(br * tr, bg * tg, bb * tb, ta));
  const cColor = tintify(byteF(239), byteF(239), byteF(239));
  const cGlow = tintify(byteF(245), byteF(245), byteF(245));
  const cInner = tintify(1, byteF(38), byteF(43));
  const cOuter = tintify(byteF(69), byteF(59), byteF(64));
  const cHalo = tintify(byteF(80), byteF(15), byteF(4));

  // init_reflectors (LensFlare.cpp:130-181).
  const tintHsv = toHsv(tint);
  const whiteTint = tintHsv.s / USHRT_MAX < f32(0.01);
  const hShift = f32(tintHsv.h === USHRT_MAX ? -1 : tintHsv.h / 36000);
  const sScale = f32(tintHsv.s / USHRT_MAX);
  const vScale = f32(tintHsv.v / USHRT_MAX);
  const aScale = f32(tintHsv.a / USHRT_MAX);
  const n = REFLECTORS.length;
  const refl: Reflectors = {
    type: new Int8Array(n),
    x: new Float64Array(n),
    y: new Float64Array(n),
    size: new Float64Array(n),
    den: new Float64Array(n),
    bound: new Float64Array(n),
    r: new Float64Array(n),
    g: new Float64Array(n),
    b: new Float64Array(n),
  };
  REFLECTORS.forEach(([type, fxy, fsize, r, g, b], j) => {
    const fx = f32(fxy);
    const size = f32(f32(f32(fsize) * matt) * S);
    const base = fromRgbF(byteF(r), byteF(g), byteF(b), 1);
    const [cr, cg, cb] = channelsF(whiteTint ? base : hsvToRgb(shiftedHsv(base, hShift, sScale, vScale, aScale)));
    refl.type[j] = type;
    refl.x[j] = fmaf(fx, DX, halfW);
    refl.y[j] = fmaf(fx, DY, halfH);
    refl.size[j] = size;
    refl.den[j] = type === 1 ? size : f32(size * (type === 2 ? F0_15 : type === 3 ? F0_12 : F0_04));
    refl.bound[j] = size > 0 ? (type === 4 ? size * 1.05 : size) : Infinity;
    refl.r[j] = cr;
    refl.g[j] = cg;
    refl.b[j] = cb;
  });

  // The straight overlay, premultiplied as QPainter's ARGB32 fetch does (qPremultiply).
  const overlay = new Uint8ClampedArray(w * h * 4);
  const overlayAlpha = new Uint8Array(w * h);
  const rowDy = new Float64Array(n);
  const active = new Int32Array(n);
  for (let yy = 0; yy < h; yy += 1) {
    const ddy = f32(yy - py);
    const ddy2 = ddy * ddy;
    let activeCount = 0;
    for (let j = 0; j < n; j += 1) {
      rowDy[j] = f32(refl.y[j]! - yy);
      if (!(Math.abs(rowDy[j]!) >= refl.bound[j]!)) active[activeCount++] = j;
    }
    for (let xx = 0; xx < w; xx += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      const ddx = f32(xx - px);
      const d = f32(Math.sqrt(ddx * ddx + ddy2));
      let p: number;
      if (d < scolor) {
        p = f32(f32(scolor - d) / scolor);
        p = f32(p * p);
        r = addChannel(r, p, cColor[0]);
        g = addChannel(g, p, cColor[1]);
        b = addChannel(b, p, cColor[2]);
      }
      if (d < sglow) {
        p = f32(f32(sglow - d) / sglow);
        p = f32(p * p);
        r = addChannel(r, p, cGlow[0]);
        g = addChannel(g, p, cGlow[1]);
        b = addChannel(b, p, cGlow[2]);
      }
      if (d < sinner) {
        p = f32(f32(sinner - d) / sinner);
        p = f32(p * p);
        r = addChannel(r, p, cInner[0]);
        g = addChannel(g, p, cInner[1]);
        b = addChannel(b, p, cInner[2]);
      }
      if (d < souter) {
        p = f32(f32(souter - d) / souter);
        r = addChannel(r, p, cOuter[0]);
        g = addChannel(g, p, cOuter[1]);
        b = addChannel(b, p, cOuter[2]);
      }
      p = Math.abs(f32(f32(d - shalo) / shaloWidth));
      if (p < 1) {
        p = f32(1 - p);
        r = addChannel(r, p, cHalo[0]);
        g = addChannel(g, p, cHalo[1]);
        b = addChannel(b, p, cHalo[2]);
      }
      // apply_reflector (LensFlare.cpp:184-219), in table order.
      for (let k = 0; k < activeCount; k += 1) {
        const j = active[k]!;
        const rx = f32(refl.x[j]! - xx);
        if (Math.abs(rx) >= refl.bound[j]!) continue;
        const ry = rowDy[j]!;
        const rd = f32(Math.sqrt(rx * rx + ry * ry));
        const type = refl.type[j]!;
        if (type === 4) {
          p = Math.abs(f32(f32(rd - refl.size[j]!) / refl.den[j]!));
          if (!(p < 1)) continue;
          p = f32(1 - p);
        } else {
          p = f32(f32(refl.size[j]! - rd) / refl.den[j]!);
          if (!(p > 0)) continue;
          if (type === 1) p = f32(p * p);
          else if (type === 2) p = p > 1 ? 1 : p;
          else p = fmaf(p > 1 ? 1 : p, -F0_12, 1);
        }
        r = addChannel(r, p, refl.r[j]!);
        g = addChannel(g, p, refl.g[j]!);
        b = addChannel(b, p, refl.b[j]!);
      }
      const a = Math.max(r, g, b);
      const i = (yy * w + xx) * 4;
      overlay[i] = byteMul(r, a);
      overlay[i + 1] = byteMul(g, a);
      overlay[i + 2] = byteMul(b, a);
      overlay[i + 3] = a;
      overlayAlpha[yy * w + xx] = a;
    }
  }

  const d = image.data;
  const origAlpha = new Uint8Array(w * h);
  for (let i = 0; i < origAlpha.length; i += 1) origAlpha[i] = d[i * 4 + 3]!;

  // QPainter Plus at setOpacity(I): intOpacity = int(clamp(I) * 256), span alpha (255 * op) >> 8.
  const intOpacity = Math.trunc((I < 0 ? 0 : I > 1 ? 1 : I) * 256);
  composerFor(CompositionMode.Plus)(d, 0, overlay, 0, w * h, (255 * intOpacity) >> 8);

  // Rebuild alpha = max(orig, flare * I), then setAlphaChannel: DestinationIn on every byte.
  for (let i = 0; i < origAlpha.length; i += 1) {
    const oa = f32(origAlpha[i]! / 255);
    const fa = f32(f32(overlayAlpha[i]! / 255) * I);
    const m = f32((oa < fa ? fa : oa) * 255);
    const alpha = Math.trunc(m < 0 ? 0 : m > 255 ? 255 : m);
    const o = i * 4;
    d[o] = byteMul(d[o]!, alpha);
    d[o + 1] = byteMul(d[o + 1]!, alpha);
    d[o + 2] = byteMul(d[o + 2]!, alpha);
    d[o + 3] = byteMul(d[o + 3]!, alpha);
  }
}

export const lensFlare: KernelSpec = { type: "LensFlare", supported: true, run: lensFlareKernel };
