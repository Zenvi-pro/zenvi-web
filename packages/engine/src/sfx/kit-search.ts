/**
 * Finding sounds in the recorded kit (sfx/recorded.ts) the way a sound
 * designer asks for them: a category, then darker or brighter, shorter or
 * longer, softer or harder, from the measured numbers every kit sound
 * carries. Brightness, length and energy are thirds of each category (a
 * bright boom is still darker than a dark click), so every category answers
 * all three. Picks follow the variety rules (CRAFT §8, DEPLOY S5.4): never
 * the sound placed just before or after, no sound more than three times in
 * 30 s, the least used first; and each placement varies by up to ±1
 * semitone and ±1.5 dB so a repeat is never identical. Pure.
 */

import { Rng } from "./dsp.js";
import { RECORDED_KIT } from "./recorded-kit.data.js";
import type { RecordedGroup, RecordedSample } from "./recorded.js";

export const KIT_BRIGHTNESS = ["dark", "mid", "bright"] as const;
export type KitBrightness = (typeof KIT_BRIGHTNESS)[number];
export const KIT_LENGTHS = ["short", "medium", "long"] as const;
export type KitLength = (typeof KIT_LENGTHS)[number];
export const KIT_ENERGIES = ["soft", "medium", "hard"] as const;
export type KitEnergy = (typeof KIT_ENERGIES)[number];

/** Most uses of one sound inside any 30 s (DEPLOY S5.4 / METRICS V1). */
export const MAX_USES_PER_WINDOW = 3;
export const VARIETY_WINDOW_SECONDS = 30;

/** Seconds of sound, onset to end (the silence around it is trimmed when it is placed). */
export function soundSeconds(s: RecordedSample): number {
  return Math.max(0.001, (s.endMs - s.onsetMs) / 1000);
}

/** How hard a sound hits, 0..1: a fast attack and a high crest read as hard, a slow swell as soft. */
export function energyOf(s: RecordedSample): number {
  const attack = 1 - Math.min(1, Math.log10(1 + s.attackMs) / Math.log10(1 + 300));
  const crest = Math.min(1, Math.max(0, (s.crestDb - 6) / 18));
  return 0.6 * attack + 0.4 * crest;
}

export interface KitTraits {
  brightness: KitBrightness;
  length: KitLength;
  energy: KitEnergy;
}

/** The two values that split `values` into thirds. */
function tertiles(values: number[]): [number, number] {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return [at(1 / 3), at(2 / 3)];
}

const traitCache = new WeakMap<readonly RecordedSample[], Map<number, KitTraits>>();

/** Every kit sound's thirds, within its own category. */
function traitsOfKit(kit: readonly RecordedSample[]): Map<number, KitTraits> {
  const cached = traitCache.get(kit);
  if (cached) return cached;
  const out = new Map<number, KitTraits>();
  const groups = new Map<RecordedGroup, RecordedSample[]>();
  for (const s of kit) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
  for (const members of groups.values()) {
    const bright = tertiles(members.map((s) => s.centroidHz));
    const long = tertiles(members.map(soundSeconds));
    const hard = tertiles(members.map(energyOf));
    const third = <T>(v: number, [a, b]: [number, number], names: readonly [T, T, T]): T => (v < a ? names[0] : v < b ? names[1] : names[2]);
    for (const s of members) {
      out.set(s.id, {
        brightness: third(s.centroidHz, bright, KIT_BRIGHTNESS),
        length: third(soundSeconds(s), long, KIT_LENGTHS),
        energy: third(energyOf(s), hard, KIT_ENERGIES),
      });
    }
  }
  traitCache.set(kit, out);
  return out;
}

export function kitTraits(s: RecordedSample, kit: readonly RecordedSample[] = RECORDED_KIT): KitTraits {
  return traitsOfKit(kit).get(s.id) ?? { brightness: "mid", length: "medium", energy: "medium" };
}

export interface KitQuery {
  group?: RecordedGroup;
  /** Words matched against the name and tags (any word counts; more matches rank higher). */
  text?: string;
  brightness?: KitBrightness;
  length?: KitLength;
  energy?: KitEnergy;
  /** true: real stereo only; false: mono only. */
  stereo?: boolean;
  minSeconds?: number;
  maxSeconds?: number;
}

export interface KitMatch {
  sample: RecordedSample;
  traits: KitTraits;
  /** Words of the query found in its name or tags. */
  matched: number;
}

const words = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

/**
 * Kit sounds that fit `query`, best first: the most query words matched,
 * then the traits asked for, then a stable order. A trait asked for is a
 * filter; when it leaves nothing, the nearest third is taken instead (a
 * "bright" boom when no boom is bright), so a category always answers.
 */
export function searchKit(query: KitQuery, kit: readonly RecordedSample[] = RECORDED_KIT): KitMatch[] {
  const want = query.text ? words(query.text) : [];
  const traits = traitsOfKit(kit);
  let pool = kit
    .filter((s) => !query.group || s.group === query.group)
    .filter((s) => query.stereo === undefined || s.stereo === query.stereo)
    .filter((s) => (query.minSeconds === undefined || soundSeconds(s) >= query.minSeconds) && (query.maxSeconds === undefined || soundSeconds(s) <= query.maxSeconds))
    .map((sample) => {
      const haystack = new Set([...words(sample.name), ...sample.tags.flatMap(words)]);
      return { sample, traits: traits.get(sample.id)!, matched: want.filter((w) => haystack.has(w) || haystack.has(w.replace(/s$/, ""))).length };
    });
  if (want.length > 0 && !query.group) pool = pool.filter((m) => m.matched > 0);
  const distance = (m: KitMatch): number => {
    let d = 0;
    if (query.brightness) d += Math.abs(KIT_BRIGHTNESS.indexOf(m.traits.brightness) - KIT_BRIGHTNESS.indexOf(query.brightness));
    if (query.length) d += Math.abs(KIT_LENGTHS.indexOf(m.traits.length) - KIT_LENGTHS.indexOf(query.length));
    if (query.energy) d += Math.abs(KIT_ENERGIES.indexOf(m.traits.energy) - KIT_ENERGIES.indexOf(query.energy));
    return d;
  };
  const best = pool.reduce((min, m) => Math.min(min, distance(m)), Number.POSITIVE_INFINITY);
  return pool.filter((m) => distance(m) === best).sort((a, b) => b.matched - a.matched || a.sample.id - b.sample.id);
}

/** A kit sound already on the timeline. */
export interface KitUse {
  id: number;
  /** Timeline seconds. */
  at: number;
}

/**
 * The sound to place at `at` from `candidates` (in the caller's order of
 * preference, e.g. searchKit's or a seeded rotation): never the kit sound
 * placed right before or right after `at`, never one used three times
 * within 30 s of it, the least used of the rest first. Falls back to the
 * least used neighbour-free one, then to the first, so a pool of one still
 * plays.
 */
export function pickVaried(candidates: readonly RecordedSample[], used: readonly KitUse[], at: number): RecordedSample | undefined {
  if (candidates.length === 0) return undefined;
  const before = used.filter((u) => u.at <= at).sort((a, b) => b.at - a.at)[0];
  const after = used.filter((u) => u.at > at).sort((a, b) => a.at - b.at)[0];
  const neighbours = new Set([before?.id, after?.id].filter((id): id is number => id !== undefined));
  const near = (id: number) => used.filter((u) => u.id === id && Math.abs(u.at - at) < VARIETY_WINDOW_SECONDS).length;
  const total = (id: number) => used.filter((u) => u.id === id).length;
  const rank = (pool: readonly RecordedSample[]) => pool.map((s, i) => ({ s, i })).sort((a, b) => total(a.s.id) - total(b.s.id) || a.i - b.i)[0]?.s;
  const fresh = candidates.filter((s) => !neighbours.has(s.id));
  return rank(fresh.filter((s) => near(s.id) < MAX_USES_PER_WINDOW)) ?? rank(fresh) ?? candidates[0];
}

export interface KitVariation {
  /** Pitch, semitones (−1..1): played faster or slower, as a sampler does. */
  semitones: number;
  /** Level, dB (−1.5..1.5). */
  gainDb: number;
}

/** The variation of the `use`-th placement of sound `id` (the first plays as recorded). */
export function kitVariation(id: number, use: number, seed: number): KitVariation {
  if (use <= 0) return { semitones: 0, gainDb: 0 };
  const rng = new Rng((Math.imul(id, 2654435761) ^ Math.imul(use, 0x9e3779b9) ^ seed) >>> 0 || 1);
  // Quantised so a repeat's file is reused: quarter semitones, half decibels.
  const semitones = Math.round((rng.next() * 2 - 1) * 4) / 4;
  const gainDb = Math.round((rng.next() * 3 - 1.5) * 2) / 2;
  return { semitones: semitones === 0 ? 0.25 : semitones, gainDb };
}
