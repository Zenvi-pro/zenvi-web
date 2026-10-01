/**
 * The one place render-web reaches into `@zenvi/engine` for semantics.
 *
 * The engine owns every domain rule: which clips are visible, transforms,
 * keyframes, effect math, frame↔time math, preview sizing. render-web only
 * executes the plans and kernels it hands out. Consumers can pass their own
 * `RenderEngine` (tests use hand-built plans).
 */

import { frameContaining, frameToSeconds, maxFrame, type Project } from "@zenvi/engine";
import {
  applyMask,
  applyVideoEffect,
  getAudioKernel,
  planAudio,
  planFrame,
  supportedVideoEffects,
  type AudioKernel,
  type AudioPlan,
  type EffectInstance,
  type FramePlan,
  type KernelContext,
  type MaskInstance,
  type PlanSize,
  type RgbaImage,
} from "@zenvi/engine/render";

export interface PlanFrameOptions {
  /**
   * true: `size` is a preview box; the plan's canvas is the project fitted
   * into it (libopenshot `Timeline::SetMaxSize`, never larger than the
   * project) while effects still see the project's timeline size. false
   * (default): `size` is the render size (export).
   */
  preview?: boolean;
}

export interface RenderEngine {
  /** libopenshot `Timeline::GetFrame` as a plan, for 1-based timeline `frame`. */
  planFrame(project: Project, frame: number, size: PlanSize, options?: PlanFrameOptions): FramePlan;
  /** Audio segments covering the timeline range `[start, end)` seconds. */
  planAudio(project: Project, range: { start: number; end: number }): AudioPlan;
  /** libopenshot `EffectBase::ProcessFrame`: the effect plus its generic effect mask. May return a new size. */
  applyVideoEffect(image: RgbaImage, effect: EffectInstance, ctx: KernelContext): RgbaImage;
  /** Whether `applyVideoEffect` implements `type` (others are skipped, as libopenshot skips unknown types). */
  supportsVideoEffect(type: string): boolean;
  /** Kernel for an audio effect class, or undefined when unsupported. */
  getAudioKernel(type: string): AudioKernel | undefined;
  /** libopenshot `Mask` math; `mask` may be any size. */
  applyMask(image: RgbaImage, mask: RgbaImage, instance: MaskInstance): void;
  /** The 1-based frame showing at playhead time `seconds`. */
  frameAt(project: Project, seconds: number): number;
  /** Start time of 1-based `frame`, seconds. */
  frameTime(project: Project, frame: number): number;
  /** The last frame that has content (libopenshot `Timeline::GetMaxFrame`). */
  lastFrame(project: Project): number;
}

let supported: Set<string> | null = null;

/** The engine render-web uses when a caller does not pass one. */
export const defaultEngine: RenderEngine = {
  planFrame: (project, frame, size, options) => planFrame(project, frame, size, options),
  planAudio: (project, range) => planAudio(project, range),
  applyVideoEffect,
  supportsVideoEffect: (type) => (supported ??= new Set(supportedVideoEffects())).has(type),
  getAudioKernel,
  applyMask,
  frameAt: (project, seconds) => frameContaining(seconds, project.fps),
  frameTime: (project, frame) => frameToSeconds(frame, project.fps),
  lastFrame: (project) => maxFrame(project),
};
