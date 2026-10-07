/**
 * The engine functions a Node render needs, from `@zenvi/engine/render`:
 * the frame and audio planners and the CPU compositor. Behind one interface
 * so tests can drive the encoder pipeline with synthetic plans.
 * API: scratchpad/requests/W2-render.md.
 */

import type { AudioKernel, AudioPlan, FramePlan, KernelAudio, PlanSize, Project, RgbaImage, TextRasterizer } from "@zenvi/engine";
import * as render from "@zenvi/engine/render";

/** What the compositor reads for one frame (engine `CompositeSources`). */
export interface CompositeSources {
  /** Decoded source per `plan.layers` index (draw size for video/SVG, natural size for stills); null for color layers. */
  layers: readonly (RgbaImage | null | undefined)[];
  /** Masks and effect images by path, natural size. */
  images?: ReadonlyMap<string, RgbaImage>;
  /** LUT texts by path. */
  texts?: ReadonlyMap<string, string>;
  /** Font hook for Caption/Timer. */
  text?: TextRasterizer;
  /** Clip audio per layer index, for layers whose plan asks for it. */
  audio?: readonly (KernelAudio | null | undefined)[];
  /** The render's compositor state (same object for every frame of a sequential render). */
  state?: unknown;
}

export interface PlanOptions {
  /** true: `size` is a preview box (desktop preview semantics); false: an export size. */
  preview?: boolean;
}

export interface RenderEngine {
  planFrame(project: Project, frame: number, size: PlanSize, options?: PlanOptions): FramePlan;
  planAudio(project: Project, range: { start: number; end: number }): AudioPlan;
  compositeFrame(plan: FramePlan, sources: CompositeSources): RgbaImage;
  /** A fresh compositor state for one sequential render. */
  createState(): unknown;
  /** Audio effect DSP (engine kernels); absent: audio effects are skipped with a warning. */
  getAudioKernel?(type: string): AudioKernel | undefined;
  /** Set when this build lacks part of the pipeline (rendered anyway, degraded). */
  limitations?: string[];
}

type PlanAudio = RenderEngine["planAudio"];

/** The engine's planner and compositor. */
export async function defaultRenderEngine(): Promise<RenderEngine> {
  const planAudio = (render as unknown as { planAudio?: PlanAudio }).planAudio;
  const limitations: string[] = [];
  if (!planAudio) limitations.push("This build has no audio planner yet: renders are silent.");
  return {
    planFrame: (project, frame, size, options) => render.planFrame(project, frame, size, options),
    planAudio: planAudio ?? ((project, range) => ({ sampleRate: project.sample_rate, channels: project.channels, start: range.start, end: range.end, segments: [] })),
    compositeFrame: (plan, sources) => render.compositeFrame(plan, sources as render.CompositeSources),
    createState: () => render.createCompositorState(),
    getAudioKernel: (type) => render.getAudioKernel(type),
    limitations,
  };
}

/** Effects that draw text and need the font hook. */
const TEXT_EFFECTS = new Set(["Caption", "Timer"]);

export function projectNeedsText(project: Project): boolean {
  return (project.clips ?? []).some((clip) => clip.effects?.some((e) => TEXT_EFFECTS.has(String(e.class_name ?? e.type))));
}
