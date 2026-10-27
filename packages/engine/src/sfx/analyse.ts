/**
 * The numbers a recorded kit sound carries (LIBRARIES.md §5.2, DEPLOY S5.2):
 * where its sound starts, peaks and dies away, how loud it is, how bright,
 * how much of it is sub, whether it is really stereo, and the faults that
 * keep it out of the kit (a noise floor that never ends, clipped tops).
 * The kit generator measures every sound with this, so the same numbers
 * drive placement, levels and search. Pure.
 */

import { RealFft } from "../render/audio/fft.js";
import { measureLoudness } from "../mastering/loudness.js";

export interface KitAnalysis {
  /** First sample within 30 dB of the peak sample, ms from the file's start. */
  onsetMs: number;
  /** Centre of the loudest 50 ms RMS window, ms from the file's start (a whoosh's peak goes on the cut). */
  peakMs: number;
  /** Last 10 ms frame within 50 dB of the loudest one (or 6 dB over the floor), ms from the file's start. */
  endMs: number;
  /** Onset to the first sample within 3 dB of the peak sample, ms: a hit's attack is a few ms, a swell's a second. */
  attackMs: number;
  /** BS.1770 loudness of the sound (onset to end, padded to one 400 ms block), LUFS. */
  lufs: number;
  /** Loudest 400 ms block, LUFS. */
  lufsMax: number;
  truePeakDb: number;
  /** Peak sample over the RMS of onset..end, dB. */
  crestDb: number;
  /** Power-weighted mean frequency of onset..end, Hz. */
  centroidHz: number;
  /** Share of onset..end's power below 150 Hz, 0..1 (the part a phone does not play). */
  lowShare: number;
  /** Share of onset..end's power above 10 kHz, dB: a source made at 22 kHz or less reads under -70. */
  airDb: number;
  /**
   * The file's floor: the quieter of its head (before the onset) and its
   * last 30 ms, dB under the loudest 10 ms. Hiss or hum keeps it high; a
   * clean one-shot fades under -50.
   */
  noiseFloorDb: number;
  /** The last 30 ms, dB under the loudest 10 ms: over -30 the recording was cut before its tail died away. */
  tailDb: number;
  /** Runs of 3+ consecutive samples at or above 0.98 full scale. */
  clippedRuns: number;
  /** Side over mid power, dB: under -30 is mono in all but name. */
  sideDb: number;
  channels: number;
}

const db = (power: number): number => (power > 0 ? 10 * Math.log10(power) : -200);

/** Mean power of `mono` in consecutive frames of `size` samples. */
function framePowers(mono: Float32Array, size: number): Float64Array {
  const count = Math.max(1, Math.floor(mono.length / size));
  const out = new Float64Array(count);
  for (let f = 0; f < count; f += 1) {
    let sum = 0;
    const end = Math.min(mono.length, (f + 1) * size);
    for (let i = f * size; i < end; i += 1) sum += mono[i]! * mono[i]!;
    out[f] = sum / Math.max(1, end - f * size);
  }
  return out;
}

/** Spectral centroid, sub share and air of `mono`, from 2048-point Hann frames. */
function spectrum(mono: Float32Array, sampleRate: number): { centroidHz: number; lowShare: number; airDb: number } {
  const n = 2048;
  const fft = new RealFft(n);
  const frame = new Float32Array(n);
  const re = new Float32Array(n / 2 + 1);
  const im = new Float32Array(n / 2 + 1);
  const bins = new Float64Array(n / 2 + 1);
  const window = Float32Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  for (let start = 0; start < Math.max(1, mono.length - n / 2); start += n / 2) {
    for (let i = 0; i < n; i += 1) frame[i] = (mono[start + i] ?? 0) * window[i]!;
    fft.forward(frame, re, im);
    for (let k = 0; k < bins.length; k += 1) bins[k]! += re[k]! * re[k]! + im[k]! * im[k]!;
  }
  const hz = sampleRate / n;
  let total = 0;
  let weighted = 0;
  let low = 0;
  let air = 0;
  for (let k = 1; k < bins.length; k += 1) {
    total += bins[k]!;
    weighted += bins[k]! * k * hz;
    if (k * hz < 150) low += bins[k]!;
    if (k * hz > 10_000) air += bins[k]!;
  }
  if (total <= 0) return { centroidHz: 0, lowShare: 0, airDb: -200 };
  return { centroidHz: weighted / total, lowShare: low / total, airDb: db(air / total) };
}

/** Measure one decoded sound (planar channels of equal length, one or two). */
export function analyseKitSound(channels: readonly Float32Array[], sampleRate: number): KitAnalysis {
  if (channels.length === 0 || channels[0]!.length === 0) throw new RangeError("analyseKitSound needs samples");
  const length = channels[0]!.length;
  const left = channels[0]!;
  const right = channels[1] ?? left;
  const mono = new Float32Array(length);
  let peakAbs = 0;
  let peakAt = 0;
  let clippedRuns = 0;
  let run = 0;
  let mid = 0;
  let side = 0;
  for (let i = 0; i < length; i += 1) {
    const l = left[i]!;
    const r = right[i]!;
    mono[i] = 0.5 * (l + r);
    mid += (0.5 * (l + r)) ** 2;
    side += (0.5 * (l - r)) ** 2;
    const a = Math.max(Math.abs(l), Math.abs(r));
    if (a > peakAbs) {
      peakAbs = a;
      peakAt = i;
    }
    if (a >= 0.98) {
      run += 1;
      if (run === 3) clippedRuns += 1;
    } else run = 0;
  }
  const ms = (samples: number): number => (samples / sampleRate) * 1000;
  const onsetThreshold = peakAbs * 10 ** (-30 / 20);
  const attackThreshold = peakAbs * 10 ** (-3 / 20);
  let onset = 0;
  while (onset < length && Math.max(Math.abs(left[onset]!), Math.abs(right[onset]!)) < onsetThreshold) onset += 1;
  let attack = onset;
  while (attack < peakAt && Math.max(Math.abs(left[attack]!), Math.abs(right[attack]!)) < attackThreshold) attack += 1;

  const tenMs = Math.max(1, Math.round(sampleRate * 0.01));
  const frames = framePowers(mono, tenMs);
  const loudest = frames.reduce((m, v) => Math.max(m, v), 0);
  const mean = (from: number, to: number): number => {
    let sum = 0;
    for (let f = from; f < to; f += 1) sum += frames[f]!;
    return to > from ? sum / (to - from) : Number.POSITIVE_INFINITY;
  };
  const tail = mean(Math.max(0, frames.length - 3), frames.length);
  // The head counts only when there are 20 ms of it: a tightly trimmed file has none.
  const headFrames = Math.floor(onset / tenMs) - 1;
  const floor = Math.min(tail, headFrames >= 2 ? mean(0, headFrames) : Number.POSITIVE_INFINITY);
  const endThreshold = Math.max(loudest * 10 ** (-50 / 10), floor * 10 ** (6 / 10));
  let lastFrame = frames.length - 1;
  while (lastFrame > 0 && frames[lastFrame]! < endThreshold) lastFrame -= 1;
  const end = Math.max(onset + 1, Math.min(length, (lastFrame + 1) * tenMs));

  // 50 ms RMS, hopped every 5 ms: the envelope a whoosh's peak is read from (DEPLOY S4.2).
  const window = Math.max(1, Math.round(sampleRate * 0.05));
  const hop = Math.max(1, Math.round(sampleRate * 0.005));
  let best = -1;
  let bestAt = onset;
  for (let start = 0; start + window <= Math.max(window, length); start += hop) {
    let sum = 0;
    for (let i = start; i < Math.min(length, start + window); i += 1) sum += mono[i]! * mono[i]!;
    if (sum > best) {
      best = sum;
      bestAt = start + window / 2;
    }
  }

  const body = channels.map((c) => {
    const out = new Float32Array(Math.max(end - onset, Math.round(sampleRate * 0.4)));
    out.set(c.subarray(onset, end));
    return out;
  });
  const loudness = measureLoudness(body, sampleRate);
  let bodyPower = 0;
  for (let i = onset; i < end; i += 1) bodyPower += mono[i]! * mono[i]!;
  bodyPower /= end - onset;
  return {
    onsetMs: ms(onset),
    peakMs: ms(Math.min(length, bestAt)),
    endMs: ms(end),
    attackMs: ms(attack - onset),
    lufs: loudness.integrated,
    lufsMax: loudness.momentaryMax,
    truePeakDb: loudness.truePeakDb,
    crestDb: db(peakAbs * peakAbs) - db(bodyPower),
    ...spectrum(mono.subarray(onset, end), sampleRate),
    noiseFloorDb: db(floor) - db(loudest),
    tailDb: db(tail) - db(loudest),
    clippedRuns,
    sideDb: channels.length > 1 ? db(side) - db(mid) : -200,
    channels: channels.length,
  };
}
