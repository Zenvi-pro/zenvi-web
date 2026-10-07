/**
 * Brightness & Contrast, Saturation, Hue and Negate, ported from libopenshot
 * src/effects/Brightness.cpp:49-125, Saturation.cpp:116-248, Hue.cpp:47-92
 * and Negate.cpp:34-41 (QImage::invertPixels). Float expressions follow the
 * arm64 build's fused multiply-adds (checked in the disassembly): a fused
 * `a*b + c` is `f32(a*b + c)` with the float product exact in double.
 */

import { byteMul, unpremulChannel, type PremulImage } from "../pixels.js";
import { num } from "./params.js";
import type { KernelSpec, Params } from "./types.js";

const f32 = Math.fround;
const INV_255 = f32(1 / 255);

/** `lut[i] = 255.0f / i` (the inv_alpha tables). */
const INV_ALPHA: Float32Array = (() => {
  const t = new Float32Array(256);
  for (let i = 1; i < 256; i += 1) t[i] = f32(255 / i);
  return t;
})();

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

export const brightness: KernelSpec = {
  type: "Brightness",
  supported: true,
  customMaskBlend: true,
  run(image: PremulImage, params: Params): void {
    const b = f32(num(params, "brightness", 0));
    const c = f32(num(params, "contrast", 3));
    const cf = f32(f32(f32(c + 255) * 259) / f32(f32(259 - c) * 255));
    const offset = Math.trunc(f32(255 * b));
    const adjust = (v: number): number => clampByte(clampByte(Math.trunc(f32(cf * (v - 128) + 128))) + offset);
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3]!;
      if (a <= 0) continue;
      if (a === 255) {
        d[i] = adjust(d[i]!);
        d[i + 1] = adjust(d[i + 1]!);
        d[i + 2] = adjust(d[i + 2]!);
      } else {
        const ap = f32(a * INV_255);
        const inv = INV_ALPHA[a]!;
        const r = adjust(Math.trunc(f32(d[i]! * inv)));
        const g = adjust(Math.trunc(f32(d[i + 1]! * inv)));
        const bl = adjust(Math.trunc(f32(d[i + 2]! * inv)));
        d[i] = Math.trunc(f32(r * ap));
        d[i + 1] = Math.trunc(f32(g * ap));
        d[i + 2] = Math.trunc(f32(bl * ap));
      }
    }
  },
};

/** sqrt_lut[i] = sqrtf(i) for the Rec.601 weighted intensity. */
const SQRT_LUT: Float32Array = (() => {
  const t = new Float32Array(65026);
  for (let i = 0; i <= 65025; i += 1) t[i] = f32(Math.sqrt(i));
  return t;
})();

const SQRT_PR = f32(Math.sqrt(f32(0.299)));
const SQRT_PG = f32(Math.sqrt(f32(0.587)));
const SQRT_PB = f32(Math.sqrt(f32(0.114)));

export const saturation: KernelSpec = {
  type: "Saturation",
  supported: true,
  customMaskBlend: true,
  run(image: PremulImage, params: Params): void {
    const s = f32(num(params, "saturation", 1));
    const sR = f32(num(params, "saturation_R", 1));
    const sG = f32(num(params, "saturation_G", 1));
    const sB = f32(num(params, "saturation_B", 1));
    const out = [0, 0, 0];
    const apply = (R: number, G: number, B: number): void => {
      const weighted = (77 * R * R + 150 * G * G + 29 * B * B + 128) >> 8;
      const p = SQRT_LUT[Math.min(65025, weighted)]!;
      R = clampByte(Math.trunc(f32(f32(R - p) * s + p)));
      G = clampByte(Math.trunc(f32(f32(G - p) * s + p)));
      B = clampByte(Math.trunc(f32(f32(B - p) * s + p)));
      const pr = f32(R * SQRT_PR);
      const pg = f32(G * SQRT_PG);
      const pb = f32(B * SQRT_PB);
      const Rr = Math.trunc(f32(f32(R - pr) * sR + pr));
      const Gr = Math.trunc(f32(pr - pr * sR));
      const Rg = Math.trunc(f32(pg - pg * sG));
      const Gg = Math.trunc(f32(f32(G - pg) * sG + pg));
      const Rb = Math.trunc(f32(pb - pb * sB));
      const Bb = Math.trunc(f32(f32(B - pb) * sB + pb));
      out[0] = clampByte(Rr + Rg + Rb);
      out[1] = clampByte(Gr + Gg + Rb);
      out[2] = clampByte(Gr + Rg + Bb);
    };
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3]!;
      if (a <= 0) continue;
      if (a === 255) {
        apply(d[i]!, d[i + 1]!, d[i + 2]!);
        d[i] = out[0]!;
        d[i + 1] = out[1]!;
        d[i + 2] = out[2]!;
      } else {
        const ap = f32(a * INV_255);
        const inv = INV_ALPHA[a]!;
        apply(Math.trunc(f32(d[i]! * inv)), Math.trunc(f32(d[i + 1]! * inv)), Math.trunc(f32(d[i + 2]! * inv)));
        d[i] = Math.trunc(f32(out[0]! * ap));
        d[i + 1] = Math.trunc(f32(out[1]! * ap));
        d[i + 2] = Math.trunc(f32(out[2]! * ap));
      }
    }
  },
};

/** EffectBase::constrain: C++ truncates the float argument to int, then clamps. */
function constrain(v: number): number {
  const t = Number.isNaN(v) ? 0 : v >= 2147483647 ? 2147483647 : v <= -2147483648 ? -2147483648 : Math.trunc(v);
  return t < 0 ? 0 : t > 255 ? 255 : t;
}

/** arm64 fcvtzs: NaN → 0, ±Infinity saturate. */
function toInt(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v >= 2147483647) return 2147483647;
  if (v <= -2147483648) return -2147483648;
  return Math.trunc(v);
}

export const hue: KernelSpec = {
  type: "Hue",
  supported: true,
  customMaskBlend: true,
  run(image: PremulImage, params: Params): void {
    const degrees = 360 * num(params, "hue", 0);
    const pi = f32(3.14159265);
    const cosA = f32(Math.cos((degrees * pi) / 180));
    const sinA = f32(Math.sin((degrees * pi) / 180));
    const third = f32(1 / 3);
    const sqrtThird = f32(Math.sqrt(third));
    const oneMinus = f32(1 - cosA);
    const m0 = f32(cosA + f32(oneMinus / 3));
    const sinTerm = f32(sqrtThird * sinA);
    const m1 = f32(third * oneMinus - sinTerm);
    const m2 = f32(third * oneMinus + sinTerm);
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3]!;
      const ap = f32(a / 255);
      // `pixels / alpha_percent`: 0/0 is NaN → 0 for transparent pixels.
      const R = toInt(f32(d[i]! / ap));
      const G = toInt(f32(d[i + 1]! / ap));
      const B = toInt(f32(d[i + 2]! / ap));
      const r = constrain(f32(B * m2 + f32(R * m0 + f32(G * m1))));
      const g = constrain(f32(B * m1 + f32(R * m2 + f32(G * m0))));
      const b = constrain(f32(B * m0 + f32(R * m1 + f32(G * m2))));
      d[i] = Math.trunc(f32(ap * r));
      d[i + 1] = Math.trunc(f32(ap * g));
      d[i + 2] = Math.trunc(f32(ap * b));
    }
  },
};

/**
 * Negate: `QImage::invertPixels()` on a premultiplied image converts to
 * ARGB32 (qUnpremultiply), inverts RGB and converts back (qPremultiply).
 */
export const negate: KernelSpec = {
  type: "Negate",
  supported: true,
  run(image: PremulImage): void {
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3]!;
      if (a === 255) {
        d[i] = 255 - d[i]!;
        d[i + 1] = 255 - d[i + 1]!;
        d[i + 2] = 255 - d[i + 2]!;
      } else if (a === 0) {
        // Unpremultiplied (0,0,0,0) inverts to (255,255,255,0), which premultiplies back to 0.
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
      } else {
        d[i] = byteMul(255 - unpremulChannel(d[i]!, a), a);
        d[i + 1] = byteMul(255 - unpremulChannel(d[i + 1]!, a), a);
        d[i + 2] = byteMul(255 - unpremulChannel(d[i + 2]!, a), a);
      }
    }
  },
};
