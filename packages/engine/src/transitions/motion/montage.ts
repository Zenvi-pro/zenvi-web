/**
 * Motion transitions a montage puts on its own cuts, so a montage tool's
 * edit is not hard cuts only (bench round 3: 22 of 28 gap lists said "hard
 * cuts", agents ran a transition tool in 14 % of runs). Pure, like
 * reels/accents.ts, which does the same for build_reel_tool.
 *
 * The rules follow the references and HeyGen HyperFrames' motion doctrine
 * (Apache-2.0, .claude/skills/motion-doctrine/SKILL.md): accents are
 * punctuation, one per bar between the downbeats a montage already flashes,
 * never on consecutive cuts; two or three presets repeat; pans keep one
 * direction for the whole sequence (`direction: "auto"` when applied); the
 * reserved vector (a zoom-through, deeper into the same thought) is spent
 * once, on the last cut. Match cuts stay hard between the accents: the
 * aligned subject is the transition.
 */

import { defaultFrames, type MotionTransitionId } from "./presets.js";

/** `auto`: the tool's genre rule; `none`: hard cuts only. */
export const MONTAGE_TRANSITIONS = ["auto", "none", "punch", "flash", "whip"] as const;
export type MontageTransitions = (typeof MONTAGE_TRANSITIONS)[number];
export type MontageRule = Exclude<MontageTransitions, "auto" | "none">;

/** Grids re-cut every tile at once: moves that only translate or recolour them (a scale would grow each tile over its neighbours). */
export const GRID_TRANSITIONS = ["auto", "none", "whip", "flash"] as const;
export type GridTransitions = (typeof GRID_TRANSITIONS)[number];

interface RuleDef {
  /** Repeated accent by accent. */
  pattern: readonly MotionTransitionId[];
  /** The last cut (into the closing hold). */
  landing: MotionTransitionId;
}

export const MONTAGE_RULES: Readonly<Record<MontageRule, RuleDef>> = {
  /** Match-cut chains: a crash zoom about the aligned subject, then a glitch; the end flies into the subject. */
  punch: { pattern: ["zoom_in", "glitch"], landing: "zoom_through" },
  /** Flash montages (Dc_2Y1qI0ZH): inverted frames and glitches between the white flashes, a punch now and then. */
  flash: { pattern: ["flash_invert", "glitch", "zoom_in"], landing: "zoom_through" },
  /** Hype: whips in one direction, landing on a pull-back. */
  whip: { pattern: ["whip"], landing: "zoom_out" },
};

export interface MontageCut {
  /** Timeline seconds. */
  time: number;
  onDownbeat: boolean;
  onBeat: boolean;
  /** The montage already flashes white here. */
  flashed: boolean;
  /** Frames of the shots before and after the cut. */
  outFrames: number;
  inFrames: number;
}

export interface PlannedMontageTransition {
  /** Index into the cuts. */
  cut: number;
  preset: MotionTransitionId;
  /** Moving frames, at most what leaves both shots a rest frame. */
  frames: number;
}

/** Shortest a shot may be, frames, for a transition to take frames of it (a moving frame and a rest frame). */
const MIN_FRAMES = 2;

/** `preset`'s default length at `fps`, shortened so each shot keeps a rest frame; null when a shot is too short. */
export function fitMontageFrames(preset: MotionTransitionId, outFrames: number, inFrames: number, fps: number): number | null {
  const room = Math.min(outFrames, inFrames);
  if (room < MIN_FRAMES) return null;
  const fit = Math.min(defaultFrames(preset, fps), 2 * (room - 1));
  return fit >= 2 ? fit : null;
}

/**
 * The genre rule's transitions on a montage's cuts. `beatSeconds` spaces
 * the accents: two beats at least from any other accent (a downbeat, a
 * flash, the landing), before or after.
 */
export function planMontageTransitions(rule: MontageRule, cuts: readonly MontageCut[], beatSeconds: number, fps: number): PlannedMontageTransition[] {
  const def = MONTAGE_RULES[rule];
  const last = cuts.length - 1;
  const spacing = 2 * beatSeconds - 0.5 / fps;
  const landing = cuts.length >= 3 ? last : -1;
  const accented = (i: number) => cuts[i]!.onDownbeat || cuts[i]!.flashed || i === landing;
  // The next accent the rule does not choose, from each cut on.
  const next: number[] = new Array<number>(cuts.length).fill(Infinity);
  for (let i = last - 1; i >= 0; i -= 1) next[i] = accented(i + 1) ? cuts[i + 1]!.time : next[i + 1]!;
  const out: PlannedMontageTransition[] = [];
  let previous = -Infinity;
  let n = 0;
  cuts.forEach((cut, i) => {
    let preset: MotionTransitionId | null = null;
    if (i === landing) preset = def.landing;
    else if (accented(i)) previous = cut.time;
    else if (cut.onBeat && cut.time - previous >= spacing && next[i]! - cut.time >= spacing) preset = def.pattern[n++ % def.pattern.length]!;
    if (!preset) return;
    const frames = fitMontageFrames(preset, cut.outFrames, cut.inFrames, fps);
    if (frames === null) return;
    out.push({ cut: i, preset, frames });
    previous = cut.time;
  });
  return out;
}

/** One transition per grid re-cut (every kept tile moves together), in order. */
export function gridRecutPresets(choice: Exclude<GridTransitions, "none">, recuts: number): MotionTransitionId[] {
  const pattern: readonly MotionTransitionId[] = choice === "flash" ? ["flash_invert", "glitch"] : ["whip"];
  return Array.from({ length: recuts }, (_, i) => pattern[i % pattern.length]!);
}
