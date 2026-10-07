/**
 * `@zenvi/engine/render`: libopenshot 1.0 render semantics in pure
 * TypeScript — frame/audio planning, effect kernels, the CPU compositor and
 * the Qt raster primitives they are built on.
 */
export type * from "./types.js";

export { applyVideoEffect, getKernelSpec, getVideoKernel, processEffect, registerKernels, supportedVideoEffects } from "./kernels/registry.js";
export type { KernelSpec, PremulKernel } from "./kernels/types.js";
export { getAudioKernel, supportedAudioEffects } from "./audio/index.js";
export { applyMask, applyMaskFromSource, applyMaskPremul, maskGrayTable, type MaskSettings } from "./kernels/mask.js";
export { evaluateAnimatedCurve, evaluateEffectParams, evaluateValue, sampleCurve, type EvaluatedCurve } from "./plan/effect-params.js";
export { clonePremul, createPremul, premultiply, unpremultiply, wrapPremul, type PremulImage } from "./pixels.js";
export { smoothScale } from "./qt/smooth-scale.js";
export { QTransform } from "./qt/transform.js";
export { planFrame, planCanvas, remappedClipFrame, type PlanOptions } from "./plan/frame-plan.js";
export { planAudio, type AudioRange } from "./plan/audio-plan.js";
export { AUDIO_EFFECT_TYPES, VIDEO_EFFECT_TYPES } from "./plan/effects.js";
export { frameSampleOffset, samplesPerFrame } from "../timeline/time.js";
export { compositeFrame, createCompositorState, kernelContext, type CompositeSources, type CompositorState } from "./cpu/compositor.js";
