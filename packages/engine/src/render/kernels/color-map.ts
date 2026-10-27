/**
 * ColorMap (`.cube` 1D/3D LUT), ported from libopenshot 1.0
 * src/effects/ColorMap.cpp:177-318. ColorGrade runs the same stage for its
 * `lut_path` (ColorGrade.cpp:387-390), so `applyCubeLut` is shared.
 *
 * Math is float32 on un-premultiplied values (`p / (A/255f)`), not clamped
 * to the LUT domain for the blend, and re-premultiplied by truncation
 * (`EffectBase::constrain`). Every `a*(1-t) + b*t` lerp is compiled on arm64
 * as `fmadd(a, 1-t, b*t)` (checked in the disassembly of the per-pixel
 * loop), which `fmaf` reproduces.
 */

import type { PremulImage } from "../pixels.js";
import type { KernelContext } from "../types.js";
import { cachedCubeLut, type CubeLut } from "./cube-lut.js";
import { num, str } from "./params.js";
import type { KernelSpec, Params } from "./types.js";

const f32 = Math.fround;
const INV_255 = f32(1 / 255);

/**
 * Results kept per call: an opaque pixel's output is a pure function of its 8-bit RGB, and pictures repeat colours, so
 * a repeat skips the lookup (as ColorGrade does). Direct-mapped by a multiplicative hash of the RGB; the bytes are the
 * same either way.
 */
const MEMO_BITS = 16;

/** Fused float multiply-add: the float product is exact in double. */
function fmaf(a: number, b: number, c: number): number {
  return f32(a * b + c);
}

/** `int(floor(v))` as arm64 `fcvtms`: NaN gives 0. */
function floorIndex(v: number): number {
  return v === v ? Math.floor(v) : 0;
}

/** `EffectBase::constrain(int(v))` (EffectBase.cpp:83-92): `fcvtzs` truncation (NaN → 0), then 0..255. */
function constrainByte(v: number): number {
  if (!(v > 0)) return 0;
  if (v >= 255) return 255;
  return Math.trunc(v);
}

/** `normalize_to_domain` (ColorMap.cpp:238-246); `std::clamp` passes NaN through. */
function normalizeToDomain(value: number, min: number, range: number): number {
  const v = range <= 0 ? value : f32(f32(value - min) / range);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** `sample1d` (ColorMap.cpp:204-218). */
function sample1d(t: Float32Array, size: number, value: number, channel: number): number {
  const count = t.length;
  if (size <= 1) return t[Math.min(channel, count - 1)]!;
  const scaled = f32(value * (size - 1));
  const i0 = floorIndex(scaled);
  const i1 = Math.min(i0 + 1, size - 1);
  const frac = f32(scaled - i0);
  const v0 = t[Math.max(0, Math.min(i0 * 3 + channel, count - 1))]!;
  const v1 = t[Math.max(0, Math.min(i1 * 3 + channel, count - 1))]!;
  return fmaf(v0, f32(1 - frac), f32(v1 * frac));
}

/**
 * Apply a parsed LUT in place (`ColorMap::GetFrame` after loading), with the
 * overall and per-channel intensities (`GetValue` doubles, narrowed here).
 */
export function applyCubeLut(image: PremulImage, lut: CubeLut, intensity: number, intensityR: number, intensityG: number, intensityB: number): void {
  const overall = f32(intensity);
  const tR = f32(f32(intensityR) * overall);
  const tG = f32(f32(intensityG) * overall);
  const tB = f32(f32(intensityB) * overall);
  const keepR = f32(1 - tR);
  const keepG = f32(1 - tG);
  const keepB = f32(1 - tB);
  const [minR, minG, minB] = lut.domainMin;
  const rangeR = f32(lut.domainMax[0] - minR);
  const rangeG = f32(lut.domainMax[1] - minG);
  const rangeB = f32(lut.domainMax[2] - minB);
  const t = lut.data;
  const n = lut.size;
  const last = n - 1;
  const is3d = lut.kind === "3d";
  const d = image.data;
  const memoRgb = new Int32Array(1 << MEMO_BITS).fill(-1);
  const memoOut = new Int32Array(1 << MEMO_BITS);
  for (let i = 0; i < d.length; i += 4) {
    const A = d[i + 3]!;
    if (A === 0) continue;
    let rgb = -1;
    let slot = 0;
    if (A === 255) {
      rgb = (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!;
      slot = Math.imul(rgb, 0x9e3779b1) >>> (32 - MEMO_BITS);
      if (memoRgb[slot] === rgb) {
        const out = memoOut[slot]!;
        d[i] = out >>> 16;
        d[i + 1] = (out >>> 8) & 255;
        d[i + 2] = out & 255;
        continue;
      }
    }
    const alpha = f32(A / 255);
    const rn = f32(f32(d[i]! / alpha) * INV_255);
    const gn = f32(f32(d[i + 1]! / alpha) * INV_255);
    const bn = f32(f32(d[i + 2]! / alpha) * INV_255);
    const rd = normalizeToDomain(rn, minR, rangeR);
    const gd = normalizeToDomain(gn, minG, rangeG);
    const bd = normalizeToDomain(bn, minB, rangeB);
    let lr: number;
    let lg: number;
    let lb: number;
    if (is3d) {
      const rf = f32(rd * last);
      const gf = f32(gd * last);
      const bf = f32(bd * last);
      const r0 = floorIndex(rf);
      const g0 = floorIndex(gf);
      const b0 = floorIndex(bf);
      const r1 = Math.min(r0 + 1, last);
      const g1 = Math.min(g0 + 1, last);
      const b1 = Math.min(b0 + 1, last);
      const dr = f32(rf - r0);
      const dg = f32(gf - g0);
      const db = f32(bf - b0);
      const odr = f32(1 - dr);
      const odg = f32(1 - dg);
      const odb = f32(1 - db);
      const b0g0 = (b0 * n + g0) * n;
      const b0g1 = (b0 * n + g1) * n;
      const b1g0 = (b1 * n + g0) * n;
      const b1g1 = (b1 * n + g1) * n;
      const i000 = (b0g0 + r0) * 3;
      const i100 = (b0g0 + r1) * 3;
      const i010 = (b0g1 + r0) * 3;
      const i110 = (b0g1 + r1) * 3;
      const i001 = (b1g0 + r0) * 3;
      const i101 = (b1g0 + r1) * 3;
      const i011 = (b1g1 + r0) * 3;
      const i111 = (b1g1 + r1) * 3;
      // One channel of the trilinear lookup per pass (ColorMap.cpp:277-299): lerp along r, then g, then b. Written out
      // (not a helper) so V8 keeps it inline; `f32(a * b + c)` is `fmaf`, the float product being exact in double.
      let c00 = f32(t[i000]! * odr + f32(t[i100]! * dr));
      let c01 = f32(t[i001]! * odr + f32(t[i101]! * dr));
      let c10 = f32(t[i010]! * odr + f32(t[i110]! * dr));
      let c11 = f32(t[i011]! * odr + f32(t[i111]! * dr));
      lr = f32(f32(c00 * odg + f32(c10 * dg)) * odb + f32(f32(c01 * odg + f32(c11 * dg)) * db));
      c00 = f32(t[i000 + 1]! * odr + f32(t[i100 + 1]! * dr));
      c01 = f32(t[i001 + 1]! * odr + f32(t[i101 + 1]! * dr));
      c10 = f32(t[i010 + 1]! * odr + f32(t[i110 + 1]! * dr));
      c11 = f32(t[i011 + 1]! * odr + f32(t[i111 + 1]! * dr));
      lg = f32(f32(c00 * odg + f32(c10 * dg)) * odb + f32(f32(c01 * odg + f32(c11 * dg)) * db));
      c00 = f32(t[i000 + 2]! * odr + f32(t[i100 + 2]! * dr));
      c01 = f32(t[i001 + 2]! * odr + f32(t[i101 + 2]! * dr));
      c10 = f32(t[i010 + 2]! * odr + f32(t[i110 + 2]! * dr));
      c11 = f32(t[i011 + 2]! * odr + f32(t[i111 + 2]! * dr));
      lb = f32(f32(c00 * odg + f32(c10 * dg)) * odb + f32(f32(c01 * odg + f32(c11 * dg)) * db));
    } else {
      lr = sample1d(t, n, rd, 0);
      lg = sample1d(t, n, gd, 1);
      lb = sample1d(t, n, bd, 2);
    }
    // (lut*t + in*(1-t)) * alpha, truncated; alpha is left unchanged (ColorMap.cpp:307-314).
    const r8 = constrainByte(f32(f32(alpha * fmaf(lr, tR, f32(rn * keepR))) * 255));
    const g8 = constrainByte(f32(f32(alpha * fmaf(lg, tG, f32(gn * keepG))) * 255));
    const b8 = constrainByte(f32(f32(alpha * fmaf(lb, tB, f32(bn * keepB))) * 255));
    d[i] = r8;
    d[i + 1] = g8;
    d[i + 2] = b8;
    if (A === 255) {
      memoRgb[slot] = rgb;
      memoOut[slot] = (r8 << 16) | (g8 << 8) | b8;
    }
  }
}

/**
 * The LUT a `lut_path` names, from the renderer-preloaded `ctx.texts`. Null
 * (no LUT: the stage does nothing) when the path is empty, the text was not
 * provided (libopenshot: the file does not open), or it does not parse.
 */
export function lutForPath(ctx: KernelContext, path: string): CubeLut | null {
  if (path === "") return null;
  const text = ctx.texts?.get(path);
  return text === undefined ? null : cachedCubeLut(text);
}

export const colorMap: KernelSpec = {
  type: "ColorMap",
  supported: true,
  run(image: PremulImage, params: Params, ctx: KernelContext): void {
    const lut = lutForPath(ctx, str(params, "lut_path", ""));
    if (!lut) return;
    applyCubeLut(
      image,
      lut,
      num(params, "intensity", 1),
      num(params, "intensity_r", 1),
      num(params, "intensity_g", 1),
      num(params, "intensity_b", 1),
    );
  },
};
