/**
 * `QImage::convertToFormat` paths libopenshot effects hit, as Qt 5.15 runs
 * them on arm64 (qtbase src/gui/image/qimage_conversions.cpp,
 * src/gui/painting/qdrawhelper_neon.cpp).
 */

import type { PremulImage } from "../pixels.js";

const f32 = Math.fround;

// RGBA8888_Premultiplied -> ARGB32 (qdrawhelper_neon.cpp:1229-1311)

const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);

/** AArch64 FRECPE on a positive normal float: the architectural 8-bit reciprocal estimate. */
function frecpe(a: number): number {
  F32[0] = a;
  const bits = U32[0]!;
  const exp = (bits >>> 23) & 0xff;
  const scaled = 256 + ((bits & 0x7fffff) >>> 15);
  const r = (Math.floor(524288 / (scaled * 2 + 1)) + 1) >> 1;
  U32[0] = ((253 - exp) << 23) | ((r & 0xff) << 15);
  return F32[0]!;
}

/**
 * `reciprocal_mul_ps(a, 255)`: one Newton step, `FRECPS(a, e) * (e * 255)`.
 * `2 - a*e` is exact in float for these operands, so the fused step needs no
 * emulation.
 */
const NEON_INV_ALPHA: Float64Array = (() => {
  const t = new Float64Array(256);
  for (let a = 1; a < 256; a += 1) {
    const e = frecpe(a);
    t[a] = f32((2 - a * e) * f32(e * 255));
  }
  return t;
})();

/** `qt_inv_premul_factor[a]`, the exact C path's reciprocal (qrgb.h:96-108). */
function invPremulFactor(a: number): number {
  return Math.floor(0x00ff00ff / a);
}

/**
 * Straight RGBA bytes of a premultiplied image, exactly as
 * `QImage::convertToFormat(Format_ARGB32)` produces them on arm64: rows in
 * groups of four (`convertARGBFromARGB32PM_neon`). A group whose alphas sum to
 * 0 or 4·255 is zero or copied. Otherwise `c' = (trunc(2·f32(c·ia)) + 1) >> 1`,
 * with alpha 0 pixels zeroed. The last `W % 4` pixels use `qUnpremultiply`.
 */
export function unpremultiplyNeon(image: PremulImage): Uint8ClampedArray {
  const w = image.width;
  const s = image.data;
  const out = new Uint8ClampedArray(s.length);
  for (let y = 0; y < image.height; y += 1) {
    const row = y * w * 4;
    let x = 0;
    for (; x < w - 3; x += 4) {
      const o = row + x * 4;
      const sum = s[o + 3]! + s[o + 7]! + s[o + 11]! + s[o + 15]!;
      if (sum === 0) continue;
      if (sum === 1020) {
        out.set(s.subarray(o, o + 16), o);
        continue;
      }
      for (let k = 0; k < 16; k += 4) {
        const a = s[o + k + 3]!;
        if (a === 0) continue;
        const ia = NEON_INV_ALPHA[a]!;
        for (let c = 0; c < 3; c += 1) out[o + k + c] = ((Math.trunc(2 * f32(s[o + k + c]! * ia)) + 1) >> 1) & 0xff;
        out[o + k + 3] = a;
      }
    }
    for (; x < w; x += 1) {
      const o = row + x * 4;
      const a = s[o + 3]!;
      if (a === 0) continue;
      if (a === 255) {
        out.set(s.subarray(o, o + 4), o);
        continue;
      }
      const inv = invPremulFactor(a);
      for (let c = 0; c < 3; c += 1) out[o + c] = Math.floor((s[o + c]! * inv + 0x8000) / 65536) & 0xff;
      out[o + 3] = a;
    }
  }
  return out;
}
