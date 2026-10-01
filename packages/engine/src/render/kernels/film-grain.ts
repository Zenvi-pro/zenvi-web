/**
 * FilmGrain, ported from libopenshot 1.0 src/effects/FilmGrain.cpp:118-376
 * (hashing at :26-81).
 *
 * Integer hash value noise (FNV-1a of the effect id, a murmur-style mix),
 * float32 math with the arm64 build's fused multiply-adds (checked in the
 * disassembly of the outlined OpenMP loop): every `a + (b - a)*t` lerp is
 * `fma(b - a, t, a)`, the tonal weight is `fma(hi, L², fma(sh, (1-L)², mid*m))`.
 * The C++ caches per-row columns of noise; the cached values are pure
 * functions of the cell, so caching here only saves work.
 */

import type { PremulImage } from "../pixels.js";
import type { KernelContext } from "../types.js";
import { int, num } from "./params.js";
import type { KernelSpec, Params } from "./types.js";

const f32 = Math.fround;
const INV_255 = f32(1 / 255);
const EPSILON = f32(0.00001);
const LUMA_R = f32(0.299);
const LUMA_G = f32(0.587);
const LUMA_B = f32(0.114);
/** `kInvU32Max = 2.0f / 4294967295.0f` is exactly 2^-31 in float. */
const INV_U32_MAX = f32(2 / f32(4294967295));
/** Compile-time `b - a` of `lerp(a, b, t)`, folded in float. */
const SOFT_LERP_SPAN = f32(f32(0.12) - f32(0.45));
const CLUMP_LERP_SPAN = f32(f32(0.08) - f32(0.35));
const SOFT_LERP_BASE = f32(0.45);
const CLUMP_LERP_BASE = f32(0.35);
const CLUSTER_BASE = f32(0.45);
const CLUSTER_SCALE = f32(1.35);
const INTENSITY_SCALE = f32(0.18);

/** Salts for luma, red, green, blue (FilmGrain.cpp:30-35). */
const SALTS = [0x1000193, 0x8da6b343, 0xd8163841, 0xcb1ab31f] as const;
const SOFT_XOR = 0x51633e2d;
const CLUMP_XOR = 0xa511e9b3;

function fmaf(a: number, b: number, c: number): number {
  return f32(a * b + c);
}

function clamp01(v: number): number {
  return v < 1 ? (v > 0 ? v : 0) : 1;
}

function clampByte(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.trunc(f32(v + 0.5));
}

/** `t*t*(3 - 2t)` (the fused `3 - 2t`). */
function smooth(t: number): number {
  return f32(f32(t * t) * fmaf(t, -2, 3));
}

const INV_ALPHA: Float32Array = (() => {
  const t = new Float32Array(256);
  for (let i = 1; i < 256; i += 1) t[i] = f32(255 / i);
  return t;
})();

/** `mix32` (FilmGrain.cpp:53-60). */
function mix32(value: number): number {
  let v = value >>> 0;
  v ^= v >>> 16;
  v = Math.imul(v, 0x7feb352d);
  v ^= v >>> 15;
  v = Math.imul(v, 0x846ca68b);
  v ^= v >>> 16;
  return v >>> 0;
}

/** UTF-8 bytes of a string (jsoncpp stores the id as UTF-8); lone surrogates become U+FFFD. */
function utf8(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    let cp = ch.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return out;
}

/** `hash_string`: FNV-1a 32 over the UTF-8 bytes (FilmGrain.cpp:62-69). */
export function fnv1a(text: string): number {
  let h = 2166136261;
  for (const byte of utf8(text)) h = Math.imul(h ^ byte, 16777619) >>> 0;
  return h;
}

/** `hash_signed(seed, x, y, t, salt)` in [-1, 1] (FilmGrain.cpp:71-81). */
function hashSigned(seed: number, x: number, y: number, t: number, salt: number): number {
  let h = seed ^ salt;
  h ^= Math.imul(x, 0x9e3779b9);
  h ^= Math.imul(y, 0x85ebca6b);
  h ^= Math.imul(t, 0xc2b2ae35);
  return fmaf(f32(mix32(h)), INV_U32_MAX, -1);
}

export const filmGrain: KernelSpec = {
  type: "FilmGrain",
  supported: true,
  run(image: PremulImage, params: Params, ctx: KernelContext): void {
    const amount = clamp01(f32(num(params, "amount", 0.25)));
    if (amount <= EPSILON) return;
    const size = clamp01(f32(num(params, "size", 0.2)));
    const softness = clamp01(f32(num(params, "softness", 0.25)));
    const clump = clamp01(f32(num(params, "clump", 0.2)));
    const shadowStrength = clamp01(f32(num(params, "shadows", 0.8)));
    const midtoneStrength = clamp01(f32(num(params, "midtones", 1)));
    const highlightStrength = clamp01(f32(num(params, "highlights", 0.55)));
    const colorAmount = clamp01(f32(num(params, "color_amount", 0.2)));
    const colorVariation = clamp01(f32(num(params, "color_variation", 0.35)));
    const evolution = clamp01(f32(num(params, "evolution", 0.65)));
    const coherence = clamp01(f32(num(params, "coherence", 0.55)));
    const seed = int(params, "seed", 1);

    // Derived values (FilmGrain.cpp:138-160).
    const fineFrequency = f32(1 / fmaf(size, 8, 1));
    const softFrequency = f32(fineFrequency * fmaf(softness, SOFT_LERP_SPAN, SOFT_LERP_BASE));
    const clumpFrequency = f32(fineFrequency * fmaf(clump, CLUMP_LERP_SPAN, CLUMP_LERP_BASE));
    const temporalRate = f32(evolution * fmaf(f32(1 - coherence), 7, 1));
    const temporalPosition = f32(f32(ctx.frame) * temporalRate);
    const time0 = Math.floor(temporalPosition);
    const time1 = time0 + 1;
    const temporalMix = temporalRate <= EPSILON ? 0 : clamp01(f32(temporalPosition - time0));
    const smoothMix = smooth(temporalMix);
    const baseSeed = ((seed >>> 0) ^ mix32(fnv1a(ctx.effectId ?? ""))) >>> 0;
    const intensityScale = f32(amount * INTENSITY_SCALE);
    const useTemporal = temporalRate > EPSILON && smoothMix > EPSILON;
    const useSoft = softness > EPSILON;
    const useClump = clump > EPSILON;
    const useVariation = colorAmount > EPSILON && colorVariation > EPSILON;
    const numTimes = useTemporal ? 2 : 1;
    const numSalts = useVariation ? 4 : 1;
    const buckets = [time0, time1];

    // Noise coordinates follow the timeline size, not the image (FilmGrain.cpp:175-189).
    const width = image.width;
    const height = image.height;
    let refW = width;
    let refH = height;
    const tw = Math.trunc(ctx.timelineWidth ?? ctx.canvasWidth);
    const th = Math.trunc(ctx.timelineHeight ?? ctx.canvasHeight);
    if (tw > 0 && th > 0) {
      refW = tw;
      refH = th;
    }
    const scaleX = width > 0 ? f32(refW / width) : 1;
    const scaleY = height > 0 ? f32(refH / height) : 1;

    const fineCache = new Float32Array(8);
    const softCol0 = new Float32Array(8);
    const softCol1 = new Float32Array(8);
    const clumpCol0 = new Float32Array(4);
    const clumpCol1 = new Float32Array(4);
    const grains = new Float32Array(4);
    const d = image.data;

    for (let y = 0; y < height; y += 1) {
      const refY = f32(y * scaleY);
      const fineIy = Math.trunc(f32(refY * fineFrequency));
      let softIy0 = 0;
      let softSy = 0;
      if (useSoft) {
        const sry = f32(refY * softFrequency);
        softIy0 = Math.trunc(sry);
        softSy = smooth(f32(sry - softIy0));
      }
      let clumpIy0 = 0;
      let clumpSy = 0;
      if (useClump) {
        const cry = f32(refY * clumpFrequency);
        clumpIy0 = Math.trunc(cry);
        clumpSy = smooth(f32(cry - clumpIy0));
      }
      let cachedFineIx = -1;
      let cachedSoftIx0 = -1;
      let cachedClumpIx0 = -1;

      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const A = d[i + 3]!;
        if (A === 0) continue;
        let R: number;
        let G: number;
        let B: number;
        if (A === 255) {
          R = f32(d[i]! * INV_255);
          G = f32(d[i + 1]! * INV_255);
          B = f32(d[i + 2]! * INV_255);
        } else {
          const inv = INV_ALPHA[A]!;
          R = f32(f32(d[i]! * inv) * INV_255);
          G = f32(f32(d[i + 1]! * inv) * INV_255);
          B = f32(f32(d[i + 2]! * inv) * INV_255);
        }

        // tonal_weight (FilmGrain.cpp:83-89).
        const L = fmaf(LUMA_B, B, fmaf(R, LUMA_R, f32(LUMA_G * G)));
        const dark = f32(1 - L);
        const centered = f32(Math.abs(f32(L - 0.5)) * 2);
        const midtone = clamp01(f32(1 - centered * centered));
        const tone = fmaf(f32(L * L), highlightStrength, fmaf(f32(dark * dark), shadowStrength, f32(midtoneStrength * midtone)));
        if (tone <= EPSILON) continue;

        const refX = f32(x * scaleX);
        const fineIx = Math.trunc(f32(refX * fineFrequency));
        if (fineIx !== cachedFineIx) {
          cachedFineIx = fineIx;
          for (let t = 0; t < numTimes; t += 1) {
            for (let s = 0; s < numSalts; s += 1) fineCache[t * 4 + s] = hashSigned(baseSeed, fineIx, fineIy, buckets[t]!, SALTS[s]!);
          }
        }

        let softSx = 0;
        if (useSoft) {
          const srx = f32(refX * softFrequency);
          const softIx0 = Math.trunc(srx);
          if (softIx0 !== cachedSoftIx0) {
            cachedSoftIx0 = softIx0;
            for (let t = 0; t < numTimes; t += 1) {
              for (let s = 0; s < numSalts; s += 1) {
                const salt = (SALTS[s]! ^ SOFT_XOR) >>> 0;
                const n00 = hashSigned(baseSeed, softIx0, softIy0, buckets[t]!, salt);
                const n10 = hashSigned(baseSeed, softIx0 + 1, softIy0, buckets[t]!, salt);
                const n01 = hashSigned(baseSeed, softIx0, softIy0 + 1, buckets[t]!, salt);
                const n11 = hashSigned(baseSeed, softIx0 + 1, softIy0 + 1, buckets[t]!, salt);
                softCol0[t * 4 + s] = fmaf(f32(n01 - n00), softSy, n00);
                softCol1[t * 4 + s] = fmaf(f32(n11 - n10), softSy, n10);
              }
            }
          }
          softSx = smooth(f32(srx - cachedSoftIx0));
        }

        let clumpSx = 0;
        if (useClump) {
          const crx = f32(refX * clumpFrequency);
          const clumpIx0 = Math.trunc(crx);
          if (clumpIx0 !== cachedClumpIx0) {
            cachedClumpIx0 = clumpIx0;
            for (let s = 0; s < numSalts; s += 1) {
              const salt = (SALTS[s]! ^ CLUMP_XOR) >>> 0;
              const n00 = hashSigned(baseSeed, clumpIx0, clumpIy0, time0, salt);
              const n10 = hashSigned(baseSeed, clumpIx0 + 1, clumpIy0, time0, salt);
              const n01 = hashSigned(baseSeed, clumpIx0, clumpIy0 + 1, time0, salt);
              const n11 = hashSigned(baseSeed, clumpIx0 + 1, clumpIy0 + 1, time0, salt);
              clumpCol0[s] = fmaf(f32(n01 - n00), clumpSy, n00);
              clumpCol1[s] = fmaf(f32(n11 - n10), clumpSy, n10);
            }
          }
          clumpSx = smooth(f32(crx - cachedClumpIx0));
        }

        // Per-salt grain (FilmGrain.cpp:321-344).
        for (let s = 0; s < numSalts; s += 1) {
          let g0 = fineCache[s]!;
          if (useSoft) {
            const soft0 = fmaf(f32(softCol1[s]! - softCol0[s]!), softSx, softCol0[s]!);
            g0 = fmaf(f32(soft0 - g0), softness, g0);
          }
          let grain = g0;
          if (useTemporal) {
            let g1 = fineCache[4 + s]!;
            if (useSoft) {
              const soft1 = fmaf(f32(softCol1[4 + s]! - softCol0[4 + s]!), softSx, softCol0[4 + s]!);
              g1 = fmaf(f32(soft1 - g1), softness, g1);
            }
            grain = fmaf(f32(g1 - g0), smoothMix, g0);
          }
          if (useClump) {
            const cluster = fmaf(f32(clumpCol1[s]! - clumpCol0[s]!), clumpSx, clumpCol0[s]!);
            const target = fmaf(Math.abs(cluster), CLUSTER_SCALE, CLUSTER_BASE);
            grain = f32(grain * fmaf(f32(target - 1), clump, 1));
          }
          grains[s] = grain;
        }

        // Apply (FilmGrain.cpp:346-360).
        const strength = f32(tone * intensityScale);
        const lumaGrain = grains[0]!;
        if (useVariation) {
          const redGrain = fmaf(f32(grains[1]! - lumaGrain), colorVariation, lumaGrain);
          const greenGrain = fmaf(f32(grains[2]! - lumaGrain), colorVariation, lumaGrain);
          const blueGrain = fmaf(f32(grains[3]! - lumaGrain), colorVariation, lumaGrain);
          R = clamp01(fmaf(fmaf(f32(redGrain - lumaGrain), colorAmount, lumaGrain), strength, R));
          G = clamp01(fmaf(fmaf(f32(greenGrain - lumaGrain), colorAmount, lumaGrain), strength, G));
          B = clamp01(fmaf(fmaf(f32(blueGrain - lumaGrain), colorAmount, lumaGrain), strength, B));
        } else {
          const delta = f32(lumaGrain * strength);
          R = clamp01(f32(R + delta));
          G = clamp01(f32(G + delta));
          B = clamp01(f32(B + delta));
        }

        if (A === 255) {
          d[i] = clampByte(f32(R * 255));
          d[i + 1] = clampByte(f32(G * 255));
          d[i + 2] = clampByte(f32(B * 255));
        } else {
          const ap = f32(A * INV_255);
          d[i] = clampByte(f32(ap * f32(R * 255)));
          d[i + 1] = clampByte(f32(ap * f32(G * 255)));
          d[i + 2] = clampByte(f32(ap * f32(B * 255)));
        }
      }
    }
  },
};
