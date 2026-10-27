/**
 * The true-peak limiter every export ends with: a safety net that keeps a
 * mix nobody mastered (or one an edit pushed back over) from clipping the
 * file. It is transparent below the ceiling; above it, a lookahead gain dip
 * holds the oversampled peak (the true-peak meter's own interpolator) under
 * the ceiling, channels linked so the image does not shift.
 *
 * Gain: the gain each point needs is held at its minimum over the lookahead,
 * released exponentially, then averaged over the lookahead. Every average
 * that reaches a sample's output only covers values at or under what that
 * sample needs, so the ceiling holds exactly (to float rounding), not just on
 * average. The output is delayed by `latency` samples inside the limiter;
 * `process` and `flush` together return as many samples as went in, aligned.
 */

import { truePeakInterpolator, type TruePeakInterpolator } from "./loudness.js";

/** The safety ceiling of an export's mix, dBTP (what streaming platforms and `master_audio_tool`'s social preset ask). */
export const EXPORT_TRUE_PEAK_DBTP = -1;

/**
 * Lossy codecs (AAC, MP3, Opus) overshoot their input by up to a dB on
 * limited material, and the file is what gets measured: aim this far under
 * the ceiling before them.
 */
export const CODEC_HEADROOM_DB = 1;

/** Time the gain takes to dip before a peak, seconds (ffmpeg alimiter's default attack). */
export const LIMITER_LOOKAHEAD_SECONDS = 0.005;
/** Time constant of the gain's recovery after a peak, seconds. */
export const LIMITER_RELEASE_SECONDS = 0.05;

/** The level the limiter holds an export under, dBTP: lower for a lossy codec. */
export function exportCeilingDb(lossy: boolean): number {
  return EXPORT_TRUE_PEAK_DBTP - (lossy ? CODEC_HEADROOM_DB : 0);
}

/** The limiter aims this far under its ceiling, dB. */
const AIM_UNDER_DB = 0.01;

export interface LimiterOptions {
  sampleRate: number;
  channels: number;
  /** True-peak ceiling, dBTP. */
  ceilingDb: number;
  lookaheadSeconds?: number;
  releaseSeconds?: number;
}

/** A streaming, channel-linked lookahead true-peak limiter over planar float PCM. */
export class TruePeakLimiter {
  /** Samples between an input and its output. */
  readonly latency: number;
  private readonly ceiling: number;
  private readonly interp: TruePeakInterpolator;
  /** Samples read past a point to interpolate it. */
  private readonly reach: number;
  /** Samples read before a point to interpolate it. */
  private readonly back: number;
  private readonly lookahead: number;
  private readonly release: number;
  private readonly mask: number;
  private readonly ring: Float32Array[];
  /** Hold-and-release gain of the last `lookahead + 1` points, for the average. */
  private readonly held: Float64Array;
  /** Monotonic deque of (point, needed gain) for the running minimum. */
  private readonly minAt: Float64Array;
  private readonly minGain: Float64Array;
  private minHead = 0;
  private minTail = 0;
  private heldSum: number;
  private lastHeld = 1;
  private lastPeak = 0;
  /** Last input sample loud enough that interpolation could pass the ceiling. */
  private lastLoud = Number.NEGATIVE_INFINITY;
  private received = 0;
  private emitted = 0;

  constructor(options: LimiterOptions) {
    const { sampleRate, channels } = options;
    if (!(sampleRate > 0) || !(channels >= 1)) throw new RangeError("a limiter needs a positive sample rate and at least one channel");
    // A hair under: the gain moves inside an interpolation window, and the output is float32.
    this.ceiling = 10 ** ((options.ceilingDb - AIM_UNDER_DB) / 20);
    this.interp = truePeakInterpolator(sampleRate);
    this.reach = this.interp.factor === 1 ? 0 : this.interp.taps >> 1;
    this.back = this.interp.factor === 1 ? 0 : this.interp.taps - this.reach - 1;
    this.lookahead = Math.max(1, Math.round((options.lookaheadSeconds ?? LIMITER_LOOKAHEAD_SECONDS) * sampleRate));
    this.release = Math.exp(-1 / (Math.max(1e-4, options.releaseSeconds ?? LIMITER_RELEASE_SECONDS) * sampleRate));
    this.latency = this.reach + this.lookahead;
    let size = 1;
    while (size < this.latency + 2 * this.interp.taps + 2) size <<= 1;
    this.mask = size - 1;
    this.ring = Array.from({ length: channels }, () => new Float32Array(size));
    this.held = new Float64Array(size).fill(1);
    this.heldSum = this.lookahead + 1;
    this.minAt = new Float64Array(size);
    this.minGain = new Float64Array(size);
  }

  /** Limit the next samples (one array per channel, equal lengths). Returns the delayed output they complete. */
  process(input: readonly Float32Array[]): Float32Array[] {
    if (input.length !== this.ring.length) throw new RangeError(`expected ${this.ring.length} channels, got ${input.length}`);
    const length = input[0]?.length ?? 0;
    if (input.some((c) => c.length !== length)) throw new RangeError("channels must have equal lengths");
    return this.run(input, length);
  }

  /** The last `latency` samples (or fewer, if less went in), fed with silence. */
  flush(): Float32Array[] {
    const pending = Math.min(this.latency, this.received - this.emitted);
    const silence = this.ring.map(() => new Float32Array(this.latency));
    return this.run(silence, this.latency).map((c) => c.subarray(0, pending));
  }

  private run(input: readonly Float32Array[], length: number): Float32Array[] {
    const outLength = Math.max(0, Math.min(length, this.received + length - this.latency - this.emitted));
    const out = this.ring.map(() => new Float32Array(outLength));
    let written = 0;
    const loud = this.ceiling / this.interp.gain;
    for (let i = 0; i < length; i += 1) {
      const j = this.received;
      this.received += 1;
      for (let c = 0; c < this.ring.length; c += 1) {
        const x = input[c]![i]!;
        this.ring[c]![j & this.mask] = x;
        if (Math.abs(x) > loud) this.lastLoud = j;
      }
      const n = j - this.reach;
      if (n < 0) continue;
      const peak = this.lastLoud >= n - this.back ? this.peakAt(n) : 0;
      // The segment on either side of a sample can carry its interpolated peak.
      const needed = Math.min(1, this.ceiling / Math.max(peak, this.lastPeak, 1e-30));
      this.lastPeak = peak;
      while (this.minTail > this.minHead && this.minGain[(this.minTail - 1) & this.mask]! >= needed) this.minTail -= 1;
      this.minAt[this.minTail & this.mask] = n;
      this.minGain[this.minTail & this.mask] = needed;
      this.minTail += 1;
      while (this.minAt[this.minHead & this.mask]! < n - this.lookahead) this.minHead += 1;
      const minimum = this.minGain[this.minHead & this.mask]!;
      const held = Math.min(minimum, 1 - (1 - this.lastHeld) * this.release);
      this.lastHeld = held;
      this.heldSum += held - this.held[(n - this.lookahead - 1) & this.mask]!;
      this.held[n & this.mask] = held;
      const o = n - this.lookahead;
      if (o < this.emitted) continue;
      // The running sum drifts by rounding; never let it lift the gain over unity.
      const gain = Math.min(1, this.heldSum / (this.lookahead + 1));
      for (let c = 0; c < this.ring.length; c += 1) out[c]![written] = this.ring[c]![o & this.mask]! * gain;
      written += 1;
      this.emitted += 1;
    }
    return out;
  }

  /** Largest magnitude around sample `n` (itself and the points after it), over channels. */
  private peakAt(n: number): number {
    const { phases, taps } = this.interp;
    let peak = 0;
    for (const channel of this.ring) {
      peak = Math.max(peak, Math.abs(channel[n & this.mask]!));
      for (let p = 1; p < phases.length; p += 1) {
        const branch = phases[p]!;
        let y = 0;
        for (let k = 0; k < taps; k += 1) y += branch[k]! * channel[(n - k + this.reach) & this.mask]!;
        peak = Math.max(peak, Math.abs(y));
      }
    }
    return peak;
  }
}

/** Limit a whole planar mix at once (same length out). */
export function limitTruePeak(channels: readonly Float32Array[], options: Omit<LimiterOptions, "channels">): Float32Array[] {
  const limiter = new TruePeakLimiter({ ...options, channels: channels.length });
  const head = limiter.process(channels);
  const tail = limiter.flush();
  return head.map((c, i) => {
    const out = new Float32Array(c.length + tail[i]!.length);
    out.set(c);
    out.set(tail[i]!, c.length);
    return out;
  });
}
