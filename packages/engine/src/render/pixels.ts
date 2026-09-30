/**
 * Pixel primitives shared by the effect kernels and the CPU compositor.
 *
 * libopenshot keeps every frame image as `QImage::Format_RGBA8888_Premultiplied`
 * (libopenshot src/Frame.cpp:746-748) and its effects read and write those
 * premultiplied bytes. The public contract (`RgbaImage`) is straight RGBA, so
 * the kernels are written against `PremulImage` and wrapped for straight
 * callers (`kernels/index.ts`). Integer helpers reproduce Qt 5.15's exact
 * rounding (qtbase src/gui/painting/qrgb.h, qdrawhelper_p.h).
 */

import type { RgbaImage } from "./types.js";

/**
 * Premultiplied RGBA8, row-major, 4 bytes per pixel (R, G, B, A with
 * R, G, B <= A). The brand keeps it from being mixed up with `RgbaImage`.
 */
export interface PremulImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  readonly premultiplied: true;
}

export function createPremul(width: number, height: number): PremulImage {
  const w = Math.max(0, Math.trunc(width));
  const h = Math.max(0, Math.trunc(height));
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4), premultiplied: true };
}

/** Wrap premultiplied bytes without copying. */
export function wrapPremul(width: number, height: number, data: Uint8ClampedArray): PremulImage {
  if (data.length !== width * height * 4) {
    throw new RangeError(`premultiplied image ${width}x${height} needs ${width * height * 4} bytes, got ${data.length}`);
  }
  return { width, height, data, premultiplied: true };
}

export function clonePremul(image: PremulImage): PremulImage {
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data), premultiplied: true };
}

/** Fill with one premultiplied color. */
export function fillPremul(image: PremulImage, r: number, g: number, b: number, a: number): void {
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = a;
  }
}

/** Copy of the rectangle (x, y, w, h), which must lie inside `image` (QImage::copy(QRect)). */
export function copyRect(image: PremulImage, x: number, y: number, w: number, h: number): PremulImage {
  const out = createPremul(w, h);
  const rowBytes = w * 4;
  for (let row = 0; row < h; row += 1) {
    const src = ((y + row) * image.width + x) * 4;
    out.data.set(image.data.subarray(src, src + rowBytes), row * rowBytes);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Qt integer helpers
// ---------------------------------------------------------------------------

/**
 * Qt `BYTE_MUL` / `qt_div_255` on one channel: `x * a / 255` rounded to
 * nearest (exact for all 8-bit x and a). qdrawhelper_p.h:631-660, :887.
 */
export function byteMul(x: number, a: number): number {
  const t = x * a;
  return (t + (t >> 8) + 0x80) >> 8;
}

/** Qt `qGray(r, g, b)` = (r*11 + g*16 + b*5) / 32 (qrgb.h:72). Inputs are non-negative. */
export function qGray(r: number, g: number, b: number): number {
  return (r * 11 + g * 16 + b * 5) >> 5;
}

/** Qt `qRound(double)`: nearest integer, halves toward +infinity. */
export function qRound(x: number): number {
  return Math.floor(x + 0.5);
}

/** Qt `qFloor` / `qCeil` return int. */
export function qFloor(x: number): number {
  return Math.floor(x);
}

export function qCeil(x: number): number {
  return Math.ceil(x);
}

/** Clamp an integer to 0..255 (the ubiquitous `clamp_u8` lambdas). */
export function clampU8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** `qt_inv_premul_factor[a]` = floor(0x00ff00ff / a) (qcolor.cpp:3125). */
const INV_PREMUL_FACTOR: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let a = 1; a < 256; a += 1) t[a] = Math.floor(0x00ff00ff / a);
  return t;
})();

/**
 * Qt `qUnpremultiply` on one color channel (qrgb.h:96-108, the generic C
 * path). Arm64 NEON conversions use an approximate reciprocal that differs by
 * 1 in ~0.1% of semi-transparent pairs; opaque and fully transparent pixels
 * are exact everywhere.
 */
export function unpremulChannel(c: number, a: number): number {
  if (a === 255) return c;
  if (a === 0) return 0;
  return Math.floor((c * INV_PREMUL_FACTOR[a]! + 0x8000) / 65536);
}

/** Straight RGBA → premultiplied, like Qt `qPremultiply` / ARGB32 → RGBA8888_Premultiplied. */
export function premultiply(src: RgbaImage, out?: PremulImage): PremulImage {
  const target = out ?? createPremul(src.width, src.height);
  if (target.width !== src.width || target.height !== src.height) {
    throw new RangeError("premultiply: size mismatch");
  }
  const s = src.data;
  const d = target.data;
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3]!;
    if (a === 255) {
      d[i] = s[i]!;
      d[i + 1] = s[i + 1]!;
      d[i + 2] = s[i + 2]!;
      d[i + 3] = 255;
    } else if (a === 0) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = 0;
    } else {
      d[i] = byteMul(s[i]!, a);
      d[i + 1] = byteMul(s[i + 1]!, a);
      d[i + 2] = byteMul(s[i + 2]!, a);
      d[i + 3] = a;
    }
  }
  return target;
}

/** Premultiplied → straight RGBA, like Qt `qUnpremultiply`. */
export function unpremultiply(src: PremulImage, out?: RgbaImage): RgbaImage {
  const target: RgbaImage = out ?? { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data.length) };
  if (target.width !== src.width || target.height !== src.height) {
    throw new RangeError("unpremultiply: size mismatch");
  }
  const s = src.data;
  const d = target.data;
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3]!;
    if (a === 255) {
      d[i] = s[i]!;
      d[i + 1] = s[i + 1]!;
      d[i + 2] = s[i + 2]!;
      d[i + 3] = 255;
    } else if (a === 0) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = 0;
    } else {
      const inv = INV_PREMUL_FACTOR[a]!;
      d[i] = Math.floor((s[i]! * inv + 0x8000) / 65536);
      d[i + 1] = Math.floor((s[i + 1]! * inv + 0x8000) / 65536);
      d[i + 2] = Math.floor((s[i + 2]! * inv + 0x8000) / 65536);
      d[i + 3] = a;
    }
  }
  return target;
}

/** True when every pixel is fully opaque (straight and premultiplied bytes are then identical). */
export function isOpaque(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return false;
  return true;
}
