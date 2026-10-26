/**
 * Automatic sound design: which effect goes where, from the moments of an
 * edit (sfx/timeline.ts finds them). Pure, so every surface plans the same.
 *
 * Taste, distilled from the reference reels (cuts land on an audio
 * transient 50-100 % of the time, on the music's beat only 20-40 %):
 *   - every moment that matters gets a sound, but not every cut: density is
 *     capped by intensity, weak cuts are skipped first;
 *   - hits go on strong cuts (downbeats, a new shot after a hold, flashes),
 *     whooshes on the others, sized to the shots around the cut;
 *   - a riser builds into the climax and an impact lands on it;
 *   - no two transients closer than 80 ms; impacts are spaced further;
 *   - every cue has its own seed, pitch and pan so nothing machine-guns;
 *   - effects sit under the music (peaks around -8…-14 dBFS) and further
 *     under dialogue; clicks and textures stay out of speech entirely.
 */

import { Rng, clamp01 } from "./dsp.js";
import { sfxRecipe } from "./recipes.js";
import type { SfxParams } from "./render.js";

export const SFX_INTENSITIES = ["subtle", "normal", "hype"] as const;
export type SfxIntensity = (typeof SFX_INTENSITIES)[number];

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

export interface SoundDesignInput {
  moments: readonly SoundMoment[];
  /** Length of the edit, seconds. */
  duration: number;
  /** The climax (the drop, the reveal), seconds, or null for none. */
  climax: number | null;
  /** Whether a music bed plays under the edit. */
  music: boolean;
  /** Timeline windows where someone speaks. */
  speech: readonly (readonly [number, number])[];
  intensity: SfxIntensity;
  seed: number;
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

interface Density {
  /** Least time between two accepted moments of ordinary weight, seconds. */
  gap: number;
  /** Least time between two impacts. */
  hitGap: number;
  /** Cuts weaker than this get nothing. */
  cutFloor: number;
  /** Cuts at least this strong get an impact. */
  hitFloor: number;
  /** Synth intensity of the cues. */
  drive: number;
  /** Gain offset, dB. */
  gain: number;
  riser: number;
}

const DENSITY: Record<SfxIntensity, Density> = {
  subtle: { gap: 1.8, hitGap: 6, cutFloor: 0.7, hitFloor: 0.9, drive: 0.45, gain: -3, riser: 1.6 },
  normal: { gap: 0.9, hitGap: 3.5, cutFloor: 0.45, hitFloor: 0.78, drive: 0.65, gain: 0, riser: 2.4 },
  hype: { gap: 0.3, hitGap: 1.8, cutFloor: 0, hitFloor: 0.68, drive: 0.85, gain: 1, riser: 3 },
};

/** No two transients closer than this, seconds: they smear into one flam. */
export const MIN_TRANSIENT_GAP = 0.08;
/** Extra cut under speech, dB. */
const SPEECH_DUCK_DB = -6;
/** A moment at least this strong ignores the ordinary density gap (only the 80 ms rule holds). */
const MUST_PRIORITY = 1;

const KIND_BONUS: Record<SoundMomentKind, number> = { flash: 0.6, transition: 0.35, cut: 0, title: 0.05 };

function inSpeech(speech: SoundDesignInput["speech"], t: number): boolean {
  return speech.some(([a, b]) => t >= a - 0.05 && t <= b + 0.05);
}

/** Pick from `pool` at random, but never the same recipe three times running. */
function vary(pool: readonly string[], recent: string[], rng: Rng): string {
  const repeat = recent.length >= 2 && recent[recent.length - 1] === recent[recent.length - 2] ? recent[recent.length - 1] : undefined;
  const options = pool.filter((r) => r !== repeat);
  const pick = (options.length > 0 ? options : pool)[Math.floor(rng.next() * (options.length > 0 ? options : pool).length)]!;
  recent.push(pick);
  return pick;
}

/** Whoosh recipe and length for a move of `seconds`. */
function whooshFor(seconds: number, intensity: SfxIntensity, recent: string[], rng: Rng): { recipe: string; duration: number } {
  const duration = Math.min(Math.max(seconds, 0.2), 3);
  if (seconds < 0.3) return { recipe: vary(intensity === "hype" ? ["whip", "whip", "whoosh_short"] : ["whoosh_short", "whip"], recent, rng), duration };
  if (seconds < 0.6) return { recipe: vary(["whoosh_short", "whoosh_short", "swish_airy"], recent, rng), duration };
  if (seconds < 1.3) return { recipe: vary(["whoosh_medium", "whoosh_medium", "whoosh_rise"], recent, rng), duration };
  return { recipe: "whoosh_long", duration };
}

/** What planSoundDesign decided. */
export interface SoundDesignPlan {
  cues: SfxCue[];
  /** The climax an impact lands on (null when there is none or it is too early to land). */
  climax: number | null;
  /** Whether a riser builds into it. */
  riser: boolean;
}

/** Plan the cues for an edit. Deterministic for the same input. */
export function planSoundDesign(input: SoundDesignInput): SoundDesignPlan {
  const d = DENSITY[input.intensity];
  const rng = new Rng(Math.imul(input.seed | 0, 2654435761) ^ 0x5fd);
  const cues: SfxCue[] = [];
  const hits: number[] = [];
  const impacts: number[] = [];
  const free = (t: number) => hits.every((h) => Math.abs(h - t) >= MIN_TRANSIENT_GAP);

  // The climax first: everything else fits around it.
  let riserFrom = Infinity;
  let climax: number | null = null;
  if (input.climax !== null && input.climax > 0.5 && input.climax < input.duration + 0.01) {
    climax = input.climax;
    const at = input.climax;
    const length = Math.min(d.riser, at - 0.1);
    if (length >= 1) {
      const recipe = input.intensity === "subtle" ? "reverse_swell" : input.intensity === "hype" && !input.music ? "riser_tonal" : "riser_noise";
      cues.push({ recipe, at, params: { duration: length, intensity: d.drive, seed: rng.next() * 1e6, pan: 0.3 }, gainDb: 0, reason: `builds into the climax at ${at.toFixed(2)} s` });
      riserFrom = at - length;
    }
    cues.push({ recipe: "impact_boom", at, params: { intensity: d.drive, seed: rng.next() * 1e6, pitch: rng.range(-1, 0.5) }, gainDb: 0, reason: "lands the climax" });
    if (input.intensity === "hype") cues.push({ recipe: "sub_drop", at, params: { intensity: d.drive, seed: rng.next() * 1e6 }, gainDb: -3, reason: "sub under the climax" });
    hits.push(at);
    impacts.push(at);
  }

  // Then the other moments, strongest first.
  const ranked = input.moments
    .filter((m) => m.time >= 0 && m.time <= input.duration + 0.01)
    .map((m) => ({ m, priority: clamp01(m.strength) + KIND_BONUS[m.kind] }))
    .filter(({ m }) => m.kind !== "cut" || m.strength >= d.cutFloor)
    .sort((a, b) => b.priority - a.priority || a.m.time - b.m.time);
  const accepted: { m: SoundMoment; priority: number; impact: "hit" | "accent" | null }[] = [];
  const taken: number[] = [...hits];
  for (const entry of ranked) {
    const t = entry.m.time;
    if (!free(t)) continue;
    // Impacts go to the strongest moments first; a flash frame is a hit by nature and may come twice as close.
    const hitGap = entry.m.kind === "flash" ? d.hitGap / 2 : d.hitGap;
    const hitAllowed = impacts.every((x) => Math.abs(x - t) >= hitGap);
    const wantsHit = entry.m.kind === "flash" || (entry.m.kind === "cut" && entry.m.strength >= d.hitFloor);
    const impact = wantsHit && hitAllowed ? "hit" : entry.m.kind === "flash" ? "accent" : null;
    // The riser carries its stretch: only impacts land inside it (hype keeps everything).
    if (impact !== "hit" && t >= riserFrom && t < (climax ?? Infinity) && input.intensity !== "hype") continue;
    const speech = inSpeech(input.speech, t);
    // Clicks and pops under someone speaking compete with the words.
    if (speech && entry.m.kind === "title" && input.intensity !== "hype") continue;
    const gap = speech ? d.gap * 1.5 : d.gap;
    if (entry.priority < MUST_PRIORITY && taken.some((x) => Math.abs(x - t) < gap)) continue;
    accepted.push({ ...entry, impact });
    taken.push(t);
    hits.push(t);
    if (impact === "hit") impacts.push(t);
  }

  // Assign effects in time order, so the variation runs along the edit.
  accepted.sort((a, b) => a.m.time - b.m.time);
  let side = rng.next() < 0.5 ? -1 : 1;
  let titleTurn = 0;
  const recentWhooshes: string[] = [];
  const recentHits: string[] = [];
  for (const { m, priority, impact } of accepted) {
    const t = m.time;
    const seed = Math.floor(rng.next() * 1e6);
    const pitch = Math.round(rng.range(-1.5, 1.5) * 10) / 10;
    const brightness = Math.round(rng.range(0.4, 0.65) * 100) / 100;
    const base = { seed, pitch, brightness, intensity: d.drive };
    const duringRiser = t >= riserFrom && t < (climax ?? Infinity);
    if (impact === "accent") {
      // A flash too close to another hit still gets a bright accent, not a second boom.
      cues.push({ recipe: "whip", at: t, params: { ...base, pan: (side = -side) * 0.6 }, gainDb: 0, reason: "flash (accent: a hit just played)" });
      continue;
    }
    if (impact === "hit") {
      const lead = m.before ?? 0;
      const combo = input.intensity !== "subtle" && m.kind === "cut" && lead >= 1 && priority >= 0.9 && !duringRiser;
      const recipe = combo ? "swoosh_hit" : input.intensity === "subtle" ? "impact_thud" : vary(["impact_punch", "impact_punch", "impact_thud"], recentHits, rng);
      cues.push({ recipe, at: t, params: { ...base, pitch: Math.min(pitch, 0.5), pan: combo ? (side = -side) * 0.5 : 0 }, gainDb: 0, reason: m.kind === "flash" ? "flash frame" : "strong cut" });
      continue;
    }
    if (m.kind === "title") {
      const recipe = (["swish_airy", "ui_tap", "pop"] as const)[titleTurn % 3]!;
      titleTurn += 1;
      cues.push({ recipe, at: t, params: { ...base, pan: rng.range(-0.25, 0.25) }, gainDb: 0, reason: "title entrance" });
      continue;
    }
    // Cuts and transitions: a whoosh peaking on the moment, as long as the move.
    const move = m.kind === "transition" ? (m.duration ?? 0.5) * 1.4 : Math.min(m.before ?? 0.6, m.after ?? 0.6) * 0.8;
    const { recipe, duration } = whooshFor(Math.min(move, m.kind === "transition" ? 3 : 1.1), input.intensity, recentWhooshes, rng);
    side = -side;
    cues.push({ recipe, at: t, params: { ...base, duration, pan: side * rng.range(0.45, 0.8) }, gainDb: 0, reason: m.kind === "transition" ? "transition" : "cut" });
  }

  for (const cue of cues) {
    const recipe = sfxRecipe(cue.recipe)!;
    const speech = inSpeech(input.speech, cue.at) ? SPEECH_DUCK_DB : 0;
    cue.gainDb = Math.round((recipe.mixDb + d.gain + cue.gainDb + speech) * 10) / 10;
    if (cue.params.seed !== undefined) cue.params.seed = Math.floor(cue.params.seed);
  }
  cues.sort((a, b) => a.at - b.at || a.recipe.localeCompare(b.recipe));
  return { cues, climax, riser: Number.isFinite(riserFrom) };
}

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
