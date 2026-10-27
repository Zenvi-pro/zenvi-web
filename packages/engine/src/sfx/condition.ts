/**
 * A library sound made ready to place like a procedural one: silence
 * trimmed from both ends, cut to the length its role allows, levelled to
 * the loudness of the recipe it stands in for (so the recipe's mix gain
 * fits it too), with its hit point found. Pure.
 *
 * Loudness is the loudest 300 ms window's RMS, the part of an effect that
 * reads in a mix; the peak never goes past the -1 dBFS every rendered
 * effect peaks at (render.ts SFX_PEAK_DBFS): a spiky sound's transient is
 * soft-limited (up to 6 dB), and past that it ends up a little quieter
 * rather than clipped.
 */

import { SFX_SAMPLE_RATE } from "./dsp.js";
import type { SfxHitKind } from "./recipes.js";
import { SFX_PEAK_DBFS, renderSfx } from "./render.js";

/** Bump when conditioning changes, so cached library files are made again. */
export const SFX_CONDITION_VERSION = 2;

export interface PcmInput {
  sampleRate: number;
  left: Float32Array;
  /** Absent for mono sources. */
  right?: Float32Array;
}

export interface ConditionedSfx {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  /** Seconds from the start to the moment that belongs on the cut. */
  hit: number;
  duration: number;
  /** Seconds of silence (or excess) cut from the head and the tail. */
  trimmedHead: number;
  trimmedTail: number;
  /** Level change applied, dB. */
  gainDb: number;
}

export interface ConditionOptions {
  hit: SfxHitKind;
  /** Longest the sound may run, seconds (a riser keeps its end, everything else its start). */
  maxSeconds: number;
  /** Loudest-window RMS to level to (linear). */
  targetRms: number;
  /** Played this many semitones faster (+) or slower (−), as a sampler does: pitch and length change together. */
  semitones?: number;
}

/** Below the peak by this much counts as silence, dB. */
const SILENCE_BELOW_PEAK_DB = -40;
/** And never louder than this, dBFS (a quiet sound's noise floor stays silence). */
const SILENCE_FLOOR_DBFS = -60;
// About the ear's integration time: a 300 ms window weighs a hit's body, not only its transient.
const WINDOW = 0.3;
const HOP = 0.01;

const db = (x: number) => Math.pow(10, x / 20);

/** Most a sound is driven into the soft limiter, dB: a transient flattened by more starts to crackle. */
const MAX_DRIVE_DB = 6;

/** Unity below half the ceiling, then a tanh knee that never reaches the ceiling. */
function softLimiter(ceiling: number): (x: number) => number {
  const knee = ceiling * 0.5;
  const room = ceiling - knee;
  return (x) => {
    const a = Math.abs(x);
    return a <= knee ? x : Math.sign(x) * (knee + room * Math.tanh((a - knee) / room));
  };
}

/** Loudest `WINDOW` RMS over both channels. */
export function loudestRms(left: Float32Array, right: Float32Array, sampleRate: number): number {
  const size = Math.max(1, Math.round(WINDOW * sampleRate));
  const hop = Math.max(1, Math.round(HOP * sampleRate));
  let best = 0;
  for (let start = 0; start < Math.max(1, left.length - size + 1); start += hop) {
    let sum = 0;
    const end = Math.min(left.length, start + size);
    for (let i = start; i < end; i += 1) sum += left[i]! * left[i]! + right[i]! * right[i]!;
    // A sound shorter than the window counts as padded with silence, so a click and a boom compare by energy.
    best = Math.max(best, Math.sqrt(sum / (2 * size)));
  }
  return best;
}

/** Centre of the loudest window, seconds. */
function loudestAt(left: Float32Array, right: Float32Array, sampleRate: number): number {
  const size = Math.max(1, Math.round(0.02 * sampleRate));
  const hop = Math.max(1, Math.round(0.005 * sampleRate));
  let best = -1;
  let at = 0;
  for (let start = 0; start < Math.max(1, left.length - size + 1); start += hop) {
    let sum = 0;
    for (let i = start; i < Math.min(left.length, start + size); i += 1) sum += left[i]! * left[i]! + right[i]! * right[i]!;
    if (sum > best) {
      best = sum;
      at = start + size / 2;
    }
  }
  return at / sampleRate;
}

const loudness = new Map<string, number>();

/** The loudness (loudest 50 ms RMS) a recipe renders at with its defaults: what a library sound standing in for it is levelled to. */
export function recipeLoudness(recipeId: string): number {
  let value = loudness.get(recipeId);
  if (value === undefined) {
    const audio = renderSfx(recipeId);
    value = loudestRms(audio.left, audio.right, audio.sampleRate);
    loudness.set(recipeId, value);
  }
  return value;
}

/** Linear resample (decoders deliver the rate asked for; this covers the ones that cannot). */
function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const out = new Float32Array(Math.max(1, Math.round((x.length * to) / from)));
  for (let i = 0; i < out.length; i += 1) {
    const p = (i * from) / to;
    const j = Math.floor(p);
    const f = p - j;
    out[i] = (x[j] ?? 0) * (1 - f) + (x[j + 1] ?? x[j] ?? 0) * f;
  }
  return out;
}

/** Condition a decoded sound; null when it is silent. */
export function conditionSfx(input: PcmInput, options: ConditionOptions): ConditionedSfx | null {
  const sr = SFX_SAMPLE_RATE;
  const rate = input.sampleRate * 2 ** ((options.semitones ?? 0) / 12);
  const inL = resample(input.left, rate, sr);
  const inR = input.right ? resample(input.right, rate, sr) : inL;
  const n = Math.min(inL.length, inR.length);
  let peak = 0;
  for (let i = 0; i < n; i += 1) peak = Math.max(peak, Math.abs(inL[i]!), Math.abs(inR[i]!));
  if (peak < db(-80)) return null;
  const threshold = Math.max(peak * db(SILENCE_BELOW_PEAK_DB), db(SILENCE_FLOOR_DBFS));
  const loud = (i: number) => Math.abs(inL[i]!) > threshold || Math.abs(inR[i]!) > threshold;
  let first = 0;
  while (first < n && !loud(first)) first += 1;
  let last = n - 1;
  while (last > first && !loud(last)) last -= 1;
  // A little air before the attack and after the decay, so neither is clipped.
  let head = Math.max(0, first - Math.round(0.005 * sr));
  let tail = Math.min(n, last + 1 + Math.round(0.03 * sr));
  const max = Math.round(options.maxSeconds * sr);
  if (tail - head > max) {
    if (options.hit === "end") head = tail - max;
    else tail = head + max;
  }
  const left = inL.slice(head, tail);
  const right = inR === inL ? left.slice() : inR.slice(head, tail);
  const length = left.length;
  // Fades only where something was cut: a raised-cosine never clicks.
  const fadeIn = head > 0 ? Math.min(length, Math.round(0.002 * sr)) : 0;
  const fadeOut = Math.min(length, Math.round((tail < n ? 0.02 : 0.004) * sr));
  for (let i = 0; i < length; i += 1) {
    let g = 1;
    if (i < fadeIn) g *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeIn);
    const fromEnd = length - 1 - i;
    if (fromEnd < fadeOut) g *= 0.5 - 0.5 * Math.cos((Math.PI * fromEnd) / fadeOut);
    left[i]! *= g;
    right[i]! *= g;
  }
  let regionPeak = 0;
  for (let i = 0; i < length; i += 1) regionPeak = Math.max(regionPeak, Math.abs(left[i]!), Math.abs(right[i]!));
  const rms = loudestRms(left, right, sr);
  const ceiling = db(SFX_PEAK_DBFS);
  // A recorded hit's transient sits far above its body: levelled by its peak alone it plays quieter than the
  // synthesised one. Up to MAX_DRIVE_DB past the ceiling is allowed, and the transient soft-limited back under it.
  const gain = Math.min(rms > 0 ? options.targetRms / rms : 1, (ceiling / regionPeak) * db(MAX_DRIVE_DB));
  const limit = gain * regionPeak > ceiling ? softLimiter(ceiling) : (x: number) => x;
  for (let i = 0; i < length; i += 1) {
    left[i] = limit(left[i]! * gain);
    right[i] = limit(right[i]! * gain);
  }
  let finalPeak = 0;
  for (let i = 0; i < length; i += 1) finalPeak = Math.max(finalPeak, Math.abs(left[i]!), Math.abs(right[i]!));
  const duration = length / sr;
  let hit: number;
  if (options.hit === "end") hit = duration;
  else if (options.hit === "peak") hit = loudestAt(left, right, sr);
  else {
    // The transient: the first sample at half the peak.
    const half = finalPeak * 0.5;
    let i = 0;
    while (i < length && Math.abs(left[i]!) < half && Math.abs(right[i]!) < half) i += 1;
    hit = Math.min(i, length - 1) / sr;
  }
  return {
    sampleRate: sr,
    left,
    right,
    hit: Math.round(hit * 1e5) / 1e5,
    duration,
    trimmedHead: head / sr,
    trimmedTail: (n - tail) / sr,
    gainDb: Math.round(20 * Math.log10(gain) * 10) / 10,
  };
}
