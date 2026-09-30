/**
 * `@zenvi/engine/render`: libopenshot 1.0 render semantics in pure
 * TypeScript — frame/audio planning, effect kernels, the CPU compositor and
 * the Qt raster primitives they are built on.
 */
export type * from "./types.js";

export { applyVideoEffect, getKernelSpec, getVideoKernel, processEffect, registerKernels, supportedVideoEffects } from "./kernels/registry.js";
export type { KernelSpec, PremulKernel } from "./kernels/types.js";
export { applyMask, applyMaskFromSource, applyMaskPremul, maskGrayTable, type MaskSettings } from "./kernels/mask.js";
export { evaluateAnimatedCurve, evaluateEffectParams, evaluateValue, sampleCurve, type EvaluatedCurve } from "./plan/effect-params.js";
export { clonePremul, createPremul, premultiply, unpremultiply, wrapPremul, type PremulImage } from "./pixels.js";
export { smoothScale } from "./qt/smooth-scale.js";
export { QTransform } from "./qt/transform.js";
