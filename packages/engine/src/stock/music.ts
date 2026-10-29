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

export const ENERGY_SHAPES = ["build", "drop", "steady", "fade"] as const;
export type EnergyShape = (typeof ENERGY_SHAPES)[number];

export interface EnergyCurve {
  /**
   * build: it grows (the last third at least BUILD_DB louder than the first);
   * drop: a sudden lift of DROP_DB or more that holds (a quiet intro, then the
   * beat comes in); fade: it falls away; steady: none of these.
   */
  shape: EnergyShape;
  /** Level of each eighth of the measured stretch, dBFS. */
  levels: number[];
  /** Where the drop lands, seconds into the track (shape drop). */
  dropSeconds?: number;
}

/** Louder by this much from the first third to the last is a build (or quieter, a fade). */
const BUILD_DB = 4;
/** A lift of this much between the 3 s before and after a moment is a drop. */
const DROP_DB = 6;
const DROP_WINDOW = 3;

const mean = (values: readonly number[]) => values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);
const median = (values: readonly number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

/**
 * The shape of a track's level over time, from its RMS level per second
 * (dBFS): so a search can pick the track whose energy does what the edit
 * does (a hype reel wants a drop it can put its climax on, a brand film a build).
 */
export function energyCurve(secondsDb: readonly number[]): EnergyCurve {
  const n = secondsDb.length;
  const levels = Array.from({ length: Math.min(8, n) }, (_, i) => {
    const part = secondsDb.slice(Math.floor((i * n) / Math.min(8, n)), Math.floor(((i + 1) * n) / Math.min(8, n)));
    return Math.round(mean(part) * 10) / 10;
  });
  if (n < 2 * DROP_WINDOW) return { shape: "steady", levels };
  let lift = -Infinity;
  let at = 0;
  for (let t = DROP_WINDOW; t + DROP_WINDOW <= n; t += 1) {
    const rise = mean(secondsDb.slice(t, t + DROP_WINDOW)) - mean(secondsDb.slice(t - DROP_WINDOW, t));
    if (rise > lift) [lift, at] = [rise, t];
  }
  // The lift holds: what follows mostly stays well above what came before (one loud hit is no drop).
  if (lift >= DROP_DB && median(secondsDb.slice(at)) - median(secondsDb.slice(0, at)) >= BUILD_DB) return { shape: "drop", levels, dropSeconds: at };
  const third = Math.max(1, Math.floor(n / 3));
  const change = mean(secondsDb.slice(n - third)) - mean(secondsDb.slice(0, third));
  return { shape: change >= BUILD_DB ? "build" : change <= -BUILD_DB ? "fade" : "steady", levels };
}

export interface MusicSearch {
  query: string;
  bpm_range?: [number, number];
  energy?: Energy;
  energy_curve?: EnergyShape;
  min_seconds: number;
}

/** A music-bed search asks for at least this long a track. */
const BED_MIN = 10;
const HIGH = /\b(hype|high|driving|intense|energetic|aggressive|hard|punchy|upbeat|fast)\b/i;
const LOW = /\b(calm|soft|gentle|ambient|chill|low|mellow|quiet|slow|warm)\b/i;
const CURVES: readonly [RegExp, EnergyShape][] = [
  [/\bdrops?\b/i, "drop"],
  [/\b(builds?|building|rising|rises|swell|swells|crescendo)\b/i, "build"],
  [/\b(fades?|fading|winds? down)\b/i, "fade"],
  [/\b(steady|constant|even|flat)\b/i, "steady"],
];
/** Words that say how the music moves, not what it is: kept out of the search text. */
const NOT_GENRE = /\b(energy|curve|tempo|the|a|an|and|with|at|on|where|lands?|then|into|of|to|in|drops?|builds?|building|rising|swells?|fades?|steady|bpm|beat|beats|bar|bars|climax|s|sec|seconds)\b/gi;

/**
 * search_freesound_music_tool arguments from a brief's music line ("dark
 * synthwave, 128 bpm, high energy, builds to a drop at 9 s"): the tempo, energy
 * and curve as filters so the previews are measured, the rest as the query.
 */
export function musicSearchFromText(text: string, seconds: number): MusicSearch {
  const typed = splitTempoFromQuery(text);
  const curve = CURVES.find(([re]) => re.test(text))?.[1];
  const energy: Energy | undefined = HIGH.test(text) ? "high" : LOW.test(text) ? "low" : undefined;
  // The genre leads a music line ("dark trap, 140 bpm, drop on the hook"): the first clause with words left in it.
  const clauses = typed.query.split(/[,;.:]/).map((part) =>
    part
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .replace(NOT_GENRE, " ")
      .replace(new RegExp(HIGH.source, "gi"), " ")
      .replace(new RegExp(LOW.source, "gi"), " ")
      .replace(/\b\d+(\.\d+)?\b/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5)
      .join(" "),
  );
  return {
    query: clauses.find(Boolean) ?? "music",
    ...(typed.range ? { bpm_range: [Math.round(typed.range[0]), Math.round(typed.range[1])] as [number, number] } : {}),
    ...(energy ? { energy } : {}),
    ...(curve ? { energy_curve: curve } : {}),
    min_seconds: Math.max(BED_MIN, Math.ceil(seconds)),
  };
}
