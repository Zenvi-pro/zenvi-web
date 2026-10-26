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
  /** Seconds from the start to the loudest moment (the pass, or the arrival). */
  peak: number;
  /** Seconds from the start to silence. */
  end: number;
  /** Crescendo curvature: higher = a slow build that arrives fast. */
  riseK: number;
  /** Fall time constant after the peak, seconds: short for "by", long for "out". */
  fallTau: number;
  /** Centre of the resonant band at the start, at the peak and at the end, Hz (before `tune` and `bright`). */
  from: number;
  top: number;
  to: number;
  /** Resonance of the swept bands (3-5: a clearly moving band; 1.5: airy). */
  q: number;
  /** Comb "doppler" body gliding with the band, 0..1. */
  tone: number;
  /** Low body under it, 0..1. */
  roar: number;
  /** Turbulence, 0..1. */
  flutter: number;
  /** Pan travel: from -travel to +travel, crossing the centre at the peak. */
  travel: number;
  level: number;
}

/** Feedback comb with a fractional, gliding delay: a pitched resonance in noise (the jet/doppler tone). */
class GlideComb {
  private readonly buffer: Float32Array;
  private index = 0;

  constructor(private readonly sampleRate: number) {
    this.buffer = new Float32Array(Math.ceil(sampleRate / 30) + 2);
  }

  run(x: number, freqHz: number, feedback: number): number {
    const n = this.buffer.length;
    const delay = Math.min(n - 2, Math.max(2, this.sampleRate / freqHz));
    const pos = this.index - delay + n;
    const i0 = Math.floor(pos) % n;
    const frac = pos - Math.floor(pos);
    const delayed = this.buffer[i0]! * (1 - frac) + this.buffer[(i0 + 1) % n]! * frac;
    const y = x + feedback * delayed;
    this.buffer[this.index] = y;
    this.index = (this.index + 1) % n;
    return y * (1 - feedback);
  }
}

/** Centre frequency along the move: `from` → `top` at the peak → `to`, gliding exponentially. */
function sweep(o: WhooshOptions, t: number): number {
  if (t <= o.peak) return expLerp(o.from, o.top, o.peak > 0 ? Math.pow(Math.min(1, t / o.peak), 1.6) : 1);
  const tail = Math.max(o.end - o.peak, 1e-3);
  return expLerp(o.top, o.to, Math.pow(Math.min(1, (t - o.peak) / tail), 0.6));
}

/**
 * Something moving past: pink noise through two resonant band-passes whose
 * centre glides from `from` to `top` at the peak and on to `to` (the
 * Doppler sweep), a wide band for body, a comb tone gliding with the band,
 * turbulence, independent noise per side, and a pan path that crosses the
 * centre at the peak. Everything above ~12 kHz is rolled off: air, not hiss.
 */
export function whoosh(v: Voice, o: WhooshOptions): void {
  const sr = v.out.sampleRate;
  const at = o.at ?? 0;
  const rng = v.rng.fork(0x77);
  const pinks = [new PinkNoise(rng.fork(1)), new PinkNoise(rng.fork(2)), new PinkNoise(rng.fork(3))];
  const bands = Array.from({ length: 10 }, () => new Svf(sr));
  const combs = [new GlideComb(sr), new GlideComb(sr)];
  const roar = [new OnePole(sr), new OnePole(sr), new OnePole(sr), new OnePole(sr)];
  const hiss = [new Svf(sr), new Svf(sr), new Svf(sr), new Svf(sr)];
  // Rumble below ~80 Hz only muddies the music under a whoosh.
  const rumble = [new Svf(sr), new Svf(sr)];
  const wander = new Wander(rng.fork(6), sr);
  const [a, b] = span(v, at, o.end);
  const travelSpan = Math.max(o.end * 0.3, 0.04);
  const ch = [0, 0];
  for (let i = a; i < b; i += 1) {
    const t = i / sr - at;
    const e = passBy(t, o.peak, o.end, o.riseK, o.fallTau);
    const turb = 1 + o.flutter * 0.5 * wander.next(12 + 14 * e);
    const fc = sweep(o, t) * v.tune * v.bright;
    const common = pinks[0]!.next();
    for (let c = 0; c < 2; c += 1) {
      // Mostly independent noise per side: wide, and it moves as a whole with the pan.
      const x = common * 0.45 + pinks[c + 1]!.next() * 0.9;
      const detune = c === 0 ? 1 : 1.04;
      // Two cascaded band-passes per formant (24 dB/octave skirts), so the sweep reads as a moving band, not a noise burst.
      const k = c * 5;
      const main = bands[k + 1]!.bandpass(bands[k]!.bandpass(x, fc * detune, o.q), fc * detune, o.q);
      const formant = bands[k + 3]!.bandpass(bands[k + 2]!.bandpass(x, fc * 1.9 * detune, o.q * 1.2), fc * 1.9 * detune, o.q * 1.2);
      let y = main * 2.2 + formant * 1.1 + 0.15 * bands[k + 4]!.bandpass(x, fc * 0.8, 0.9);
      if (o.tone > 0) y += combs[c]!.run(x * 0.3, Math.max(40, (fc / 4) * detune), 0.82) * o.tone * 2.2;
      if (o.roar > 0) {
        const cut = (150 + 300 * e) * v.tune;
        y += roar[c * 2 + 1]!.low(roar[c * 2]!.low(x, cut), cut) * Math.pow(e, 1.3) * o.roar * 1.4;
      }
      ch[c] = hiss[c * 2 + 1]!.lowpass(hiss[c * 2]!.lowpass(rumble[c]!.highpass(y, 85), 9500), 9500);
    }
    const [gl, gr] = panGains(o.travel * Math.tanh((t - o.peak) / travelSpan));
    const g = e * turb * o.level * SQRT2;
    v.out.addStereo(i, ch[0]! * g * gl, ch[1]! * g * gr);
  }
}
