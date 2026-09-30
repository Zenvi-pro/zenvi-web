/**
 * The engine functions a Node render needs: the frame and audio planners and
 * the CPU compositor (`@zenvi/engine/render`). Kept behind one interface so
 * tests can drive the encoder pipeline with synthetic plans.
 */

import type { AudioPlan, FramePlan, PlanSize, Project, RgbaImage } from "@zenvi/engine";
import type { PreparedFrame } from "../decode/sources.js";

export interface RenderEngine {
  planFrame(project: Project, frame: number, size: PlanSize): FramePlan;
  planAudio(project: Project, range: { start: number; end: number }): AudioPlan;
  /** Composite one planned frame from its decoded sources into a canvas-sized image. */
  composite(plan: FramePlan, prepared: PreparedFrame): RgbaImage;
}

type EngineRenderModule = {
  planFrame?: (project: Project, frame: number, size: PlanSize) => FramePlan;
  planAudio?: (project: Project, range: { start: number; end: number }) => AudioPlan;
  compositeFrame?: (plan: FramePlan, sources: CompositeSources) => RgbaImage;
};

/** What the engine compositor reads for one frame. */
export interface CompositeSources {
  /** Source image per `plan.layers` entry, at its draw size. */
  layers: RgbaImage[];
  images: ReadonlyMap<string, RgbaImage>;
  texts: ReadonlyMap<string, string>;
}

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
      composite: (plan, prepared) => compositeFrame(plan, { layers: prepared.layers, images: prepared.images, texts: prepared.texts }),
    };
  });
  return cached;
}
