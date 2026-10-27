/**
 * Motion transitions a montage puts on its own cuts, so a montage tool's
 * edit is not hard cuts only (bench round 3: 22 of 28 gap lists said "hard
 * cuts", agents ran a transition tool in 14 % of runs). Pure, like
 * reels/accents.ts, which does the same for build_reel_tool.
 *
 * The rules follow the references and HeyGen HyperFrames' motion doctrine
 * (Apache-2.0, .claude/skills/motion-doctrine/SKILL.md): accents are
 * punctuation, one a bar half-way between the downbeats a montage already
 * flashes, never on neighbouring cuts; two or three presets repeat; pans keep one
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

/** Beats a bar: the rule adds one accent per bar between the ones a montage has (its flashed downbeats). */
const BAR_BEATS = 4;

/**
 * The genre rule's transitions on a montage's cuts: one a bar, half a bar
 * from the accents already there (downbeats, flashes, the landing on the
 * last cut), on the cut nearest that point within a beat (one on the beat
 * counts half a beat nearer), never on a cut next to another accent.
 */
export function planMontageTransitions(rule: MontageRule, cuts: readonly MontageCut[], beatSeconds: number, fps: number): PlannedMontageTransition[] {
  const def = MONTAGE_RULES[rule];
  const last = cuts.length - 1;
  const landing = cuts.length >= 3 ? last : -1;
  const fixed = cuts.flatMap((c, i) => (c.onDownbeat || c.flashed || i === landing ? [i] : []));
  // Stretches between fixed accents, the montage's first frame counting as one.
  const bounds = [{ time: 0, index: -1 }, ...fixed.map((i) => ({ time: cuts[i]!.time, index: i }))];
  const chosen = new Set<number>(fixed);
  const picks: number[] = [];
  for (let k = 0; k + 1 < bounds.length; k += 1) {
    const a = bounds[k]!;
    const b = bounds[k + 1]!;
    const beats = (b.time - a.time) / beatSeconds;
    if (beats < BAR_BEATS - 1e-6) continue;
    const n = Math.max(1, Math.round(beats / BAR_BEATS));
    for (let j = 0; j < n; j += 1) {
      const target = a.time + ((j + 0.5) * (b.time - a.time)) / n;
      // How far a cut is from the point, a cut on the beat counting half a beat nearer.
      const miss = (cut: MontageCut) => Math.abs(cut.time - target) - (cut.onBeat ? beatSeconds / 2 : 0);
      let best = -1;
      // The montage's first frame is no cut: the cut right after it may take an accent.
      for (let i = a.index < 0 ? 0 : a.index + 2; i <= b.index - 2; i += 1) {
        const cut = cuts[i]!;
        if (Math.abs(cut.time - target) > beatSeconds + 0.5 / fps || chosen.has(i - 1) || chosen.has(i + 1) || chosen.has(i)) continue;
        if (best < 0 || miss(cut) < miss(cuts[best]!)) best = i;
      }
      if (best >= 0) {
        chosen.add(best);
        picks.push(best);
      }
    }
  }
  picks.sort((x, y) => x - y);
  const out: PlannedMontageTransition[] = [];
  picks.forEach((i, n) => {
    const preset = def.pattern[n % def.pattern.length]!;
    const frames = fitMontageFrames(preset, cuts[i]!.outFrames, cuts[i]!.inFrames, fps);
    if (frames !== null) out.push({ cut: i, preset, frames });
  });
  if (landing >= 0) {
    const frames = fitMontageFrames(def.landing, cuts[landing]!.outFrames, cuts[landing]!.inFrames, fps);
    if (frames !== null) out.push({ cut: landing, preset: def.landing, frames });
  }
  return out;
}

/** One transition per grid re-cut (every kept tile moves together), in order. */
export function gridRecutPresets(choice: Exclude<GridTransitions, "none">, recuts: number): MotionTransitionId[] {
  const pattern: readonly MotionTransitionId[] = choice === "flash" ? ["flash_invert", "glitch"] : ["whip"];
  return Array.from({ length: recuts }, (_, i) => pattern[i % pattern.length]!);
}
