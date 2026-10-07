/**
 * AudioVisualization's audio analysis, ported from libopenshot 1.0
 * src/effects/AudioVisualization.cpp:194-378, plus the float/double
 * arithmetic helpers the kernel shares.
 *
 * Every expression follows the arm64 build (`scratchpad/disfn.sh
 * 18AudioVisualization8GetFrame` and the `spectrum_bins` / `reactive_level`
 * helpers): `fmaf` where clang fused a float multiply-add, `fma` where it
 * fused a double one (`fma`: the DFT recurrence, the ring and bar geometry), plain
 * rounding elsewhere. Only this frame's samples are analysed; the smoothing
 * is across buckets/bins, never across frames.
 */

import { fma, fmaf } from "../qt/fma.js";
import type { KernelAudio } from "../types.js";

export const f32 = Math.fround;

/** The effect's `clampf`: `std::max(lo, std::min(hi, v))` (:42-44). */
export function clampf(v: number, lo: number, hi: number): number {
  const m = v < hi ? v : hi;
  return lo < m ? m : lo;
}

/** The effect's `clampi` (:46-48). */
export function clampi(v: number, lo: number, hi: number): number {
  const m = v < hi ? v : hi;
  return lo < m ? m : lo;
}

/** `std::lround` / `fcvtas`: nearest integer, halves away from zero. */
export function lround(v: number): number {
  return v < 0 ? -Math.floor(-v + 0.5) : Math.floor(v + 0.5);
}

// ---------------------------------------------------------------------------
// Frequencies (:194-214)
// ---------------------------------------------------------------------------

/** `normalized_frequency_to_hz`: values above 1 are Hz already; high side never below 21 Hz. */
export function normalizedFrequencyToHz(value: number, highFrequency: boolean): number {
  if (value > 1) return value;
  const normalized = clampf(value, 0, 1);
  if (highFrequency && normalized <= 0) return 21;
  return f32(20 * f32(Math.pow(1000, normalized)));
}

// ---------------------------------------------------------------------------
// Buckets (:216-281)
// ---------------------------------------------------------------------------

function sampleCount(audio: KernelAudio | undefined): number {
  return audio && audio.channels.length > 0 ? audio.channels[0]!.length : 0;
}

/** The number of audio samples this frame carries (`GetAudioSamplesCount`). */
export function frameSampleCount(audio: KernelAudio | undefined): number {
  return sampleCount(audio);
}

/**
 * `channel_samples` / `combined_samples`: `max(2, wanted)` buckets, each the
 * signed sample of largest magnitude (combined: of the channel mean), scaled,
 * clamped to ±1, then `v = fma(prev, smooth, scaled * (1 - smooth))`.
 * `channel` < 0 means combined.
 */
export function bucketSamples(audio: KernelAudio | undefined, channel: number, wanted: number, gain: number, smooth: number): Float32Array {
  const size = Math.max(2, wanted);
  const values = new Float32Array(size);
  const samples = sampleCount(audio);
  const channels = audio ? audio.channels.length : 0;
  if (!audio || samples <= 0 || channels <= 0) return values;
  const oneMinusSmooth = f32(1 - smooth);
  const data = channel >= 0 ? audio.channels[clampi(channel, 0, channels - 1)]! : null;
  let previous = 0;
  for (let i = 0; i < size; i += 1) {
    const start = Math.floor((i * samples) / size);
    const end = Math.max(start + 1, Math.trunc(((i + 1) * samples) / size));
    let peak = 0;
    let peakMagnitude = 0;
    for (let s = start; s < end && s < samples; s += 1) {
      let value: number;
      if (data) value = data[s]!;
      else {
        let mixed = 0;
        for (let c = 0; c < channels; c += 1) mixed = f32(mixed + audio.channels[c]![s]!);
        value = f32(mixed / channels);
      }
      const magnitude = Math.abs(value);
      if (magnitude > peakMagnitude) {
        peak = value;
        peakMagnitude = magnitude;
      }
    }
    const scaled = clampf(f32(gain * peak), -1, 1);
    previous = fmaf(previous, smooth, f32(oneMinusSmooth * scaled));
    values[i] = previous;
  }
  return values;
}

// ---------------------------------------------------------------------------
// Levels (:283-315)
// ---------------------------------------------------------------------------

/**
 * `reactive_level`: `powf(clamp(max(rms*3.6, peak*1.15)*gain, 0, 1), 0.55)`
 * over one channel (`channel` >= 0) or all of them. The RMS is a double
 * square root.
 */
export function reactiveLevel(audio: KernelAudio | undefined, channel: number, gain: number): number {
  const samples = sampleCount(audio);
  const channels = audio ? audio.channels.length : 0;
  if (!audio || samples <= 0 || channels <= 0) return 0;
  const first = channel >= 0 ? clampi(channel, 0, channels - 1) : 0;
  const last = channel >= 0 ? first + 1 : channels;
  let total = 0;
  let peak = 0;
  for (let c = first; c < last; c += 1) {
    const data = audio.channels[c]!;
    for (let i = 0; i < samples; i += 1) {
      const magnitude = Math.abs(data[i]!);
      total += f32(magnitude * magnitude);
      if (peak < magnitude) peak = magnitude;
    }
  }
  const rms = f32(Math.sqrt(total / (samples * (last - first))));
  const a = f32(rms * f32(3.6));
  const b = f32(peak * f32(1.15));
  const mixed = a < b ? b : a;
  return f32(Math.pow(clampf(f32(gain * mixed), 0, 1), f32(0.55)));
}

/** `band_level`: mean of `bins[lround(start*n) .. lround(end*n))`, clamped to 0..1. */
export function bandLevel(bins: Float32Array, start: number, end: number): number {
  const n = bins.length;
  if (n === 0) return 0;
  const first = clampi(lround(f32(start * n)), 0, n - 1);
  const last = clampi(lround(f32(end * n)), first + 1, n);
  let total = 0;
  for (let i = first; i < last; i += 1) total = f32(total + bins[i]!);
  return clampf(f32(total / (last - first)), 0, 1);
}

// ---------------------------------------------------------------------------
// Spectrum (:317-378)
// ---------------------------------------------------------------------------

const TWO_PI = 2 * Math.PI;

/**
 * `spectrum_bins`: Hann-windowed mono mix of the first `min(S, 2048)`
 * samples, one single-frequency DFT per log-spaced bin by complex rotation
 * (fused double recurrences), `|X|/N * gain * 8` clamped, then the
 * cross-bin IIR. Zeros when the frame has 4 samples or fewer.
 */
export function spectrumBins(audio: KernelAudio | undefined, bins: number, gain: number, smooth: number, lowHz: number, highHz: number): Float32Array {
  const size = Math.max(2, bins);
  const result = new Float32Array(size);
  const samples = sampleCount(audio);
  const channels = audio ? audio.channels.length : 0;
  if (!audio || samples <= 4 || channels <= 0) return result;
  const sampleRate = Math.max(1, Math.trunc(audio.sampleRate));
  const n = Math.min(samples, 2048);
  const nyquist = f32(sampleRate * 0.5);
  const low = clampf(lowHz, 1, nyquist);
  const high = clampf(highHz, f32(low + 1), nyquist);

  const windowed = new Float64Array(n);
  for (let s = 0; s < n; s += 1) {
    let mixed = 0;
    for (let c = 0; c < channels; c += 1) mixed = f32(mixed + audio.channels[c]![s]!);
    mixed = f32(mixed / channels);
    // 0.5 - 0.5*cos(...) is fused, but the product by -0.5 is exact.
    const window = 0.5 - 0.5 * Math.cos((TWO_PI * s) / (n - 1));
    windowed[s] = window * mixed;
  }

  const magnitudes = new Float32Array(size);
  const ratio = f32(high / low);
  for (let bin = 0; bin < size; bin += 1) {
    const t = f32(f32(bin + 0.5) / size);
    const hz = f32(low * f32(Math.pow(ratio, t)));
    const phaseDelta = (TWO_PI * hz) / sampleRate;
    const stepReal = Math.cos(phaseDelta);
    const stepImag = Math.sin(phaseDelta);
    const negStepImag = -stepImag;
    let phaseReal = 1;
    let phaseImag = 0;
    let real = 0;
    let imag = 0;
    for (let s = 0; s < n; s += 1) {
      const value = windowed[s]!;
      real = fma(value, phaseReal, real);
      imag = fma(-value, phaseImag, imag);
      const nextImag = fma(phaseReal, stepImag, stepReal * phaseImag);
      phaseReal = fma(phaseReal, stepReal, phaseImag * negStepImag);
      phaseImag = nextImag;
    }
    const magnitude = (((Math.sqrt(fma(real, real, imag * imag)) / n) * gain) * 8);
    magnitudes[bin] = clampf(f32(magnitude), 0, 1);
  }

  const oneMinusSmooth = f32(1 - smooth);
  let previous = 0;
  for (let bin = 0; bin < size; bin += 1) {
    previous = fmaf(previous, smooth, f32(oneMinusSmooth * magnitudes[bin]!));
    result[bin] = previous;
  }
  return result;
}

// ---------------------------------------------------------------------------
// std::mt19937 + uniform_real_distribution<float> (libc++)
// ---------------------------------------------------------------------------

/**
 * The first draws of `std::mt19937(seed)` mapped by libc++'s
 * `uniform_real_distribution<float>(0, 1)`: one engine call per draw,
 * `float(u32) / 2^32` (so 1.0 is possible). Output k only needs state words
 * k, k+1 and k+397, so the state is seeded up to the last word needed.
 */
export function mt19937Floats(seed: number, count: number): number[] {
  const words = 397 + count + 1;
  const mt = new Uint32Array(words);
  mt[0] = seed >>> 0;
  for (let i = 1; i < words; i += 1) {
    const prev = mt[i - 1]!;
    mt[i] = (Math.imul(1812433253, (prev ^ (prev >>> 30)) >>> 0) + i) >>> 0;
  }
  const out: number[] = [];
  for (let k = 0; k < count; k += 1) {
    const yp = ((mt[k]! & 0x80000000) | (mt[k + 1]! & 0x7fffffff)) >>> 0;
    const x = (mt[k + 397]! ^ (yp >>> 1) ^ (yp & 1 ? 0x9908b0df : 0)) >>> 0;
    let z = (x ^ (x >>> 11)) >>> 0;
    z = (z ^ ((z << 7) & 0x9d2c5680)) >>> 0;
    z = (z ^ ((z << 15) & 0xefc60000)) >>> 0;
    z = (z ^ (z >>> 18)) >>> 0;
    out.push(f32(z) / 4294967296);
  }
  return out;
}
