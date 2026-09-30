/**
 * The one place render-web reaches into `@zenvi/engine` for semantics.
 *
 * The engine owns every domain rule: which clips are visible, transforms,
 * keyframes, effect math, frame↔time math. render-web only executes the plans
 * and kernels it hands out. Consumers can pass their own `RenderEngine` (tests
 * use hand-built plans).
 */

import type { Project } from "@zenvi/engine";
import type { AudioKernel, AudioPlan, FramePlan, MaskInstance, PlanSize, RgbaImage, VideoKernel } from "@zenvi/engine/render";

export interface RenderEngine {
  /** libopenshot `Timeline::GetFrame` as a plan, for 1-based timeline `frame` at canvas `size`. */
  planFrame(project: Project, frame: number, size: PlanSize): FramePlan;
  /** Audio segments covering the timeline range `[start, end)` seconds. */
  planAudio(project: Project, range: { start: number; end: number }): AudioPlan;
  /** Kernel for a video effect class, or undefined when unsupported (skipped, like libopenshot). */
  getVideoKernel(type: string): VideoKernel | undefined;
  /** Kernel for an audio effect class, or undefined when unsupported. */
  getAudioKernel(type: string): AudioKernel | undefined;
  /** libopenshot `Mask` math: `mask` has `image`'s size. */
  applyMask(image: RgbaImage, mask: RgbaImage, instance: MaskInstance): void;
  /** The 1-based frame showing at playhead time `seconds`. */
  frameAt(project: Project, seconds: number): number;
  /** Start time of 1-based `frame`, seconds. */
  frameTime(project: Project, frame: number): number;
  /** The last frame that has content (libopenshot `Timeline::GetMaxFrame`). */
  lastFrame(project: Project): number;
}

// ---------------------------------------------------------------------------
// STUB (W5, remove when the engine lands): `@zenvi/engine/render` does not yet
// export planFrame/planAudio/getVideoKernel/getAudioKernel/applyMask (W2), and
// the timeline helpers (frameContaining, frameToSeconds, maxFrame; W1) are not
// committed. Replace this block with direct imports of those functions.
// ---------------------------------------------------------------------------

function notYet(name: string): never {
  throw new Error(`${name} is not available yet: @zenvi/engine/render has not shipped it`);
}

const pendingEngine: RenderEngine = {
  planFrame: () => notYet("planFrame"),
  planAudio: () => notYet("planAudio"),
  getVideoKernel: () => undefined,
  getAudioKernel: () => undefined,
  applyMask: () => notYet("applyMask"),
  frameAt: () => notYet("frameAt (timeline frameContaining)"),
  frameTime: () => notYet("frameTime (timeline frameToSeconds)"),
  lastFrame: () => notYet("lastFrame (timeline maxFrame)"),
};

/** The engine render-web uses when a caller does not pass one. */
export const defaultEngine: RenderEngine = pendingEngine;
