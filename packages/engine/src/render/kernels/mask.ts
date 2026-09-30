/**
 * Alpha Mask / Wipe Transition, ported from libopenshot
 * src/effects/Mask.cpp:57-164. The mask image is stretched to the frame
 * image with Qt smooth scaling (EffectBase::GetMaskImage,
 * EffectBase.cpp:485-547), its premultiplied gray level is shifted by
 * `brightness` and steepened by `contrast`, and the result scales all four
 * premultiplied bytes of the frame (white hides, black shows).
 */

import { clampU8, premultiply, unpremultiply, type PremulImage } from "../pixels.js";
import { smoothScale } from "../qt/smooth-scale.js";
import type { RgbaImage } from "../types.js";
import { scaledPremul } from "./image-cache.js";
import { bool, num, readerPath } from "./params.js";
import type { KernelSpec, Params } from "./types.js";

const f32 = Math.fround;

export interface MaskSettings {
  /** Mask `brightness` keyframe value at the effect frame (-1..1). */
  brightness: number;
  /** Mask `contrast` keyframe value (0..20). */
  contrast: number;
  /** `replace_image`: output the mask itself (grayscale) instead of masking. */
  replaceImage: boolean;
  /** EffectBase `mask_invert`. */
  invert: boolean;
}

/** mul_lut[alpha][value] = value * alpha / 255, integer division (Mask.cpp:92-100). */
const MUL_LUT: Uint8Array = (() => {
  const t = new Uint8Array(256 * 256);
  for (let a = 0; a < 256; a += 1) for (let v = 0; v < 256; v += 1) t[a * 256 + v] = Math.trunc((v * a) / 255);
  return t;
})();

/** adjusted_gray[g] for this frame's brightness/contrast (Mask.cpp:77-91). */
export function maskGrayTable(brightness: number, contrast: number): Uint8Array {
  const brightnessAdj = Math.trunc(255 * brightness);
  const contrastFactor = f32(20 / Math.max(0.5, f32(20 - f32(contrast))));
  const table = new Uint8Array(256);
  for (let g = 0; g < 256; g += 1) {
    table[g] = clampU8(Math.trunc(f32(contrastFactor * (g + brightnessAdj - 128) + 128)));
  }
  return table;
}

/**
 * Apply a mask to a premultiplied image in place. `mask` may be any size;
 * it is scaled to the image like libopenshot does.
 */
export function applyMaskPremul(image: PremulImage, mask: PremulImage, settings: MaskSettings): void {
  if (image.width <= 0 || image.height <= 0 || mask.width <= 0 || mask.height <= 0) return;
  applyScaledMask(image, smoothScale(mask, image.width, image.height), settings);
}

/** The per-pixel Mask math with a mask already at the image size. */
function applyScaledMask(image: PremulImage, scaled: PremulImage, settings: MaskSettings): void {
  const m = scaled.data;
  const adjusted = maskGrayTable(settings.brightness, settings.contrast);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = (m[i]! * 11 + m[i + 1]! * 16 + m[i + 2]! * 5) >> 5;
    const diff = clampU8(m[i + 3]! - adjusted[gray]!);
    if (settings.replaceImage) {
      d[i] = diff;
      d[i + 1] = diff;
      d[i + 2] = diff;
      d[i + 3] = diff;
      continue;
    }
    const row = (settings.invert ? 255 - diff : diff) * 256;
    d[i] = MUL_LUT[row + d[i]!]!;
    d[i + 1] = MUL_LUT[row + d[i + 1]!]!;
    d[i + 2] = MUL_LUT[row + d[i + 2]!]!;
    d[i + 3] = MUL_LUT[row + d[i + 3]!]!;
  }
}

/**
 * Transition mask on straight RGBA (the contract renderers call). Opaque
 * images round-trip exactly; semi-transparent ones through Qt's
 * premultiply/unpremultiply.
 */
export function applyMask(image: RgbaImage, maskImage: RgbaImage, settings: MaskSettings): void {
  if (image.width <= 0 || image.height <= 0 || maskImage.width <= 0 || maskImage.height <= 0) return;
  const pm = premultiply(image);
  applyScaledMask(pm, scaledPremul(maskImage, image.width, image.height), settings);
  unpremultiply(pm, image);
}

/** Transition mask on a premultiplied layer (the CPU compositor's entry point). */
export function applyMaskFromSource(image: PremulImage, maskImage: RgbaImage, settings: MaskSettings): void {
  if (image.width <= 0 || image.height <= 0 || maskImage.width <= 0 || maskImage.height <= 0) return;
  applyScaledMask(image, scaledPremul(maskImage, image.width, image.height), settings);
}

/** Mask as a clip or timeline effect (reads its mask image from the kernel context). */
export const mask: KernelSpec = {
  type: "Mask",
  supported: true,
  handlesMask: true,
  run(image: PremulImage, params: Params, ctx): void {
    const path = readerPath(params, "mask_reader") ?? readerPath(params, "reader");
    if (!path) return;
    const source = ctx.images.get(path);
    if (!source) return;
    applyMaskFromSource(image, source, {
      brightness: num(params, "brightness", 0),
      contrast: num(params, "contrast", 0),
      replaceImage: bool(params, "replace_image", false),
      invert: bool(params, "mask_invert", false),
    });
  },
};
