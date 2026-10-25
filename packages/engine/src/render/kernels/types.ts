/**
 * Internal kernel contract. Kernels port libopenshot `EffectBase::GetFrame`
 * implementations and run on premultiplied bytes (what libopenshot frames
 * hold); `registry.ts` wraps them for straight-RGBA callers.
 */

import type { PremulImage } from "../pixels.js";
import type { EvaluatedParam, KernelContext } from "../types.js";

export type Params = Readonly<Record<string, EvaluatedParam>>;

/**
 * An effect's image math. Mutates `image` in place and returns nothing, or
 * returns a new image (a different size, or a freshly composed one).
 */
export type PremulKernel = (image: PremulImage, params: Params, ctx: KernelContext) => PremulImage | void;

export interface KernelSpec {
  /** libopenshot class name (`EffectInfo::CreateEffect` type string). */
  type: string;
  /**
   * False when the effect needs data the engine cannot produce (OpenCV
   * models, protobuf tracking data): the kernel passes frames through.
   */
  supported: boolean;
  /** `EffectBase::HandlesMaskInternally()` (Mask): skip the generic effect mask. */
  handlesMask?: boolean;
  /**
   * Keeps state across frames in `ctx.state` (BeatSync's envelope, DenoiseImage's previous frame, SphericalProjection's
   * reused map): a render must run it on consecutive frames in order, in one place. Other kernels are pure per frame.
   */
  sequential?: boolean;
  /**
   * `UseCustomMaskBlend()`: effects with a `mask_mode` "vary strength" option
   * (Brightness, Saturation, Hue, Blur, Pixelate, Sharpen) blend by the
   * squared mask value instead of the generic linear blend.
   */
  customMaskBlend?: boolean;
  run: PremulKernel;
}
