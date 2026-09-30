/**
 * The engine functions a Node render needs, from `@zenvi/engine/render`:
 * the frame and audio planners and the CPU compositor. Behind one interface
 * so tests can drive the encoder pipeline with synthetic plans.
 * API: scratchpad/requests/W2-render.md.
 */

import type { AudioPlan, FramePlan, KernelAudio, PlanSize, Project, RgbaImage, TextRasterizer } from "@zenvi/engine";

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
}

type EngineRenderModule = {
  planFrame?: RenderEngine["planFrame"];
  planAudio?: RenderEngine["planAudio"];
  compositeFrame?: (plan: FramePlan, sources: CompositeSources, out?: RgbaImage) => RgbaImage;
  createCompositorState?: () => unknown;
};

let cached: Promise<RenderEngine> | undefined;

/** The engine's planner and compositor. Fails clearly if this build lacks them. */
export function defaultRenderEngine(): Promise<RenderEngine> {
  cached ??= import("@zenvi/engine/render").then((mod) => {
    const m = mod as unknown as EngineRenderModule;
    const { planFrame, planAudio, compositeFrame } = m;
    if (!planFrame || !planAudio || !compositeFrame) {
      throw new Error("This Zenvi build has no frame planner/compositor (@zenvi/engine/render); rendering is unavailable.");
    }
    return {
      planFrame,
      planAudio,
      compositeFrame: (plan, sources) => compositeFrame(plan, sources),
      createState: () => (m.createCompositorState ? m.createCompositorState() : undefined),
    };
  });
  return cached;
}

/** Effects that draw text and need the font hook. */
const TEXT_EFFECTS = new Set(["Caption", "Timer"]);

export function projectNeedsText(project: Project): boolean {
  return (project.clips ?? []).some((clip) => clip.effects?.some((e) => TEXT_EFFECTS.has(String(e.class_name ?? e.type))));
}
