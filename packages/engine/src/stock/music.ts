/**
 * Picking stock music by tempo and energy. Freesound's text search matches
 * words, not tempo: "synthwave 128 bpm" finds pages that mention a number, not
 * tracks at 128. So the tempo leaves the query (`splitTempoFromQuery`), the
 * search finds candidates by mood and genre, and each candidate's preview is
 * measured (analysis/beats.ts) and kept when its tempo, or its half/double-time
 * reading, is in the wanted range.
 */

import type { TempoAlternative } from "../analysis/beats.js";

export interface TempoQuery {
  /** The query without the tempo words. */
  query: string;
  /** The tempo range the query asked for (a single number becomes a range around it). */
  range?: [number, number];
}

const BPM_MIN = 40;
const BPM_MAX = 300;
const inBounds = (v: number) => v >= BPM_MIN && v <= BPM_MAX;

/** [bpm - tolerance, bpm + tolerance]: detection is good to about a percent, loops are labelled to the unit. */
export function rangeAround(bpm: number): [number, number] {
  const tolerance = Math.max(3, bpm * 0.05);
  return [Math.max(BPM_MIN, bpm - tolerance), bpm + tolerance];
}

/** Take "120 bpm", "120-140 BPM", "bpm 128", "tempo: 90" out of a search text and say what tempo they asked for. */
export function splitTempoFromQuery(text: string): TempoQuery {
  let query = text;
  let range: [number, number] | undefined;
  const take = (pattern: RegExp, read: (m: RegExpExecArray) => [number, number] | undefined) => {
    const m = pattern.exec(query);
    if (!m) return;
    const found = read(m);
    if (!found) return;
    range ??= found;
    query = query.replace(m[0], " ");
  };
  const num = "(\\d{2,3}(?:\\.\\d+)?)";
  take(new RegExp(`\\b${num}\\s*(?:-|–|to)\\s*${num}\\s*bpm\\b`, "i"), (m) => {
    const [lo, hi] = [Number(m[1]), Number(m[2])];
    return inBounds(lo) && inBounds(hi) && lo <= hi ? [lo, hi] : undefined;
  });
  take(new RegExp(`(?:~|\\b(?:about|around|at)\\s+)?\\b${num}\\s*bpm\\b`, "i"), (m) => (inBounds(Number(m[1])) ? rangeAround(Number(m[1])) : undefined));
  take(new RegExp(`\\b(?:bpm|tempo)\\s*[:=]?\\s*${num}\\b`, "i"), (m) => (inBounds(Number(m[1])) ? rangeAround(Number(m[1])) : undefined));
  const cleaned = query
    .replace(/\bbpm\b/gi, " ")
    .split(",")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(", ");
  return { query: cleaned || "music", ...(range ? { range } : {}) };
}

/**
 * A range from the tool's `bpm_range` argument: [lo, hi], or a string with
 * two tempos in it: "lo-hi", "[lo, hi]", "lo to hi bpm", or one of those
 * quoted again by an agent that serialised it twice ('"130-150"').
 */
export function parseTempoRange(value: readonly number[] | string): [number, number] | null {
  const pair = typeof value === "string" ? (value.match(/\d+(?:\.\d+)?/g) ?? []).map(Number) : value;
  const [lo, hi] = pair;
  if (pair.length !== 2 || !(Number.isFinite(lo) && Number.isFinite(hi) && lo! >= BPM_MIN && hi! <= BPM_MAX && hi! >= BPM_MIN && lo! <= BPM_MAX)) return null;
  return lo! <= hi! ? [lo!, hi!] : [hi!, lo!];
}

export type TempoMatch = "exact" | "double-time" | "half-time";

/**
 * Whether a measured track suits the wanted range: its tempo is in it, or its
 * half or double reading is (a track that is 80 with a strong 160 pulse suits
 * a 160 edit). Null when neither.
 */
export function matchTempo(measured: { bpm: number; alternatives: readonly TempoAlternative[] }, range: readonly [number, number]): TempoMatch | null {
  const [lo, hi] = range;
  const inside = (v: number) => v >= lo && v <= hi;
  if (inside(measured.bpm)) return "exact";
  const other = measured.alternatives.filter((a) => a.support >= 0.6 && inside(a.bpm)).sort((a, b) => b.support - a.support)[0];
  if (!other) return null;
  return other.bpm > measured.bpm ? "double-time" : "half-time";
}

/** Distance of a measured tempo from a wanted range, in BPM (0 inside it, the closest octave reading counts). */
export function tempoDistance(measured: { bpm: number; alternatives: readonly TempoAlternative[] }, range: readonly [number, number]): number {
  const [lo, hi] = range;
  const away = (v: number) => (v < lo ? lo - v : v > hi ? v - hi : 0);
  return Math.min(away(measured.bpm), ...measured.alternatives.filter((a) => a.support >= 0.6).map((a) => away(a.bpm)));
}

export type Energy = "low" | "medium" | "high";

/**
 * How driving a track is, from its level and how hard its beats hit:
 * `loudnessDb` is RMS dBFS (quiet pads sit below -25, a mastered club track
 * around -10), `beatStrength` the mean onset strength on the beats (0..1).
 */
export function classifyEnergy(loudnessDb: number, beatStrength: number): Energy {
  const level = Math.max(0, Math.min(1, (loudnessDb + 30) / 20));
  const hit = Math.max(0, Math.min(1, beatStrength / 0.5));
  const score = 0.65 * level + 0.35 * hit;
  return score < 0.4 ? "low" : score < 0.65 ? "medium" : "high";
}
