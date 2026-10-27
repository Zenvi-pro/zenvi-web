/**
 * Signal primitives of the Zenvi Sound Score (zenvi-motion sound/METRICS.md
 * section 0), ported from its reference implementation
 * `scripts/sound_score.py`: the 50 ms RMS envelope, spectral-flux onset
 * strength, long-term octave bands, band power per 100 ms, the phone
 * simulation, the spectral centroid. Pure functions over planar float PCM at
 * any sample rate; loudness itself is ./loudness.ts.
 */

import { RealFft } from "../render/audio/fft.js";
import type { Biquad } from "./loudness.js";

/** Envelope and onset hop, seconds (librosa `hop_length` 480 at 48 kHz). */
export const ENVELOPE_HOP = 0.01;
/** dB floor of envelopes (librosa's 1e-6 amplitude floor). */
export const FLOOR_DB = -120;

/** Average of the channels. */
export function monoOf(channels: readonly Float32Array[]): Float32Array {
  const length = channels.reduce((n, c) => Math.max(n, c.length), 0);
  const out = new Float32Array(length);
  if (channels.length === 0) return out;
  for (const channel of channels) for (let i = 0; i < channel.length; i += 1) out[i]! += channel[i]!;
  for (let i = 0; i < length; i += 1) out[i]! /= channels.length;
  return out;
}

/** Sample-wise sum of several planar signals (missing channels and samples count as silence). */
export function sumOf(signals: readonly (readonly Float32Array[])[], length: number, channels = 2): Float32Array[] {
  const out = Array.from({ length: channels }, () => new Float32Array(length));
  for (const signal of signals) {
    for (let c = 0; c < channels; c += 1) {
      const src = signal[Math.min(c, signal.length - 1)];
      if (!src) continue;
      const n = Math.min(length, src.length);
      for (let i = 0; i < n; i += 1) out[c]![i]! += src[i]!;
    }
  }
  return out;
}

/** a - b, sample-wise, planar. */
export function differenceOf(a: readonly Float32Array[], b: readonly Float32Array[]): Float32Array[] {
  return a.map((channel, c) => {
    const other = b[Math.min(c, b.length - 1)];
    const out = Float32Array.from(channel);
    if (other) for (let i = 0; i < Math.min(out.length, other.length); i += 1) out[i]! -= other[i]!;
    return out;
  });
}

/**
 * 50 ms RMS in dBFS every 10 ms, frames centred on `i * hop` with zero
 * padding (`librosa.feature.rms(frame_length=0.05 sr, hop_length=0.01 sr)`).
 */
export function rmsEnvelopeDb(mono: Float32Array, sampleRate: number, frameSeconds = 0.05): Float64Array {
  const hop = Math.max(1, Math.round(ENVELOPE_HOP * sampleRate));
  const frame = Math.max(1, Math.round(frameSeconds * sampleRate));
  const count = 1 + Math.floor(mono.length / hop);
  const prefix = new Float64Array(mono.length + 1);
  for (let i = 0; i < mono.length; i += 1) prefix[i + 1] = prefix[i]! + mono[i]! * mono[i]!;
  const out = new Float64Array(count);
  const half = frame >> 1;
  for (let k = 0; k < count; k += 1) {
    const lo = Math.max(0, k * hop - half);
    const hi = Math.min(mono.length, k * hop - half + frame);
    const energy = hi > lo ? (prefix[hi]! - prefix[lo]!) / frame : 0;
    const rms = Math.sqrt(Math.max(0, energy));
    out[k] = 20 * Math.log10(Math.max(rms, 1e-6));
  }
  return out;
}

function hann(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i += 1) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return w;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Spectral-flux onset strength every 10 ms (librosa `onset_strength`): the
 * mean over 64 log-spaced bands (40 Hz-16 kHz, librosa uses 128 mels) of the
 * positive frame-to-frame rise of the band level in dB, top 80 dB. Frame k is
 * the ~43 ms window that ends at `k * hop`, which is where librosa's
 * centred frames land after its `n_fft / (2 hop)` lag compensation, so a
 * transient reads at its own time, not a half-window early.
 */
export function onsetStrength(mono: Float32Array, sampleRate: number): Float64Array {
  const hop = Math.max(1, Math.round(ENVELOPE_HOP * sampleRate));
  const size = nextPow2(Math.round(0.0427 * sampleRate));
  const fft = new RealFft(size);
  const window = hann(size);
  const bins = size / 2 + 1;
  const bands = 64;
  const lo = Math.log(40);
  const hi = Math.log(Math.min(16000, sampleRate / 2));
  const bandOf = new Int16Array(bins).fill(-1);
  for (let b = 0; b < bins; b += 1) {
    const f = (b * sampleRate) / size;
    if (f < 40 || f > Math.exp(hi)) continue;
    bandOf[b] = Math.min(bands - 1, Math.floor(((Math.log(f) - lo) / (hi - lo)) * bands));
  }
  const count = 1 + Math.floor(mono.length / hop);
  const levels: Float64Array[] = [];
  const frame = new Float32Array(size);
  const re = new Float32Array(bins);
  const im = new Float32Array(bins);
  let top = -Infinity;
  for (let k = 0; k < count; k += 1) {
    const end = k * hop;
    for (let i = 0; i < size; i += 1) {
      const at = end - size + i;
      frame[i] = at >= 0 && at < mono.length ? mono[at]! * window[i]! : 0;
    }
    fft.forward(frame, re, im);
    const power = new Float64Array(bands);
    for (let b = 0; b < bins; b += 1) {
      const band = bandOf[b]!;
      if (band >= 0) power[band]! += re[b]! * re[b]! + im[b]! * im[b]!;
    }
    for (let b = 0; b < bands; b += 1) {
      power[b] = 10 * Math.log10(Math.max(power[b]!, 1e-10));
      top = Math.max(top, power[b]!);
    }
    levels.push(power);
  }
  const floor = top - 80;
  const out = new Float64Array(count);
  for (let k = 1; k < count; k += 1) {
    let sum = 0;
    for (let b = 0; b < bands; b += 1) sum += Math.max(0, Math.max(floor, levels[k]![b]!) - Math.max(floor, levels[k - 1]![b]!));
    out[k] = sum / bands;
  }
  return out;
}

/** Octave centres of the F1 spectral-balance check, Hz. */
export const OCTAVE_CENTRES = [63, 250, 1000, 2000, 4000, 8000] as const;

export interface Spectrum {
  /** Long-term octave band power, dB re the total (`sound_score.octave_bands`). */
  bandsDb: Record<(typeof OCTAVE_CENTRES)[number], number>;
  /** RMS-weighted spectral centroid, Hz. */
  centroidHz: number;
}

/**
 * Welch's averaged periodogram (8192-point Hann frames, 50 % overlap, like
 * `scipy.signal.welch(nperseg=8192)`) summed per octave [c/1.414, c*1.414),
 * and the centroid of 2048-point frames weighted by each frame's RMS
 * (librosa's `spectral_centroid` and `rms` with hop 512).
 */
export function spectrumOf(mono: Float32Array, sampleRate: number): Spectrum {
  const size = mono.length >= 8192 ? 8192 : Math.max(16, nextPow2(mono.length) >> 1);
  const welch = welchPower(mono, size);
  let total = 1e-20;
  for (const p of welch) total += p;
  const bandsDb = {} as Spectrum["bandsDb"];
  for (const c of OCTAVE_CENTRES) {
    let sum = 0;
    for (let b = 0; b < welch.length; b += 1) {
      const f = (b * sampleRate) / size;
      if (f >= c / 1.414 && f < c * 1.414) sum += welch[b]!;
    }
    bandsDb[c] = 10 * Math.log10(sum / total + 1e-12);
  }
  return { bandsDb, centroidHz: centroid(mono, sampleRate) };
}

function welchPower(mono: Float32Array, size: number): Float64Array {
  const fft = new RealFft(size);
  const window = hann(size);
  const bins = size / 2 + 1;
  const out = new Float64Array(bins);
  const frame = new Float32Array(size);
  const re = new Float32Array(bins);
  const im = new Float32Array(bins);
  const step = size >> 1;
  for (let start = 0; start === 0 || start + size <= mono.length; start += step) {
    let mean = 0;
    for (let i = 0; i < size; i += 1) mean += mono[start + i] ?? 0;
    mean /= size;
    // scipy detrends each segment ('constant') before windowing.
    for (let i = 0; i < size; i += 1) frame[i] = ((mono[start + i] ?? 0) - mean) * window[i]!;
    fft.forward(frame, re, im);
    for (let b = 0; b < bins; b += 1) out[b]! += re[b]! * re[b]! + im[b]! * im[b]!;
  }
  return out;
}

function centroid(mono: Float32Array, sampleRate: number): number {
  const size = 2048;
  const hop = 512;
  const fft = new RealFft(size);
  const window = hann(size);
  const bins = size / 2 + 1;
  const frame = new Float32Array(size);
  const re = new Float32Array(bins);
  const im = new Float32Array(bins);
  let weighted = 0;
  let weights = 1e-12;
  for (let centre = 0; centre <= mono.length; centre += hop) {
    let energy = 0;
    for (let i = 0; i < size; i += 1) {
      const x = mono[centre - size / 2 + i] ?? 0;
      energy += x * x;
      frame[i] = x * window[i]!;
    }
    fft.forward(frame, re, im);
    let num = 0;
    let den = 0;
    for (let b = 0; b < bins; b += 1) {
      const magnitude = Math.hypot(re[b]!, im[b]!);
      num += ((b * sampleRate) / size) * magnitude;
      den += magnitude;
    }
    const rms = Math.sqrt(energy / size);
    if (den > 0) weighted += (num / den) * rms;
    weights += rms;
  }
  return weighted / weights;
}

/** Second-order section of a Butterworth low- or high-pass (bilinear, pre-warped: what `scipy.signal.butter` designs). */
function butterSection(kind: "low" | "high", frequency: number, q: number, sampleRate: number): Biquad {
  const k = Math.tan((Math.PI * Math.min(frequency, sampleRate * 0.49)) / sampleRate);
  const norm = 1 / (1 + k / q + k * k);
  const a: [number, number] = [2 * (k * k - 1) * norm, (1 - k / q + k * k) * norm];
  if (kind === "low") return { b: [k * k * norm, 2 * k * k * norm, k * k * norm], a };
  return { b: [norm, -2 * norm, norm], a };
}

/** The two sections of a 4th-order Butterworth (poles at Q 0.541 and 1.307). */
export function butter4(kind: "low" | "high", frequency: number, sampleRate: number): Biquad[] {
  return [0.5411961001461969, 1.3065629648763766].map((q) => butterSection(kind, frequency, q, sampleRate));
}

/** Run biquads in series over a copy of `x`. */
export function filterSeries(x: Float32Array, sections: readonly Biquad[]): Float32Array {
  const out = Float32Array.from(x);
  for (const { b, a } of sections) {
    let z1 = 0;
    let z2 = 0;
    for (let i = 0; i < out.length; i += 1) {
      const input = out[i]!;
      const y = b[0] * input + z1;
      z1 = b[1] * input - a[0] * y + z2;
      z2 = b[2] * input - a[1] * y;
      out[i] = y;
    }
  }
  return out;
}

type Complex = [number, number];
const cdiv = (a: Complex, b: Complex): Complex => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const csqrt = ([re, im]: Complex): Complex => {
  const m = Math.hypot(re, im);
  const r = Math.sqrt((m + re) / 2);
  const i = Math.sqrt(Math.max(0, (m - re) / 2));
  return [r, im < 0 ? -i : i];
};

/**
 * `scipy.signal.butter(order, [lo, hi], btype="band", fs=sampleRate)` as
 * second-order sections: the analog Butterworth prototype, `lp2bp_zpk`,
 * then `bilinear_zpk` (pre-warped edges). Each section pairs one conjugate
 * pole pair with a zero at z = 1 and one at z = -1; the gain rides on the
 * first section.
 */
export function butterBandpass(order: number, lo: number, hi: number, sampleRate: number): Biquad[] {
  const fs2 = 4; // scipy normalises to fs = 2, bilinear uses 2 * fs.
  const warp = (f: number): number => 2 * 2 * Math.tan((Math.PI * Math.min(f, sampleRate * 0.49)) / sampleRate);
  const w1 = warp(lo);
  const w2 = warp(hi);
  const bw = w2 - w1;
  const wo2 = w1 * w2;
  const poles: Complex[] = [];
  for (let m = -order + 1; m < order; m += 2) {
    const angle = (Math.PI * m) / (2 * order);
    const p: Complex = [-Math.cos(angle) * (bw / 2), -Math.sin(angle) * (bw / 2)];
    const root = csqrt([p[0] * p[0] - p[1] * p[1] - wo2, 2 * p[0] * p[1]]);
    poles.push([p[0] + root[0], p[1] + root[1]], [p[0] - root[0], p[1] - root[1]]);
  }
  // k_z = bw^N * prod(fs2 - z) / prod(fs2 - p), with N zeros at s = 0.
  let gain: Complex = [bw ** order * fs2 ** order, 0];
  const digital = poles.map((p) => {
    gain = cdiv(gain, [fs2 - p[0], -p[1]]);
    return cdiv([fs2 + p[0], p[1]], [fs2 - p[0], -p[1]]);
  });
  const upper = digital.filter((p) => p[1] > 1e-12).sort((a, b) => a[0] - b[0]);
  return upper.map((p, i) => {
    const g = i === 0 ? gain[0] : 1;
    return { b: [g, 0, -g], a: [-2 * p[0], p[0] * p[0] + p[1] * p[1]] } as Biquad;
  });
}

/** Power in [lo, hi] Hz per `frameSeconds` frame, dB (`sound_score.band_power`: a 4th-order Butterworth band-pass). */
export function bandPowerDb(mono: Float32Array, sampleRate: number, lo: number, hi: number, frameSeconds = 0.1): Float64Array {
  const y = filterSeries(mono, butterBandpass(4, lo, hi, sampleRate));
  const frame = Math.max(1, Math.round(frameSeconds * sampleRate));
  const count = Math.floor(y.length / frame);
  const out = new Float64Array(count);
  for (let k = 0; k < count; k += 1) {
    let sum = 0;
    for (let i = k * frame; i < (k + 1) * frame; i += 1) sum += y[i]! * y[i]!;
    out[k] = 10 * Math.log10(Math.max(sum / frame, 1e-12));
  }
  return out;
}

/** A phone speaker: mono, 4th-order high-pass at 300 Hz and low-pass at 12 kHz (METRICS.md P1). */
export function phoneOf(channels: readonly Float32Array[], sampleRate: number): Float32Array {
  return filterSeries(monoOf(channels), [...butter4("high", 300, sampleRate), ...butter4("low", 12000, sampleRate)]);
}

/** Median (0 for an empty list). */
export function median(values: ArrayLike<number>): number {
  return percentile(values, 50);
}

/** Linear-interpolated percentile, numpy's default. */
export function percentile(values: ArrayLike<number>, q: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const x = (q / 100) * (sorted.length - 1);
  const lo = Math.floor(x);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (x - lo);
}
