/**
 * Style mixes for transitioning every cut on a track.
 *
 * Planning follows "The Current" and "Transition vocabulary" of HeyGen
 * HyperFrames' motion doctrine (Apache-2.0,
 * .claude/skills/motion-doctrine/SKILL.md): a sequence keeps ONE dominant
 * direction (default left) on every ordinary cut and never flips it on
 * consecutive cuts; it uses two or three transitions and repeats them; the
 * reserved vectors (zoom-through: deeper into the same thought; pull-back:
 * an arrival) are spent once, as the accent on the last cut. Deterministic,
 * so the same call always gives the same edit.
 */

import type { MotionTransitionId } from "./presets.js";

export interface StyleStep {
  preset: MotionTransitionId;
  intensity?: number;
}

export interface MotionTransitionStyleDef {
  /** Repeated cut by cut. */
  pattern: readonly StyleStep[];
  /** The last cut of a sequence of three or more. */
  accent: StyleStep;
}

export const MOTION_TRANSITION_STYLES = {
  /** Social / hype edit: whips in the current with a crash zoom every third cut; it lands with a pull-back. */
  hype: { pattern: [{ preset: "whip" }, { preset: "whip" }, { preset: "zoom_in" }], accent: { preset: "zoom_out" } },
  /** Restrained, filmic: pushes in the current and defocus cuts; it ends by flying into the last shot. */
  cinematic: { pattern: [{ preset: "slide", intensity: 0.7 }, { preset: "blur_dissolve" }], accent: { preset: "zoom_through", intensity: 0.7 } },
} as const satisfies Record<string, MotionTransitionStyleDef>;

export type MotionTransitionStyle = keyof typeof MOTION_TRANSITION_STYLES;
export const MOTION_TRANSITION_STYLE_IDS = Object.keys(MOTION_TRANSITION_STYLES) as MotionTransitionStyle[];

/** The step for cut `index` (0-based) of a sequence of `count` cuts. */
export function styleStep(style: MotionTransitionStyle, index: number, count: number): StyleStep {
  const def: MotionTransitionStyleDef = MOTION_TRANSITION_STYLES[style];
  if (count >= 3 && index === count - 1) return def.accent;
  return def.pattern[index % def.pattern.length]!;
}

/** Every preset a style can use. */
export function stylePresets(style: MotionTransitionStyle): MotionTransitionId[] {
  const def: MotionTransitionStyleDef = MOTION_TRANSITION_STYLES[style];
  return [...new Set([...def.pattern.map((s) => s.preset), def.accent.preset])];
}
