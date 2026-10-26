/**
 * The layers sound effects are built from (sfx/recipes.ts): a pitched
 * kick body, filtered noise bursts, modal (struck-object) resonances and the
 * pass-by whoosh. Each adds into a recipe's stereo buffer at a time offset.
 */

import { OnePole, PinkNoise, Rng, SineOsc, StereoBuffer, Svf, Wander, attackDecay, expLerp, panGains, passBy, saturate } from "./dsp.js";

/** What a recipe renders with. */
export interface Voice {
  out: StereoBuffer;
  rng: Rng;
  /** Frequency multiplier from `pitch` (semitones). */
  tune: number;
  /** Filter multiplier from `brightness`: ×0.5 at 0, ×1 at 0.5, ×2 at 1. */
  bright: number;
  /** 0..1. */
  intensity: number;
  /** -1..1: position of static sounds, travel of moving ones. */
  pan: number;
  /** Seconds. */
  duration: number;
}

const SQRT2 = Math.SQRT2;

function span(v: Voice, at: number, seconds: number): [number, number] {
  const sr = v.out.sampleRate;
  return [Math.max(0, Math.round(at * sr)), Math.min(v.out.length, Math.round((at + seconds) * sr))];
}

export interface KickOptions {
  at: number;
  /** Start and settle frequency of the pitch drop, Hz (before `tune`). */
  from: number;
  to: number;
  /** Time constant of the pitch drop, seconds. */
  pitchTau: number;
  /** Time constant of the amplitude decay, seconds. */
  decay: number;
  level: number;
  attack?: number;
  /** Saturation of the body (adds the harmonics small speakers can play). */
  drive?: number;
  pan?: number;
}

/** A sine body whose pitch falls exponentially: the weight of every impact. */
export function kick(v: Voice, o: KickOptions): void {
  const sr = v.out.sampleRate;
  const osc = new SineOsc();
  const [a, b] = span(v, o.at, o.decay * 9 + (o.attack ?? 0.0015));
  const [gl, gr] = panGains(o.pan ?? 0);
  for (let i = a; i < b; i += 1) {
    const t = i / sr - o.at;
    const f = (o.to + (o.from - o.to) * Math.exp(-t / o.pitchTau)) * v.tune;
    const s = saturate(osc.next(f) * attackDecay(t, o.attack ?? 0.0015, o.decay), o.drive ?? 0) * o.level;
    v.out.addStereo(i, s * gl * SQRT2, s * gr * SQRT2);
  }
}

export type NoiseMode = "band" | "low" | "high";

export interface NoiseBurstOptions {
  at: number;
  mode: NoiseMode;
  /** Filter frequency at the start, Hz (before `bright`). */
  freq: number;
  /** Frequency the filter glides to over the decay, Hz. */
  freqEnd?: number;
  q?: number;
  attack?: number;
  decay: number;
  level: number;
  pan?: number;
  /** 0: mono; 1: independent noise per channel (wide). */
  width?: number;
  /** Pink (warmer) instead of white. */
  pink?: boolean;
  /** Follow `bright`; off for layers whose colour is the point (a sub thump). */
  tracksBrightness?: boolean;
}

/** Filtered noise with an attack/decay envelope: transients, cracks, puffs, crunch. */
export function noiseBurst(v: Voice, o: NoiseBurstOptions): void {
  const sr = v.out.sampleRate;
  const rng = v.rng.fork(0x51);
  const src = o.pink ? [new PinkNoise(rng), new PinkNoise(rng.fork(1)), new PinkNoise(rng.fork(2))] : null;
  const white = [rng.fork(3), rng.fork(4), rng.fork(5)];
  const noise = (k: number) => (src ? src[k]!.next() : white[k]!.bipolar());
  const fl = new Svf(sr);
  const fr = new Svf(sr);
  const width = o.width ?? 0;
  const q = o.q ?? 0.8;
  const attack = o.attack ?? 0.0005;
  const [gl, gr] = panGains(o.pan ?? 0);
  const mul = o.tracksBrightness === false ? 1 : v.bright;
  const [a, b] = span(v, o.at, attack + o.decay * 8);
  for (let i = a; i < b; i += 1) {
    const t = i / sr - o.at;
    const env = attackDecay(t, attack, o.decay);
    const f = (o.freqEnd === undefined ? o.freq : expLerp(o.freq, o.freqEnd, 1 - Math.exp(-t / o.decay))) * mul;
    const c = noise(0);
    const xl = c * (1 - width) + noise(1) * width;
    const xr = c * (1 - width) + noise(2) * width;
    const yl = o.mode === "band" ? fl.bandpass(xl, f, q) : o.mode === "low" ? fl.lowpass(xl, f, q) : fl.highpass(xl, f, q);
    const yr = o.mode === "band" ? fr.bandpass(xr, f, q) : o.mode === "low" ? fr.lowpass(xr, f, q) : fr.highpass(xr, f, q);
    v.out.addStereo(i, yl * env * o.level * gl * SQRT2, yr * env * o.level * gr * SQRT2);
  }
}

export interface ModalOptions {
  at: number;
  /** Mode frequencies, Hz (before `tune`). */
  freqs: readonly number[];
  /** Decay time constant per mode, seconds. */
  decays: readonly number[];
  amps: readonly number[];
  level: number;
  attack?: number;
  pan?: number;
}

/** Decaying sine partials: the ring of a struck object (metal, plastic, a bell). */
export function modal(v: Voice, o: ModalOptions): void {
  const sr = v.out.sampleRate;
  const longest = Math.max(...o.decays);
  const [a, b] = span(v, o.at, longest * 8);
  const oscs = o.freqs.map(() => new SineOsc());
  const [gl, gr] = panGains(o.pan ?? 0);
  const attack = o.attack ?? 0.0005;
  for (let i = a; i < b; i += 1) {
    const t = i / sr - o.at;
    let s = 0;
    for (let m = 0; m < oscs.length; m += 1) {
      s += oscs[m]!.next(o.freqs[m]! * v.tune) * attackDecay(t, attack, o.decays[m]!) * o.amps[m]!;
    }
    v.out.addStereo(i, s * o.level * gl * SQRT2, s * o.level * gr * SQRT2);
  }
}

export interface WhooshOptions {
  /** Seconds into the buffer the move starts. */
  at?: number;
  /** Seconds from the start to the loudest, brightest moment. */
  peak: number;
  /** Seconds from the start to silence. */
  end: number;
  /** Crescendo curvature (higher = it arrives faster at the end). */
  riseK: number;
  /** Fall time constant after the peak, seconds. */
  fallTau: number;
  /** Band-pass centre at silence and at the peak, Hz (before `tune` and `bright`). */
  low: number;
  high: number;
  q: number;
  /** High-passed air on top, 0..1. */
  air: number;
  /** Low body under it, 0..1. */
  roar: number;
  /** Turbulence, 0..1. */
  flutter: number;
  /** Pan travel: from -travel to +travel, crossing the centre at the peak. */
  travel: number;
  /** Decorrelation between the channels, 0..1. */
  width: number;
  level: number;
}

/**
 * Air rushing past: pink noise through two band-pass formants whose centre
 * follows the amplitude (the Doppler brightening of a pass-by), with air
 * and roar layers, turbulence and a pan sweep that crosses the centre at
 * the peak.
 */
export function whoosh(v: Voice, o: WhooshOptions): void {
  const sr = v.out.sampleRate;
  const at = o.at ?? 0;
  const rng = v.rng.fork(0x77);
  const pinks = [new PinkNoise(rng.fork(1)), new PinkNoise(rng.fork(2)), new PinkNoise(rng.fork(3))];
  const whites = [rng.fork(4), rng.fork(5)];
  const f = [new Svf(sr), new Svf(sr), new Svf(sr), new Svf(sr)];
  const air = [new Svf(sr), new Svf(sr)];
  const roar = [new OnePole(sr), new OnePole(sr), new OnePole(sr), new OnePole(sr)];
  // Rumble below ~80 Hz only muddies the music under a whoosh.
  const rumble = [new Svf(sr), new Svf(sr)];
  const wander = new Wander(rng.fork(6), sr);
  const [a, b] = span(v, at, o.end);
  const travelSpan = Math.max(o.end * 0.35, 0.05);
  for (let i = a; i < b; i += 1) {
    const t = i / sr - at;
    const e = passBy(t, o.peak, o.end, o.riseK, o.fallTau);
    const turb = 1 + o.flutter * 0.45 * wander.next(14 + 10 * e);
    const fc = expLerp(o.low, o.high, Math.pow(e, 0.7)) * v.tune * v.bright;
    const c = pinks[0]!.next();
    const xl = c * (1 - o.width * 0.6) + pinks[1]!.next() * o.width;
    const xr = c * (1 - o.width * 0.6) + pinks[2]!.next() * o.width;
    let l = f[0]!.bandpass(xl, fc, o.q) + 0.55 * f[1]!.bandpass(xl, fc * 2.3, o.q * 1.4);
    let r = f[2]!.bandpass(xr, fc * 1.03, o.q) + 0.55 * f[3]!.bandpass(xr, fc * 2.25, o.q * 1.4);
    if (o.air > 0) {
      const ae = Math.pow(e, 1.6) * o.air * 0.5;
      l += air[0]!.highpass(whites[0]!.bipolar(), Math.max(fc * 2.5, 2500)) * ae;
      r += air[1]!.highpass(whites[1]!.bipolar(), Math.max(fc * 2.4, 2500)) * ae;
    }
    if (o.roar > 0) {
      const cut = (150 + 320 * e) * v.tune;
      const re = Math.pow(e, 1.3) * o.roar * 1.2;
      l += roar[1]!.low(roar[0]!.low(xl, cut), cut) * re;
      r += roar[3]!.low(roar[2]!.low(xr, cut), cut) * re;
    }
    const p = o.travel * Math.tanh((t - o.peak) / travelSpan);
    const [gl, gr] = panGains(p);
    const g = e * turb * o.level * SQRT2;
    v.out.addStereo(i, rumble[0]!.highpass(l, 85) * g * gl, rumble[1]!.highpass(r, 85) * g * gr);
  }
}
