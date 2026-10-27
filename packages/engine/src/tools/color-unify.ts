/**
 * Grade continuity for unify_grade_tool: the target every clip is corrected
 * toward, the band a clip must sit in to count as matching it, and how far
 * apart the clips are before and after.
 *
 * The numbers are LookProfiles (color-agent.ts `buildLookProfile`): medians
 * over frames spread across a clip, so one flash frame cannot move them.
 * Without a reference the target is the clips' own median look, pulled into
 * a neutral band, so a cut of bright daylight and near-black forest meets in
 * the middle instead of following whichever shot came first.
 */

import { assessGradeOutcome } from "./color-agent.js";
import { roundTo } from "./color-stats.js";

type Json = Record<string, unknown>;

/**
 * The profile keys continuity is judged on: exposure, white balance and
 * contrast. Saturation is reported but not matched: the profile's
 * `sat_proxy` measures the average colour's cast, which white balance
 * already corrects; how vivid the cut is belongs to the shared look.
 */
export const UNIFY_KEYS = ["avg_luma", "warm_cool", "green_magenta", "contrast_span"] as const;
export type UnifyKey = (typeof UNIFY_KEYS)[number];

/**
 * How far from the target a clip may sit and still read as the same scene
 * on a cut. Wider than match_color's LOOK_DISTANCE_MATCHED: shots keep some
 * of their own character; only jumps a viewer notices are corrected.
 */
export const UNIFY_TOLERANCE: Readonly<Record<UnifyKey, number>> = {
  avg_luma: 0.04,
  warm_cool: 0.025,
  green_magenta: 0.02,
  contrast_span: 0.06,
};

/**
 * The band an automatic target is pulled into: mid exposure, near-neutral
 * white balance, moderate saturation and contrast, so the shared look (a LUT)
 * has a clean plate to work on.
 */
export const NEUTRAL_BAND: Readonly<Record<UnifyKey, readonly [number, number]>> = {
  avg_luma: [0.32, 0.58],
  warm_cool: [-0.04, 0.06],
  green_magenta: [-0.02, 0.02],
  contrast_span: [0.3, 0.62],
};

/** The ColorGrade knobs unify sets, as absolute values. */
export interface UnifyKnobs {
  exposure: number;
  contrast: number;
  temperature: number;
  tint: number;
}

/** Largest change one pass makes to each knob: a wrong measurement cannot swing the picture. */
const KNOB_STEP: Readonly<UnifyKnobs> = { exposure: 1, contrast: 0.3, temperature: 0.45, tint: 0.35 };
/**
 * Where unify leaves each knob, inside ColorGrade's own ranges. Exposure
 * stops at ±1.5: a night shot lifted further turns to noise and stops being
 * night; it comes closer, it does not become day.
 */
const KNOB_RANGE: Readonly<Record<keyof UnifyKnobs, readonly [number, number]>> = {
  exposure: [-1.5, 1.5],
  contrast: [-0.6, 0.8],
  temperature: [-0.8, 0.8],
  tint: [-0.6, 0.6],
};

const clampTo = (lo: number, hi: number, x: number): number => Math.max(lo, Math.min(hi, x));

/**
 * The knobs that move a clip from `current` onto `target`, from ColorGrade's
 * own pixel math (render/kernels/color-grade.ts, libopenshot
 * src/effects/ColorGrade.cpp:311-324): white balance adds ±0.125 ×
 * temperature to red/blue and tint moves green by 0.1 against red/blue's
 * 0.05, then exposure multiplies by a gain G = 2^stops and contrast scales
 * around mid grey by C = 1 + contrast. So with the plate's mean m and span s
 * (the clip without this grade), the graded mean is (m·G − ½)·C + ½ and the
 * span s·G·C; a cast is scaled by G·C. The plate is backed out of `current`
 * and the grade it already has, G·C comes from the span, C from the mean,
 * and the casts from both. Clipping makes every response weaker than this,
 * which the next measured pass corrects; `damping` (0-1) takes part of each
 * step. When exposure hits its range, the mean wins over the span.
 */
export function solveUnifyKnobs(current: Json, target: Json, knobs: UnifyKnobs, damping = 0.85): UnifyKnobs {
  const next: UnifyKnobs = { ...knobs };
  const stat = (p: Json, key: UnifyKey): number | null => finite(p[key]);
  const step = (key: keyof UnifyKnobs, value: number): void => {
    const delta = clampTo(-KNOB_STEP[key], KNOB_STEP[key], (value - knobs[key]) * damping);
    const [lo, hi] = KNOB_RANGE[key];
    next[key] = roundTo(clampTo(lo, hi, knobs[key] + delta), 4);
  };
  const g0 = 2 ** knobs.exposure;
  const c0 = Math.max(0.05, 1 + knobs.contrast);
  const luma = stat(current, "avg_luma");
  const lumaGoal = stat(target, "avg_luma");
  const span = stat(current, "contrast_span");
  const spanGoal = stat(target, "contrast_span");
  const mean = luma === null ? null : ((luma - 0.5) / c0 + 0.5) / g0;
  if (luma !== null && lumaGoal !== null && mean !== null && mean > 1e-4 && Math.abs(lumaGoal - luma) > UNIFY_TOLERANCE.avg_luma / 2) {
    let gain: number;
    let factor = c0;
    if (span !== null && spanGoal !== null && span > 1e-3) {
      const product = (spanGoal / span) * g0 * c0;
      factor = clampTo(0.5, 1.8, 2 * (mean * product + 0.5 - lumaGoal));
      gain = product / factor;
    } else {
      gain = ((lumaGoal - 0.5) / c0 + 0.5) / mean;
    }
    const limited = clampTo(2 ** KNOB_RANGE.exposure[0], 2 ** KNOB_RANGE.exposure[1], gain);
    if (limited !== gain) {
      // At the exposure limit the mean wins: the contrast that lands it (a flatter curve lifts a dark
      // plate), no flatter than 0.7 so the blacks do not turn milky.
      gain = limited;
      const off = mean * gain - 0.5;
      const forMean = Math.abs(off) > 1e-3 ? (lumaGoal - 0.5) / off : 0;
      factor = forMean > 0 ? clampTo(0.7, 1.4, forMean) : c0;
    }
    step("exposure", Math.log2(gain));
    step("contrast", factor - 1);
  } else if (span !== null && spanGoal !== null && span > 1e-3 && Math.abs(spanGoal - span) > UNIFY_TOLERANCE.contrast_span / 2) {
    step("contrast", c0 * (spanGoal / span) - 1);
  }
  // A cast added before the gain and contrast is scaled by both.
  const before = g0 * c0;
  const after = Math.max(0.25, 2 ** next.exposure * (1 + next.contrast));
  const warm = stat(current, "warm_cool");
  const warmGoal = stat(target, "warm_cool");
  if (warm !== null && warmGoal !== null && Math.abs(warmGoal - warm * (after / before)) > UNIFY_TOLERANCE.warm_cool / 2) {
    step("temperature", (warmGoal / after - (warm / before - 0.25 * knobs.temperature)) / 0.25);
  }
  const gm = stat(current, "green_magenta");
  const gmGoal = stat(target, "green_magenta");
  if (gm !== null && gmGoal !== null && Math.abs(gmGoal - gm * (after / before)) > UNIFY_TOLERANCE.green_magenta / 2) {
    step("tint", (gm / before + 0.15 * knobs.tint - gmGoal / after) / 0.15);
  }
  return next;
}

/** Stats carried over to a receipt besides the continuity keys. */
const REPORT_KEYS = [...UNIFY_KEYS, "sat_proxy", "clipped_highlights", "clipped_shadows"] as const;

function finite(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function median(values: readonly number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A profile's continuity stats for a receipt (null where it was not measured). */
export function unifyStats(profile: Json): Json {
  const out: Json = {};
  for (const key of REPORT_KEYS) {
    const v = finite(profile[key]);
    out[key] = v === null ? null : roundTo(v, 4);
  }
  return out;
}

/**
 * The automatic target: each key's median over the clips, clamped into
 * NEUTRAL_BAND. A profile-shaped object, so it stands where a measured
 * reference would.
 */
export function unifyTarget(profiles: readonly Json[]): Json {
  const present = profiles.filter((p) => p.present);
  const target: Json = { present: present.length > 0, samples: 0 };
  for (const key of UNIFY_KEYS) {
    const m = median(present.map((p) => finite(p[key])).filter((v): v is number => v !== null));
    if (m === null) continue;
    const [lo, hi] = NEUTRAL_BAND[key];
    target[key] = roundTo(Math.max(lo, Math.min(hi, m)), 4);
  }
  for (const key of ["clipped_highlights", "clipped_shadows"]) {
    // Clipping is never a goal: the target keeps the least clipped half.
    const m = median(present.map((p) => finite(p[key])).filter((v): v is number => v !== null));
    if (m !== null) target[key] = roundTo(Math.min(m, 0.02), 4);
  }
  return target;
}

/** Target minus profile for each continuity key (what the correction must still move). */
export function unifyGap(profile: Json, target: Json): Partial<Record<UnifyKey, number>> {
  const gap: Partial<Record<UnifyKey, number>> = {};
  for (const key of UNIFY_KEYS) {
    const a = finite(profile[key]);
    const b = finite(target[key]);
    if (a !== null && b !== null) gap[key] = roundTo(b - a, 4);
  }
  return gap;
}

/** The continuity keys where the profile sits outside the target's tolerance. */
export function outOfBand(profile: Json, target: Json): UnifyKey[] {
  const gap = unifyGap(profile, target);
  return UNIFY_KEYS.filter((key) => gap[key] !== undefined && Math.abs(gap[key]!) > UNIFY_TOLERANCE[key] + 1e-9);
}

/** Max minus min of each continuity key across the clips: how far apart the cut's shots are. */
export function gradeSpread(profiles: readonly Json[]): Partial<Record<UnifyKey, number>> {
  const spread: Partial<Record<UnifyKey, number>> = {};
  for (const key of UNIFY_KEYS) {
    const values = profiles
      .filter((p) => p.present)
      .map((p) => finite(p[key]))
      .filter((v): v is number => v !== null);
    if (values.length > 0) spread[key] = roundTo(Math.max(...values) - Math.min(...values), 4);
  }
  return spread;
}

/**
 * Whether a correction pass clips the picture, by match_color's rules
 * (`assessGradeOutcome`). Its highlight rule is also absolute (any pass ending
 * at or above its limit), so on a shot that already clips that much a pass
 * clipping less would be dropped too: here only a rise in highlights counts.
 */
export function passClips(current: Json, measured: Json, goal: Json): boolean {
  const reasons = assessGradeOutcome(current, measured, goal, false).reasons as string[];
  const highlights = (p: Json): number => finite(p.clipped_highlights) ?? 0;
  return reasons.some((r) => r === "clipped_shadows_spike" || (r === "clipped_highlights_spike" && highlights(measured) > highlights(current)));
}

/** How far a profile is from the target, in tolerances (squared, summed over the continuity keys); 0 = on target. */
export function bandScore(profile: Json, target: Json): number {
  const gap = unifyGap(profile, target);
  return UNIFY_KEYS.reduce((sum, key) => sum + (gap[key] === undefined ? 0 : (gap[key]! / UNIFY_TOLERANCE[key]) ** 2), 0);
}

/** The index of the profile closest to the target, or -1 when none was measured. */
export function closestToTarget(profiles: readonly Json[], target: Json): number {
  let best = -1;
  let bestScore = Infinity;
  profiles.forEach((profile, i) => {
    if (!profile.present) return;
    const score = bandScore(profile, target);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
