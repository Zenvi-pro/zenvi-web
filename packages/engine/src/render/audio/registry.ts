/**
 * Audio effect kernels by libopenshot class name (`EffectInfo::CreateEffect`
 * type strings, src/EffectInfo.cpp:29-158). Each kernel runs in place on one
 * libopenshot frame-sized block of planar samples with the effect's
 * parameters evaluated at that frame, and keeps its state (ring buffers,
 * filter memories, envelopes, generators) in the per-instance `state` map:
 * reference semantics are zero state at the first block, then contiguous
 * forward processing, like a desktop export.
 */

import type { AudioKernel } from "../types.js";
import { delay, echo } from "./delay.js";
import { distortion } from "./distortion.js";
import { compressor, expander } from "./dynamics.js";
import { noise } from "./noise.js";
import { parametricEq } from "./parametric-eq.js";
import { robotization, whisperization } from "./spectral.js";

const KERNELS: ReadonlyMap<string, AudioKernel> = new Map<string, AudioKernel>([
  ["Noise", noise],
  ["Delay", delay],
  ["Echo", echo],
  ["Distortion", distortion],
  ["ParametricEQ", parametricEq],
  ["Compressor", compressor],
  ["Expander", expander],
  ["Robotization", robotization],
  ["Whisperization", whisperization],
]);

/** The kernel for a libopenshot audio effect class, if the engine has one. */
export function getAudioKernel(className: string): AudioKernel | undefined {
  return KERNELS.get(className);
}

/** Audio effect class names with a kernel, in libopenshot registry order. */
export function supportedAudioEffects(): string[] {
  return [...KERNELS.keys()];
}
