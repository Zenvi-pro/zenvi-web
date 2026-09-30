/**
 * The mask every libopenshot 1.0 effect supports (`mask_reader`,
 * `mask_invert`, `mask_mode`), ported from src/EffectBase.cpp:600-673
 * (`BlendWithMask`, `ProcessFrame`) and the six `ApplyCustomMaskBlend`
 * overrides (e.g. effects/Brightness.cpp:136-175). Float steps follow the
 * arm64 build: `fma(original, 1 - f, f32(effected * f))`, truncated.
 */

import { qGray, type PremulImage } from "../pixels.js";

const f32 = Math.fround;

/** `BlendWithMask`: linear blend of all four bytes by the mask's gray value. */
export function blendWithMask(original: PremulImage, effected: PremulImage, mask: PremulImage, invert: boolean): void {
  const o = original.data;
  const e = effected.data;
  const m = mask.data;
  for (let i = 0; i < e.length; i += 4) {
    let gray = qGray(m[i]!, m[i + 1]!, m[i + 2]!);
    if (invert) gray = 255 - gray;
    const factor = f32(gray / 255);
    const inverse = f32(1 - factor);
    e[i] = Math.trunc(f32(o[i]! * inverse + f32(e[i]! * factor)));
    e[i + 1] = Math.trunc(f32(o[i + 1]! * inverse + f32(e[i + 1]! * factor)));
    e[i + 2] = Math.trunc(f32(o[i + 2]! * inverse + f32(e[i + 2]! * factor)));
    e[i + 3] = Math.trunc(f32(o[i + 3]! * inverse + f32(e[i + 3]! * factor)));
  }
}

/**
 * `ApplyCustomMaskBlend` ("vary strength", `mask_mode` 1): the squared mask
 * value drives the effect on color only; alpha stays the original's.
 */
export function blendVaryStrength(original: PremulImage, effected: PremulImage, mask: PremulImage, invert: boolean): void {
  const o = original.data;
  const e = effected.data;
  const m = mask.data;
  for (let i = 0; i < e.length; i += 4) {
    let factor = f32(qGray(m[i]!, m[i + 1]!, m[i + 2]!) / 255);
    if (invert) factor = f32(1 - factor);
    factor = f32(factor * factor);
    const inverse = f32(1 - factor);
    e[i] = Math.trunc(f32(o[i]! * inverse + f32(e[i]! * factor)));
    e[i + 1] = Math.trunc(f32(o[i + 1]! * inverse + f32(e[i + 1]! * factor)));
    e[i + 2] = Math.trunc(f32(o[i + 2]! * inverse + f32(e[i + 2]! * factor)));
    e[i + 3] = o[i + 3]!;
  }
}
