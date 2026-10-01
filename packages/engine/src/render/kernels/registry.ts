/**
 * Kernel registry and `EffectBase::ProcessFrame` (libopenshot
 * src/EffectBase.cpp:641-673): run an effect's kernel, then blend the result
 * with the original through the effect's generic mask when it has one.
 */

import { clonePremul, premultiply, unpremultiply, type PremulImage } from "../pixels.js";
import type { EffectInstance, KernelContext, RgbaImage, VideoKernel } from "../types.js";
import { analogTape } from "./analog-tape.js";
import { blur, pixelate } from "./blur.js";
import { caption } from "./caption.js";
import { chromaKey } from "./chroma-key.js";
import { brightness, hue, negate, saturation } from "./color-basic.js";
import { colorGrade } from "./color-grade.js";
import { colorMap } from "./color-map.js";
import { denoiseImage } from "./denoise.js";
import { displace } from "./displace.js";
import { blendVaryStrength, blendWithMask } from "./effect-mask.js";
import { filmGrain } from "./film-grain.js";
import { bars, colorShift, crop, deinterlace, shift, wave } from "./geometry.js";
import { scaledPremul } from "./image-cache.js";
import { lensFlare } from "./lens-flare.js";
import { mask } from "./mask.js";
import { bool, int, readerPath } from "./params.js";
import { glow, shadow } from "./shadow-glow.js";
import { sharpen } from "./sharpen.js";
import { sphericalProjection } from "./spherical.js";
import { timer } from "./timer.js";
import type { KernelSpec } from "./types.js";

/** Effects that need OpenCV models or protobuf tracking data: frames pass through. */
function unsupported(type: string): KernelSpec {
  return { type, supported: false, run: () => undefined };
}

const SPECS: readonly KernelSpec[] = [
  brightness,
  saturation,
  hue,
  negate,
  blur,
  pixelate,
  crop,
  shift,
  colorShift,
  wave,
  deinterlace,
  bars,
  chromaKey,
  sharpen,
  mask,
  colorMap,
  colorGrade,
  filmGrain,
  denoiseImage,
  shadow,
  glow,
  lensFlare,
  displace,
  sphericalProjection,
  analogTape,
  caption,
  timer,
  unsupported("Outline"),
  unsupported("Stabilizer"),
  unsupported("Tracker"),
  unsupported("ObjectDetection"),
  unsupported("ObjectMask"),
];

const BY_TYPE = new Map<string, KernelSpec>();

/** Register kernels (used by the kernel modules that land separately). */
export function registerKernels(specs: readonly KernelSpec[]): void {
  for (const spec of specs) BY_TYPE.set(spec.type, spec);
}
registerKernels(SPECS);

/** The kernel for a libopenshot effect class, if the engine knows it. */
export function getKernelSpec(type: string): KernelSpec | undefined {
  return BY_TYPE.get(type);
}

/** Effect types with a working kernel (supported = true). */
export function supportedVideoEffects(): string[] {
  return [...BY_TYPE.values()].filter((s) => s.supported).map((s) => s.type);
}

/**
 * `EffectBase::ProcessFrame` on premultiplied pixels. May return a new image
 * (size-changing effects); otherwise returns `image`, modified in place.
 */
export function processEffect(image: PremulImage, effect: EffectInstance, ctx: KernelContext): PremulImage {
  const spec = BY_TYPE.get(effect.type);
  if (!spec || !spec.supported) return image;
  const kctx: KernelContext = ctx.frame === effect.frame ? ctx : { ...ctx, frame: effect.frame };
  const params = effect.params;
  const maskPath = spec.handlesMask ? undefined : readerPath(params, "mask_reader");
  const maskSource = maskPath ? ctx.images.get(maskPath) : undefined;
  if (!maskSource) return spec.run(image, params, kctx) ?? image;

  const original = clonePremul(image);
  const out = spec.run(image, params, kctx) ?? image;
  if (out.width !== original.width || out.height !== original.height || out.width === 0 || out.height === 0) return out;
  const maskImage = scaledPremul(maskSource, out.width, out.height, ctx.imageSizes?.[maskPath!]);
  const invert = bool(params, "mask_invert", false);
  if (spec.customMaskBlend && int(params, "mask_mode", 0) === 1) blendVaryStrength(original, out, maskImage, invert);
  else blendWithMask(original, out, maskImage, invert);
  return out;
}

/**
 * Apply one evaluated effect to a straight-RGBA image (render-web's entry
 * point): premultiply like libopenshot frames, process, unpremultiply.
 * Returns `image` (modified) or a new image when the effect changes size.
 */
export function applyVideoEffect(image: RgbaImage, effect: EffectInstance, ctx: KernelContext): RgbaImage {
  const pm = premultiply(image);
  const out = processEffect(pm, effect, ctx);
  if (out.width === image.width && out.height === image.height) {
    unpremultiply(out, image);
    return image;
  }
  return unpremultiply(out);
}

/**
 * The contract `VideoKernel` for an effect type (straight RGBA in place, or
 * a new image for size changes). Does not include the generic effect mask;
 * use `applyVideoEffect` for full `ProcessFrame` behavior.
 */
export function getVideoKernel(type: string): VideoKernel | undefined {
  const spec = BY_TYPE.get(type);
  if (!spec) return undefined;
  return (image, params, ctx) => {
    if (!spec.supported) return;
    const pm = premultiply(image);
    const out = spec.run(pm, params, ctx) ?? pm;
    if (out.width === image.width && out.height === image.height) {
      unpremultiply(out, image);
      return;
    }
    return unpremultiply(out);
  };
}
