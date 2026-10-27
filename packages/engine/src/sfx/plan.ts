/**
 * The vocabulary of automatic sound design: intensities and densities, the
 * moments of an edit (sfx/moments.ts), one cue to place, and the music's
 * climax. The cue sheet is sfx/spot.ts, the design sfx/design.ts.
 */

import type { SfxParams } from "./render.js";

export const SFX_INTENSITIES = ["subtle", "normal", "hype"] as const;
export type SfxIntensity = (typeof SFX_INTENSITIES)[number];
export const SFX_DENSITIES = ["auto", "every_cut"] as const;
export type SfxDensity = (typeof SFX_DENSITIES)[number];

export type SoundMomentKind = "cut" | "transition" | "title" | "flash";

/** A moment of the edit that may get a sound. Times are timeline seconds. */
export interface SoundMoment {
  kind: SoundMomentKind;
  time: number;
  /** 0..1: how big the moment is (a downbeat cut to a new shot after a hold is near 1). */
  strength: number;
  /** Transitions: how long the move is. */
  duration?: number;
  /** Cuts: the shots either side, seconds. */
  before?: number;
  after?: number;
  /** Clip or transition ids it comes from. */
  ids?: string[];
}

/** One effect to place. `at` is where its hit point lands. */
export interface SfxCue {
  recipe: string;
  at: number;
  params: SfxParams;
  gainDb: number;
  /** Why it is there, in words (shown in the receipt). */
  reason: string;
}

/** Least picture after the climax for its impact to land, seconds. */
export const CLIMAX_TAIL = 0.25;

/** One analysed beat of the music bed on the timeline. */
export interface TimelineBeat {
  time: number;
  /** Loudness from this beat to the next, 0..1. */
  energy: number;
}

/**
 * The music's climax: the downbeat where the loudness jumps the most (the
 * drop), between 20 % and 90 % of the edit; null when nothing jumps.
 */
export function musicClimax(beats: readonly TimelineBeat[], downbeats: readonly number[], duration: number): number | null {
  if (beats.length < 8) return null;
  const mean = (from: number, to: number) => {
    const slice = beats.slice(Math.max(0, from), Math.max(0, to));
    return slice.length ? slice.reduce((s, b) => s + b.energy, 0) / slice.length : 0;
  };
  let best: { time: number; jump: number } | null = null;
  for (const time of downbeats) {
    if (time < duration * 0.2 || time > duration * 0.9) continue;
    const index = beats.findIndex((b) => b.time >= time - 0.03);
    if (index < 4) continue;
    const jump = mean(index, index + 4) - mean(index - 4, index);
    if (!best || jump > best.jump) best = { time, jump };
  }
  return best && best.jump >= 0.15 ? best.time : null;
}
