/**
 * One look for a reel: the hype references sit every shot in one world
 * (night neon, or teal and orange), so a daylight tree shot does not cut
 * against a dark city under a "NIGHT RUN" label. build_reel_tool measures
 * each clip, picks the look here, corrects every clip toward the look's
 * target (unify_grade_tool's pass, catalog/color-unify.ts) and lays the
 * look's LUT over all of them.
 *
 * Pure: the measured LookProfiles (avg_luma, warm_cool, ...) come in, the
 * choice, the target and the clip order come out.
 */

import { NEUTRAL_BAND, bandScore, unifyTarget, type UnifyBand } from "../tools/color-unify.js";

type Json = Record<string, unknown>;

export const REEL_LOOK_IDS = ["night", "teal_orange"] as const;
export type ReelLookId = (typeof REEL_LOOK_IDS)[number];

export interface ReelLook {
  id: ReelLookId;
  /** The built-in LUT laid over every shot (list_looks_tool id). */
  lut: string;
  /** LUT strength: the style's own colour (boost_color) stays under it. */
  intensity: number;
  /** Where the correction target sits: night is darker and cooler than the neutral band. */
  band: UnifyBand;
}

export const REEL_LOOKS: Readonly<Record<ReelLookId, ReelLook>> = {
  // night_glow keeps neon and headlights bright and turns daylight greens to a cool blue dusk;
  // city_night_film crushes the dark shots to black (both tried on the trailer's 20 clips).
  night: {
    id: "night",
    lut: "night_glow",
    intensity: 0.85,
    band: { ...NEUTRAL_BAND, avg_luma: [0.2, 0.34], warm_cool: [-0.06, 0] },
  },
  teal_orange: { id: "teal_orange", lut: "teal_&_orange_cinema", intensity: 0.8, band: NEUTRAL_BAND },
};

/** Words in a hook, label or end card that set a reel at night. */
const NIGHT_WORDS = /\b(night\w*|dark\w*|neon|midnight|after hours|nocturn\w*|moon\w*|nightfall)\b/i;
/** Footage this dark on average (the clips' median luma) is a night reel whatever the titles say. */
const DARK_FOOTAGE_LUMA = 0.28;
/** A clip this bright on average is daylight footage. */
export const DAYLIGHT_LUMA = 0.4;

export function hasNightWords(texts: readonly (string | undefined)[]): boolean {
  return texts.some((t) => Boolean(t && NIGHT_WORDS.test(t)));
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function lumaOf(profile: Json): number | null {
  const v = Number(profile.avg_luma);
  return profile.present && Number.isFinite(v) ? v : null;
}

export function isDaylight(profile: Json): boolean {
  const luma = lumaOf(profile);
  return luma !== null && luma >= DAYLIGHT_LUMA;
}

export interface LookChoice {
  look: ReelLook;
  /** Why, in words, for the receipt. */
  why: string;
  /** The night look was chosen from the titles' words (the daylight check applies). */
  fromWords: boolean;
}

/** The reel's look: night when the titles say so or the footage is mostly dark, else teal and orange. */
export function chooseReelLook(texts: readonly (string | undefined)[], profiles: readonly Json[]): LookChoice {
  if (hasNightWords(texts)) return { look: REEL_LOOKS.night, why: "the titles set it at night", fromWords: true };
  const luma = median(profiles.map(lumaOf).filter((v): v is number => v !== null));
  if (luma !== null && luma < DARK_FOOTAGE_LUMA) {
    return { look: REEL_LOOKS.night, why: `the footage is mostly dark (median luma ${luma.toFixed(2)})`, fromWords: false };
  }
  return { look: REEL_LOOKS.teal_orange, why: luma === null ? "the default look" : `the footage is mostly lit (median luma ${luma.toFixed(2)})`, fromWords: false };
}

/** The correction target for a look: the clips' median clamped into the look's band. */
export function lookTarget(look: ReelLook, profiles: readonly Json[]): Json {
  return unifyTarget(profiles, look.band);
}

/**
 * Bin order with the clips that already fit the look first, so the hook and
 * each pass through the bin open on them; the best fit closes the reel (the
 * payoff is the last item). Unmeasured clips keep their place after the
 * measured ones. Nothing is dropped: the reel still uses every clip.
 */
export function orderByFit(ids: readonly string[], profiles: ReadonlyMap<string, Json>, target: Json): string[] {
  const score = (id: string) => {
    const p = profiles.get(id);
    return p?.present ? bandScore(p, target) : Infinity;
  };
  const ranked = ids.map((id, i) => ({ id, i, s: score(id) })).sort((a, b) => a.s - b.s || a.i - b.i);
  if (ranked.length < 3) return ranked.map((r) => r.id);
  const [best, ...rest] = ranked;
  return [...rest.map((r) => r.id), best!.id];
}

/** Share of the reel's screen time on daylight footage, 0..1. */
export function daylightShare(shots: readonly { fileId: string; start: number; end: number }[], profiles: ReadonlyMap<string, Json>): number {
  let total = 0;
  let day = 0;
  for (const s of shots) {
    const length = s.end - s.start;
    total += length;
    const p = profiles.get(s.fileId);
    if (p && isDaylight(p)) day += length;
  }
  return total > 0 ? day / total : 0;
}
