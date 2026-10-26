/**
 * Style mixes for transitioning every cut on a track: a fixed rotation of
 * presets (deterministic, so the same call always gives the same edit).
 */

import type { MotionTransitionId } from "./presets.js";

export interface StyleStep {
  preset: MotionTransitionId;
  intensity?: number;
}

export const MOTION_TRANSITION_STYLES = {
  /** Social / hype edit: whips and punches with a glitch and a flash for accent. */
  hype: [
    { preset: "whip" },
    { preset: "zoom_in" },
    { preset: "whip" },
    { preset: "glitch" },
    { preset: "spin" },
    { preset: "zoom_out" },
    { preset: "flash_white" },
    { preset: "shake" },
  ],
  /** Restrained, filmic: defocus, slow pushes, an occasional dip. */
  cinematic: [
    { preset: "blur_dissolve" },
    { preset: "slide", intensity: 0.7 },
    { preset: "zoom_in", intensity: 0.5 },
    { preset: "blur_dissolve", intensity: 0.8 },
    { preset: "flash_black" },
  ],
} as const satisfies Record<string, readonly StyleStep[]>;

export type MotionTransitionStyle = keyof typeof MOTION_TRANSITION_STYLES;
export const MOTION_TRANSITION_STYLE_IDS = Object.keys(MOTION_TRANSITION_STYLES) as MotionTransitionStyle[];

/** The step for cut `index` (0-based) of a style. */
export function styleStep(style: MotionTransitionStyle, index: number): StyleStep {
  const steps: readonly StyleStep[] = MOTION_TRANSITION_STYLES[style];
  return steps[index % steps.length]!;
}
