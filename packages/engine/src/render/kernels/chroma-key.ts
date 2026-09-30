/**
 * ChromaKey, ported from libopenshot src/effects/ChromaKey.cpp:102-626.
 *
 * The desktop's libopenshot is built without babl, so the `#if USE_BABL`
 * block is compiled out and every method except BASIC (0) runs the
 * BASIC_SOFT code (methods 1–10 included). This port does the same, which is
 * how existing projects look on the desktop.
 */

import type { PremulImage } from "../pixels.js";
import { color, getInt, int, num } from "./params.js";
import type { KernelSpec, Params } from "./types.js";

const f32 = Math.fround;

const INV_ALPHA: Float32Array = (() => {
  const t = new Float32Array(256);
  for (let i = 1; i < 256; i += 1) t[i] = f32(255 / i);
  return t;
})();

/** dist_lut[i] = uint16(sqrtf(i)) and dist_f_lut[i] = sqrtf(i). */
function sqrtf(i: number): number {
  return f32(Math.sqrt(i));
}

export const CHROMAKEY_BASIC = 0;
export const CHROMAKEY_BASIC_SOFT = 11;

export const chromaKey: KernelSpec = {
  type: "ChromaKey",
  supported: true,
  run(image: PremulImage, params: Params): void {
    const threshold = getInt(num(params, "fuzz", 20));
    const halo = getInt(num(params, "halo", 10));
    // A default-constructed Color has empty keyframes (value 0): black.
    const key = color(params, "color", [0, 0, 0, 0]);
    const kR = getInt(key[0]);
    const kG = getInt(key[1]);
    const kB = getInt(key[2]);
    const method = int(params, "keymethod", CHROMAKEY_BASIC_SOFT);
    const d = image.data;

    if (method === CHROMAKEY_BASIC) {
      for (let i = 0; i < d.length; i += 4) {
        const A = d[i + 3]!;
        if (A <= 0) continue;
        let R: number;
        let G: number;
        let B: number;
        if (A === 255) {
          R = d[i]!;
          G = d[i + 1]!;
          B = d[i + 2]!;
        } else {
          // static_cast<unsigned char>(float): valid premultiplied input stays <= 255.
          const inv = INV_ALPHA[A]!;
          R = Math.trunc(f32(d[i]! * inv)) & 255;
          G = Math.trunc(f32(d[i + 1]! * inv)) & 255;
          B = Math.trunc(f32(d[i + 2]! * inv)) & 255;
        }
        const rmean = (R + kR) >> 1;
        const r = R - kR;
        const g = G - kG;
        const b = B - kB;
        const distSq = (((512 + rmean) * r * r) >> 8) + 4 * g * g + (((767 - rmean) * b * b) >> 8);
        if (Math.trunc(sqrtf(distSq)) <= threshold) {
          d[i] = 0;
          d[i + 1] = 0;
          d[i + 2] = 0;
          d[i + 3] = 0;
        }
      }
      return;
    }

    const haloUpper = threshold + halo;
    const haloUpperSq = haloUpper * haloUpper;
    const invHalo = halo > 0 ? f32(1 / halo) : 0;
    for (let i = 0; i < d.length; i += 4) {
      const A = d[i + 3]!;
      if (A <= 0) continue;
      let R: number;
      let G: number;
      let B: number;
      if (A === 255) {
        R = d[i]!;
        G = d[i + 1]!;
        B = d[i + 2]!;
      } else {
        const inv = INV_ALPHA[A]!;
        R = Math.min(255, Math.max(0, Math.trunc(f32(d[i]! * inv))));
        G = Math.min(255, Math.max(0, Math.trunc(f32(d[i + 1]! * inv))));
        B = Math.min(255, Math.max(0, Math.trunc(f32(d[i + 2]! * inv))));
      }
      const rmean = (R + kR) >> 1;
      const r = R - kR;
      const g = G - kG;
      const b = B - kB;
      const distSq = (((512 + rmean) * r * r) >> 8) + 4 * g * g + (((767 - rmean) * b * b) >> 8);
      const distance = Math.trunc(sqrtf(distSq));
      if (distance <= threshold) {
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = 0;
      } else if (halo > 0 && distSq <= haloUpperSq) {
        const alphamult = f32(f32(sqrtf(distSq) - threshold) * invHalo);
        d[i] = Math.trunc(f32(d[i]! * alphamult));
        d[i + 1] = Math.trunc(f32(d[i + 1]! * alphamult));
        d[i + 2] = Math.trunc(f32(d[i + 2]! * alphamult));
        d[i + 3] = Math.trunc(f32(d[i + 3]! * alphamult));
      }
    }
  },
};
