/**
 * `renderSfx(recipe, params)`: one procedural sound effect as 48 kHz stereo
 * float PCM, with its hit point. Deterministic: the same recipe, parameters
 * and seed give the same samples, so a WAV can be cached by `sfxKey`.
 *
 * Every render is finished the same way: DC removed, edges faded so nothing
 * clicks, denormals flushed, and the peak normalised to -1 dBFS (the level
 * of a placed effect is its clip gain, not the file).
 */

import { Rng, SFX_SAMPLE_RATE, StereoBuffer, Svf, clamp01 } from "./dsp.js";
import type { Voice } from "./layers.js";
import { sfxRecipe, type SfxRecipe } from "./recipes.js";

/** Bump when any recipe's sound changes, so cached files are rendered again. */
export const SFX_VERSION = 1;

/** Peak of every rendered file, dBFS. */
export const SFX_PEAK_DBFS = -1;

export interface SfxParams {
  /** Seconds (clamped to the recipe's range). Default: the recipe's. */
  duration?: number;
  /** Semitones, -12..12. Default 0. */
  pitch?: number;
  /** 0 (dark) .. 1 (bright). Default 0.5. */
  brightness?: number;
  /** 0 (gentle) .. 1 (hard: more drive, tail, density). Default 0.7. */
  intensity?: number;
  /** -1..1: position of static sounds; travel (direction and width) of moving ones. Default 0. */
  pan?: number;
  /** Any integer: a different variation of the same recipe. Default 1. */
  seed?: number;
}

export type ResolvedSfxParams = Required<SfxParams>;

export interface SfxAudio {
  recipe: string;
  params: ResolvedSfxParams;
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  /** Seconds from the start of the file to the moment that belongs on the cut. */
  hit: number;
  /** Seconds. */
  duration: number;
}

/** `value` to `1 / per` steps, exactly (0.7, not 0.7000000000000001). */
function round(value: number, per: number): number {
  return Math.round(value * per) / per;
}

/** The parameters a render uses: defaults filled, clamped, rounded (so equal sounds share a cache key). */
export function resolveSfxParams(recipe: SfxRecipe, params: SfxParams = {}): ResolvedSfxParams {
  const { min, max } = recipe.duration;
  const num = (value: number | undefined, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
  return {
    duration: round(Math.min(max, Math.max(min, num(params.duration, recipe.duration.default))), 100),
    pitch: round(Math.min(12, Math.max(-12, num(params.pitch, 0))), 10),
    brightness: round(clamp01(num(params.brightness, 0.5)), 100),
    intensity: round(clamp01(num(params.intensity, 0.7)), 100),
    pan: round(Math.min(1, Math.max(-1, num(params.pan, 0))), 100),
    seed: Math.trunc(num(params.seed, 1)) | 0,
  };
}

/** Seed of the random source: the recipe id and the seed, so recipes with the same seed do not share noise. */
function seedOf(recipe: string, seed: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < recipe.length; i += 1) h = Math.imul(h ^ recipe.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Lowest channel correlation a render keeps: phones play mono, and anti-phase stereo cancels there. */
const MIN_CORRELATION = 0.2;

/** Narrow the side signal until the channels correlate at least MIN_CORRELATION. */
function limitWidth(buffer: StereoBuffer): void {
  let mid = 0;
  let side = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const l = buffer.left[i]!;
    const r = buffer.right[i]!;
    mid += (l + r) * (l + r);
    side += (l - r) * (l - r);
  }
  // For uncorrelated mid and side, correlation = (M² - S²) / (M² + S²).
  const maxRatio = (1 - MIN_CORRELATION) / (1 + MIN_CORRELATION);
  if (side === 0 || side / Math.max(mid, 1e-30) <= maxRatio) return;
  const f = Math.sqrt((maxRatio * mid) / side);
  for (let i = 0; i < buffer.length; i += 1) {
    const m = (buffer.left[i]! + buffer.right[i]!) / 2;
    const s = ((buffer.left[i]! - buffer.right[i]!) / 2) * f;
    buffer.left[i] = m + s;
    buffer.right[i] = m - s;
  }
}

function finish(buffer: StereoBuffer): void {
  const sr = buffer.sampleRate;
  const dc = [new Svf(sr), new Svf(sr)];
  const fadeIn = Math.min(buffer.length, 24);
  const fadeOut = Math.min(buffer.length, Math.round(0.008 * sr));
  const channels = [buffer.left, buffer.right];
  channels.forEach((ch, c) => {
    for (let i = 0; i < ch.length; i += 1) {
      let x = dc[c]!.highpass(ch[i]!, 16);
      if (i < fadeIn) x *= i / fadeIn;
      const fromEnd = ch.length - 1 - i;
      if (fromEnd < fadeOut) x *= fromEnd / fadeOut;
      ch[i] = Number.isFinite(x) ? x : 0;
    }
  });
  limitWidth(buffer);
  const peak = buffer.peak();
  const gain = peak > 0 ? Math.pow(10, SFX_PEAK_DBFS / 20) / peak : 0;
  // Flush to zero what 24-bit audio cannot represent: no denormals downstream.
  buffer.map((x) => {
    const y = x * gain;
    return Math.abs(y) < 1e-9 ? 0 : y;
  });
}

/** Render one effect. Throws for an unknown recipe id (a programmer error: tools validate first). */
export function renderSfx(recipeId: string, params: SfxParams = {}): SfxAudio {
  const recipe = sfxRecipe(recipeId);
  if (!recipe) throw new Error(`unknown sound effect recipe: ${recipeId}`);
  const p = resolveSfxParams(recipe, params);
  const sampleRate = SFX_SAMPLE_RATE;
  const out = new StereoBuffer(Math.max(1, Math.round(p.duration * sampleRate)), sampleRate);
  const voice: Voice = {
    out,
    rng: new Rng(seedOf(recipe.id, p.seed)),
    tune: Math.pow(2, p.pitch / 12),
    bright: Math.pow(2, (p.brightness - 0.5) * 2),
    intensity: p.intensity,
    pan: p.pan,
    duration: p.duration,
  };
  const hit = recipe.render(voice);
  finish(out);
  return { recipe: recipe.id, params: p, sampleRate, left: out.left, right: out.right, hit: Math.min(Math.max(hit, 0), p.duration), duration: out.length / sampleRate };
}

/** Lead silence that puts the hit exactly on a frame boundary at `fps` (libopenshot places audio by whole frames). */
export function framePad(hit: number, fps: number): number {
  if (!(fps > 0)) return 0;
  const frames = Math.ceil(hit * fps - 1e-6);
  return Math.max(0, frames / fps - hit);
}

/** `audio` with `seconds` of silence in front (the hit moves by the same amount). */
export function padSfx(audio: SfxAudio, seconds: number): SfxAudio {
  const lead = Math.round(seconds * audio.sampleRate);
  if (lead <= 0) return audio;
  const grow = (ch: Float32Array) => {
    const next = new Float32Array(ch.length + lead);
    next.set(ch, lead);
    return next;
  };
  return { ...audio, left: grow(audio.left), right: grow(audio.right), hit: audio.hit + lead / audio.sampleRate, duration: (audio.left.length + lead) / audio.sampleRate };
}

/** A cache key for a rendered file: recipe, resolved parameters, the frame rate it is padded for, and the synth version. */
export function sfxKey(recipeId: string, params: ResolvedSfxParams, fps: number): string {
  const text = JSON.stringify([SFX_VERSION, recipeId, params.duration, params.pitch, params.brightness, params.intensity, params.pan, params.seed, Math.round(fps * 1000)]);
  // Two independent 32-bit FNV-1a hashes: 64 bits is plenty for one project's effects.
  let a = 2166136261;
  let b = 0x811c9dc5 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 16777619) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}
