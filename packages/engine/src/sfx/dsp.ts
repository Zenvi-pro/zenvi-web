/**
 * DSP building blocks for the procedural sound effects (sfx/recipes.ts):
 * a seeded random source, noise colours, a state-variable filter that can
 * sweep every sample, one-pole filters, oscillators, envelopes, equal-power
 * panning, soft saturation and a small stereo reverb. Pure and
 * deterministic: the same seed gives the same samples on every surface.
 */

/** Rate every effect is rendered at (the project audio rate of the desktop's default profiles). */
export const SFX_SAMPLE_RATE = 48000;

/** mulberry32: small, fast, and good enough for audio noise; `seed` is any 32-bit integer. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [-1, 1). */
  bipolar(): number {
    return this.next() * 2 - 1;
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** A child generator, so adding a layer to a recipe does not shift the noise of the others. */
  fork(salt: number): Rng {
    return new Rng(Math.imul((this.next() * 4294967296) >>> 0, 2654435761) ^ salt);
  }
}

/** Pink noise (-3 dB/octave), Paul Kellet's refined filter; about unit RMS-ish peaks. */
export class PinkNoise {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private b3 = 0;
  private b4 = 0;
  private b5 = 0;
  private b6 = 0;

  constructor(private readonly rng: Rng) {}

  next(): number {
    const white = this.rng.bipolar();
    this.b0 = 0.99886 * this.b0 + white * 0.0555179;
    this.b1 = 0.99332 * this.b1 + white * 0.0750759;
    this.b2 = 0.969 * this.b2 + white * 0.153852;
    this.b3 = 0.8665 * this.b3 + white * 0.3104856;
    this.b4 = 0.55 * this.b4 + white * 0.5329522;
    this.b5 = -0.7616 * this.b5 - white * 0.016898;
    const out = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + white * 0.5362;
    this.b6 = white * 0.115926;
    return out * 0.2;
  }
}

/**
 * Topology-preserving state-variable filter (Simper, "Linear Trapezoidal
 * Integrated SVF", Cytomic 2013): stable under per-sample cutoff sweeps,
 * which is what a whoosh is. After `run`, `low`, `band` and `high` hold the
 * three outputs.
 */
export class Svf {
  low = 0;
  band = 0;
  high = 0;
  private ic1 = 0;
  private ic2 = 0;

  constructor(private readonly sampleRate: number = SFX_SAMPLE_RATE) {}

  run(x: number, cutoffHz: number, q: number): void {
    const fc = Math.min(Math.max(cutoffHz, 10), this.sampleRate * 0.45);
    const g = Math.tan((Math.PI * fc) / this.sampleRate);
    const k = 1 / Math.max(q, 0.05);
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.band = v1;
    this.high = x - k * v1 - v2;
  }

  /** Band-pass normalised to unit gain at the centre. */
  bandpass(x: number, cutoffHz: number, q: number): number {
    this.run(x, cutoffHz, q);
    return this.band / Math.max(q, 0.05);
  }

  lowpass(x: number, cutoffHz: number, q = Math.SQRT1_2): number {
    this.run(x, cutoffHz, q);
    return this.low;
  }

  highpass(x: number, cutoffHz: number, q = Math.SQRT1_2): number {
    this.run(x, cutoffHz, q);
    return this.high;
  }
}

/** One-pole low-pass (6 dB/octave); `high` is the complementary high-pass. */
export class OnePole {
  private y = 0;

  constructor(private readonly sampleRate: number = SFX_SAMPLE_RATE) {}

  low(x: number, cutoffHz: number): number {
    const a = 1 - Math.exp((-2 * Math.PI * cutoffHz) / this.sampleRate);
    this.y += a * (x - this.y);
    return this.y;
  }

  high(x: number, cutoffHz: number): number {
    return x - this.low(x, cutoffHz);
  }
}

/** Sine oscillator with a phase accumulator, so its frequency can glide every sample. */
export class SineOsc {
  private phase: number;

  constructor(
    phase = 0,
    private readonly sampleRate: number = SFX_SAMPLE_RATE,
  ) {
    this.phase = phase;
  }

  next(freqHz: number): number {
    const out = Math.sin(2 * Math.PI * this.phase);
    this.phase += freqHz / this.sampleRate;
    this.phase -= Math.floor(this.phase);
    return out;
  }
}

/** Band-limited sawtooth (PolyBLEP), for tonal risers without aliasing whistles. */
export class SawOsc {
  private phase: number;

  constructor(
    phase = 0,
    private readonly sampleRate: number = SFX_SAMPLE_RATE,
  ) {
    this.phase = phase;
  }

  next(freqHz: number): number {
    const dt = Math.min(freqHz / this.sampleRate, 0.5);
    let out = 2 * this.phase - 1;
    const p = this.phase;
    if (p < dt) {
      const x = p / dt;
      out -= x + x - x * x - 1;
    } else if (p > 1 - dt) {
      const x = (p - 1) / dt;
      out -= x * x + x + x + 1;
    }
    this.phase += dt;
    this.phase -= Math.floor(this.phase);
    return out;
  }
}

/** Smoothly varying random value (sample-and-hold, glided): turbulence, flutter. */
export class Wander {
  private target = 0;
  private value = 0;
  private countdown = 0;

  constructor(
    private readonly rng: Rng,
    private readonly sampleRate: number = SFX_SAMPLE_RATE,
  ) {}

  /** Next value in about [-1, 1], changing `rateHz` times a second. */
  next(rateHz: number): number {
    if (this.countdown <= 0) {
      this.target = this.rng.bipolar();
      this.countdown = Math.max(1, Math.round(this.sampleRate / Math.max(rateHz, 0.1)));
    }
    this.countdown -= 1;
    this.value += (this.target - this.value) * Math.min(1, (rateHz * 6) / this.sampleRate);
    return this.value;
  }
}

// ---------------------------------------------------------------------------
// Envelopes and curves (functions of seconds)
// ---------------------------------------------------------------------------

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Exponential interpolation between two positive values (frequencies sweep this way). */
export function expLerp(a: number, b: number, t: number): number {
  return a * Math.pow(b / a, t);
}

export function smoothstep(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

/** 0 → 1 along an exponential curve; `k` > 0 bends it to start slowly (a crescendo). */
export function expCurve(x: number, k: number): number {
  const t = clamp01(x);
  return Math.abs(k) < 1e-6 ? t : (Math.exp(k * t) - 1) / (Math.exp(k) - 1);
}

/** Attack (smooth, `attack` seconds) then exponential decay with time constant `tau`. */
export function attackDecay(t: number, attack: number, tau: number): number {
  if (t < 0) return 0;
  if (t < attack) return smoothstep(t / attack);
  return Math.exp(-(t - attack) / tau);
}

/**
 * The amplitude of something passing by: an exponential crescendo to the
 * peak at `peak` seconds, then an exponential fall (`fallTau`) that reaches
 * silence at `end`.
 */
export function passBy(t: number, peak: number, end: number, riseK: number, fallTau: number): number {
  if (t < 0 || t > end) return 0;
  if (t <= peak) return peak <= 0 ? 1 : expCurve(t / peak, riseK);
  const fall = Math.exp(-(t - peak) / fallTau);
  const tail = end - peak;
  // Fade the last fifth of the tail so the decay lands on zero.
  const fade = tail > 0 ? clamp01((end - t) / (tail * 0.2)) : 0;
  return fall * fade;
}

// ---------------------------------------------------------------------------
// Stereo
// ---------------------------------------------------------------------------

/** Equal-power pan gains for `pan` in [-1, 1]. */
export function panGains(pan: number): [number, number] {
  const angle = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return [Math.cos(angle), Math.sin(angle)];
}

/** Soft saturation normalised so that ±1 stays ±1: warmth and glue, not distortion, at drive ≤ 3. */
export function saturate(x: number, drive: number): number {
  if (drive <= 1e-3) return x;
  return Math.tanh(x * drive) / Math.tanh(drive);
}

/** Two channels of float PCM. */
export class StereoBuffer {
  readonly left: Float32Array;
  readonly right: Float32Array;

  constructor(
    readonly length: number,
    readonly sampleRate: number = SFX_SAMPLE_RATE,
  ) {
    this.left = new Float32Array(length);
    this.right = new Float32Array(length);
  }

  /** Add a mono sample at `pan`. */
  add(index: number, value: number, pan = 0): void {
    if (index < 0 || index >= this.length) return;
    const [gl, gr] = panGains(pan);
    this.left[index] = this.left[index]! + value * gl;
    this.right[index] = this.right[index]! + value * gr;
  }

  addStereo(index: number, l: number, r: number): void {
    if (index < 0 || index >= this.length) return;
    this.left[index] = this.left[index]! + l;
    this.right[index] = this.right[index]! + r;
  }

  /** Mix `other` in, starting at sample `offset`. */
  mix(other: StereoBuffer, gain = 1, offset = 0): void {
    for (let i = 0; i < other.length; i += 1) {
      const j = i + offset;
      if (j < 0 || j >= this.length) continue;
      this.left[j] = this.left[j]! + other.left[i]! * gain;
      this.right[j] = this.right[j]! + other.right[i]! * gain;
    }
  }

  /** Apply `fn` to every sample of both channels. */
  map(fn: (x: number) => number): void {
    for (let i = 0; i < this.length; i += 1) {
      this.left[i] = fn(this.left[i]!);
      this.right[i] = fn(this.right[i]!);
    }
  }

  peak(): number {
    let p = 0;
    for (let i = 0; i < this.length; i += 1) p = Math.max(p, Math.abs(this.left[i]!), Math.abs(this.right[i]!));
    return p;
  }

  reverse(): void {
    this.left.reverse();
    this.right.reverse();
  }
}

// ---------------------------------------------------------------------------
// Reverb
// ---------------------------------------------------------------------------

/** Freeverb's tunings (Jezar, public domain) at 44.1 kHz, scaled to the render rate. */
const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING = [556, 441, 341, 225];
const STEREO_SPREAD = 23;

class Comb {
  private readonly buffer: Float32Array;
  private index = 0;
  private store = 0;

  constructor(size: number) {
    this.buffer = new Float32Array(size);
  }

  run(x: number, feedback: number, damp: number): number {
    const y = this.buffer[this.index]!;
    this.store = y * (1 - damp) + this.store * damp;
    this.buffer[this.index] = x + this.store * feedback;
    this.index = (this.index + 1) % this.buffer.length;
    return y;
  }
}

class Allpass {
  private readonly buffer: Float32Array;
  private index = 0;

  constructor(size: number) {
    this.buffer = new Float32Array(size);
  }

  run(x: number): number {
    const y = this.buffer[this.index]!;
    this.buffer[this.index] = x + y * 0.5;
    this.index = (this.index + 1) % this.buffer.length;
    return y - x;
  }
}

export interface ReverbOptions {
  /** 0..1: small room to hall (comb feedback 0.7..0.98). */
  room: number;
  /** 0..1: high-frequency damping of the tail. */
  damp: number;
  /** Level of the tail added to the dry signal. */
  wet: number;
  /** Seconds before the tail starts. */
  predelay?: number;
}

/** Add a stereo reverb tail (Freeverb topology) to `buffer` in place. */
export function addReverb(buffer: StereoBuffer, options: ReverbOptions): void {
  const scale = buffer.sampleRate / 44100;
  const make = (spread: number) => ({
    combs: COMB_TUNING.map((n) => new Comb(Math.round((n + spread) * scale))),
    allpasses: ALLPASS_TUNING.map((n) => new Allpass(Math.round((n + spread) * scale))),
  });
  const left = make(0);
  const right = make(STEREO_SPREAD);
  const feedback = 0.7 + 0.28 * clamp01(options.room);
  const damp = 0.05 + 0.6 * clamp01(options.damp);
  const pre = Math.round((options.predelay ?? 0) * buffer.sampleRate);
  const run = (ch: typeof left, x: number) => {
    let sum = 0;
    for (const comb of ch.combs) sum += comb.run(x, feedback, damp);
    for (const ap of ch.allpasses) sum = ap.run(sum);
    return sum;
  };
  const wet = options.wet * 0.2;
  const input = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    const j = i - pre;
    input[i] = j >= 0 ? (buffer.left[j]! + buffer.right[j]!) * 0.5 : 0;
  }
  for (let i = 0; i < buffer.length; i += 1) {
    const x = input[i]! * 0.3;
    buffer.left[i] = buffer.left[i]! + run(left, x) * wet;
    buffer.right[i] = buffer.right[i]! + run(right, x) * wet;
  }
}
