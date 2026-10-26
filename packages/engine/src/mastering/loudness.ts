/**
 * Loudness measurement: ITU-R BS.1770-4 K-weighting and gating, EBU R128
 * (integrated, momentary, short-term, loudness range) and the 4x-oversampled
 * true peak of BS.1770-4 Annex 2. Pure functions over planar float PCM.
 *
 * The K-weighting biquads are derived from the standard's analog prototype
 * for any sample rate (as libebur128 and pyloudnorm do); at 48 kHz they
 * reproduce the coefficients printed in BS.1770-4 table 1. Reference:
 * EBU Tech 3341 (metering), Tech 3342 (loudness range).
 */

/** Loudness of silence. */
export const SILENCE_LUFS = Number.NEGATIVE_INFINITY;

const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;
const RANGE_RELATIVE_GATE_LU = -20;
const BLOCK_SECONDS = 0.4;
const HOP_SECONDS = 0.1;
const SHORT_TERM_SECONDS = 3;
/** The -0.691 dB offset of BS.1770 (makes a 997 Hz full-scale stereo sine read 0 LUFS). */
const LUFS_OFFSET = -0.691;

export interface Biquad {
  b: readonly [number, number, number];
  a: readonly [number, number];
}

/** Stage 1 (head-related high shelf) and stage 2 (RLB high-pass) of the K-weighting filter. */
export function kWeightingFilters(sampleRate: number): [Biquad, Biquad] {
  const shelfGain = 3.999843853973347;
  const shelfQ = 0.7071752369554196;
  const shelfFc = 1681.974450955533;
  let k = Math.tan((Math.PI * shelfFc) / sampleRate);
  const vh = 10 ** (shelfGain / 20);
  const vb = vh ** 0.4996667741545416;
  let a0 = 1 + k / shelfQ + k * k;
  const shelf: Biquad = {
    b: [(vh + (vb * k) / shelfQ + k * k) / a0, (2 * (k * k - vh)) / a0, (vh - (vb * k) / shelfQ + k * k) / a0],
    a: [(2 * (k * k - 1)) / a0, (1 - k / shelfQ + k * k) / a0],
  };
  const hpQ = 0.5003270373238773;
  const hpFc = 38.13547087602444;
  k = Math.tan((Math.PI * hpFc) / sampleRate);
  a0 = 1 + k / hpQ + k * k;
  // The standard's high-pass numerator is exactly 1, -2, 1 (not divided by a0).
  const highPass: Biquad = { b: [1, -2, 1], a: [(2 * (k * k - 1)) / a0, (1 - k / hpQ + k * k) / a0] };
  return [shelf, highPass];
}

/** Direct form II transposed, in place on `out` (a copy of the input). */
function filterInto(input: Float32Array, out: Float64Array, filter: Biquad): void {
  const [b0, b1, b2] = filter.b;
  const [a1, a2] = filter.a;
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < input.length; i += 1) {
    const x = input[i]!;
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    out[i] = y;
  }
}

function filterInPlace(data: Float64Array, filter: Biquad): void {
  const [b0, b1, b2] = filter.b;
  const [a1, a2] = filter.a;
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < data.length; i += 1) {
    const x = data[i]!;
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    data[i] = y;
  }
}

/**
 * BS.1770 channel weights by position: L, R, C count 1.0, the LFE (channel 4
 * of a 5.1 layout) none, the surrounds 1.41 (+1.5 dB). Other layouts weigh
 * every channel 1.0.
 */
export function channelWeights(count: number): number[] {
  if (count === 6) return [1, 1, 1, 0, 1.41, 1.41];
  if (count === 5) return [1, 1, 1, 1.41, 1.41];
  return Array.from({ length: count }, () => 1);
}

export function powerToLufs(power: number): number {
  return power > 0 ? LUFS_OFFSET + 10 * Math.log10(power) : SILENCE_LUFS;
}

export function lufsToPower(lufs: number): number {
  return 10 ** ((lufs - LUFS_OFFSET) / 10);
}

/** `20 log10(x)`; -Infinity for silence. */
export function amplitudeToDb(x: number): number {
  return x > 0 ? 20 * Math.log10(x) : SILENCE_LUFS;
}

export interface LoudnessReport {
  /** Gated programme loudness, LUFS (BS.1770-4 / R128). -Infinity when nothing is above the gate. */
  integrated: number;
  /** Loudest 400 ms block, LUFS. */
  momentaryMax: number;
  /** Loudest 3 s window, LUFS. */
  shortTermMax: number;
  /** Loudness range (EBU Tech 3342), LU; 0 when there is too little programme. */
  range: number;
  /** Highest sample magnitude, dBFS. */
  samplePeakDb: number;
  /** Highest inter-sample peak (4x oversampling), dBTP. */
  truePeakDb: number;
  seconds: number;
}

/** Mean-square energy of each 100 ms hop of the K-weighted, channel-weighted signal. */
function hopEnergies(channels: readonly Float32Array[], sampleRate: number): { energies: Float64Array; hop: number } {
  const hop = Math.max(1, Math.round(sampleRate * HOP_SECONDS));
  const length = channels.reduce((n, c) => Math.max(n, c.length), 0);
  const hops = Math.floor(length / hop);
  const energies = new Float64Array(hops);
  const weights = channelWeights(channels.length);
  const [shelf, highPass] = kWeightingFilters(sampleRate);
  const work = new Float64Array(length);
  channels.forEach((channel, c) => {
    const weight = weights[c] ?? 1;
    if (weight === 0) return;
    work.fill(0);
    filterInto(channel, work, shelf);
    filterInPlace(work, highPass);
    for (let h = 0; h < hops; h += 1) {
      let sum = 0;
      for (let i = h * hop, end = i + hop; i < end; i += 1) sum += work[i]! * work[i]!;
      energies[h]! += (weight * sum) / hop;
    }
  });
  return { energies, hop };
}

/** Mean of `energies[i..i+width)` for each i: the power of every sliding window of `width` hops. */
function slidingPower(energies: Float64Array, width: number): Float64Array {
  const count = energies.length - width + 1;
  if (count <= 0) return new Float64Array(0);
  const out = new Float64Array(count);
  let sum = 0;
  for (let i = 0; i < width; i += 1) sum += energies[i]!;
  out[0] = sum / width;
  for (let i = 1; i < count; i += 1) {
    sum += energies[i + width - 1]! - energies[i - 1]!;
    out[i] = sum / width;
  }
  return out;
}

function meanPower(values: ArrayLike<number>, keep: (power: number) => boolean): { mean: number; count: number } {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]!;
    if (!keep(v)) continue;
    sum += v;
    count += 1;
  }
  return { mean: count > 0 ? sum / count : 0, count };
}

/** Gated integrated loudness of block powers (BS.1770-4 section 5.1): -70 LUFS absolute, then -10 LU relative. */
export function gatedLoudness(blockPowers: ArrayLike<number>): number {
  const absolute = lufsToPower(ABSOLUTE_GATE_LUFS);
  const first = meanPower(blockPowers, (p) => p > absolute);
  if (first.count === 0) return SILENCE_LUFS;
  const relative = first.mean * 10 ** (RELATIVE_GATE_LU / 10);
  const second = meanPower(blockPowers, (p) => p > absolute && p > relative);
  return second.count === 0 ? SILENCE_LUFS : powerToLufs(second.mean);
}

/** EBU Tech 3342: 10th to 95th percentile of the short-term loudness above the -70 / -20 LU gates. */
function loudnessRange(shortTerm: Float64Array): number {
  const absolute = lufsToPower(ABSOLUTE_GATE_LUFS);
  const first = meanPower(shortTerm, (p) => p > absolute);
  if (first.count === 0) return 0;
  const relative = first.mean * 10 ** (RANGE_RELATIVE_GATE_LU / 10);
  const kept: number[] = [];
  for (const p of shortTerm) if (p > absolute && p > relative) kept.push(powerToLufs(p));
  if (kept.length < 2) return 0;
  kept.sort((a, b) => a - b);
  const at = (q: number): number => {
    const x = q * (kept.length - 1);
    const lo = Math.floor(x);
    const hi = Math.min(kept.length - 1, lo + 1);
    return kept[lo]! + (kept[hi]! - kept[lo]!) * (x - lo);
  };
  return at(0.95) - at(0.1);
}

/** Taps per polyphase branch of the true-peak interpolator (BS.1770-4 Annex 2 uses 12). */
const TAPS_PER_PHASE = 12;

/**
 * Oversampling factor for true peak: 4x below 96 kHz, 2x up to 192 kHz,
 * none above (BS.1770-4 Annex 2).
 */
function oversampling(sampleRate: number): number {
  if (sampleRate < 96000) return 4;
  if (sampleRate < 192000) return 2;
  return 1;
}

/** Hann-windowed sinc interpolation branches: `phases[p][k]` weighs sample `n - k` for output `n*factor + p`. */
function interpolationPhases(factor: number): Float64Array[] {
  const length = factor * TAPS_PER_PHASE;
  // Centred on a multiple of `factor`, so branch 0 passes the original samples through.
  const centre = length / 2;
  const prototype = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    const x = (i - centre) / factor;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length);
    prototype[i] = sinc * window;
  }
  const phases: Float64Array[] = [];
  for (let p = 0; p < factor; p += 1) {
    const branch = new Float64Array(TAPS_PER_PHASE);
    let sum = 0;
    for (let k = 0; k < TAPS_PER_PHASE; k += 1) {
      branch[k] = prototype[k * factor + p]!;
      sum += branch[k]!;
    }
    // Unity DC gain per branch, so a constant signal keeps its level.
    for (let k = 0; k < TAPS_PER_PHASE; k += 1) branch[k]! /= sum;
    phases.push(branch);
  }
  return phases;
}

/**
 * The true-peak meter's interpolator at `sampleRate`: `phases[p][k]` weighs
 * sample `n - k + taps / 2` for the point `n + p / factor` (phase 0 is the
 * sample itself), and `gain` is the most any phase can raise the loudest
 * sample it reads.
 */
export interface TruePeakInterpolator {
  factor: number;
  taps: number;
  phases: Float64Array[];
  gain: number;
}

export function truePeakInterpolator(sampleRate: number): TruePeakInterpolator {
  const factor = oversampling(sampleRate);
  const phases = factor === 1 ? [] : interpolationPhases(factor);
  const gain = Math.max(1, ...phases.map((branch) => branch.reduce((sum, tap) => sum + Math.abs(tap), 0)));
  return { factor, taps: TAPS_PER_PHASE, phases, gain };
}

/** Highest magnitude of the oversampled signal. */
export function truePeak(channel: Float32Array, sampleRate: number): number {
  let peak = 0;
  for (let i = 0; i < channel.length; i += 1) peak = Math.max(peak, Math.abs(channel[i]!));
  const { factor, phases, gain } = truePeakInterpolator(sampleRate);
  if (factor === 1) return peak;
  // Chunks whose loudest sample stays under peak / gain cannot raise the peak.
  const chunk = 256;
  const reach = TAPS_PER_PHASE;
  for (let from = 0; from < channel.length; from += chunk) {
    const to = Math.min(channel.length, from + chunk);
    let local = 0;
    for (let i = Math.max(0, from - reach); i < Math.min(channel.length, to + reach); i += 1) local = Math.max(local, Math.abs(channel[i]!));
    if (local * gain <= peak) continue;
    for (let n = from; n < to; n += 1) {
      for (const branch of phases) {
        let y = 0;
        for (let k = 0; k < TAPS_PER_PHASE; k += 1) {
          const at = n - k + (TAPS_PER_PHASE >> 1);
          if (at >= 0 && at < channel.length) y += branch[k]! * channel[at]!;
        }
        peak = Math.max(peak, Math.abs(y));
      }
    }
  }
  return peak;
}

/** Measure planar PCM (channel arrays of equal length). Silent or too-short input reads -Infinity. */
export function measureLoudness(channels: readonly Float32Array[], sampleRate: number): LoudnessReport {
  if (!(sampleRate > 0)) throw new RangeError("sampleRate must be positive");
  const length = channels.reduce((n, c) => Math.max(n, c.length), 0);
  const { energies } = hopEnergies(channels, sampleRate);
  const blocks = slidingPower(energies, Math.round(BLOCK_SECONDS / HOP_SECONDS));
  const shortTerm = slidingPower(energies, Math.round(SHORT_TERM_SECONDS / HOP_SECONDS));
  const max = (values: Float64Array): number => (values.length > 0 ? powerToLufs(values.reduce((m, v) => Math.max(m, v), 0)) : SILENCE_LUFS);
  let samplePeak = 0;
  let truePeakLinear = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) samplePeak = Math.max(samplePeak, Math.abs(channel[i]!));
    truePeakLinear = Math.max(truePeakLinear, truePeak(channel, sampleRate));
  }
  return {
    integrated: gatedLoudness(blocks),
    momentaryMax: max(blocks),
    shortTermMax: max(shortTerm),
    range: loudnessRange(shortTerm),
    samplePeakDb: amplitudeToDb(samplePeak),
    truePeakDb: amplitudeToDb(truePeakLinear),
    seconds: length / sampleRate,
  };
}

/** The parts of the signal inside `windows` (seconds), joined: what a role sounds like while something else is on. */
export function sliceWindows(channels: readonly Float32Array[], sampleRate: number, windows: readonly (readonly [number, number])[]): Float32Array[] {
  const spans = windows
    .map(([s, e]) => [Math.max(0, Math.round(s * sampleRate)), Math.max(0, Math.round(e * sampleRate))] as const)
    .filter(([s, e]) => e > s);
  const total = spans.reduce((n, [s, e]) => n + e - s, 0);
  return channels.map((channel) => {
    const out = new Float32Array(total);
    let at = 0;
    for (const [s, e] of spans) {
      const part = channel.subarray(Math.min(s, channel.length), Math.min(e, channel.length));
      out.set(part, at);
      at += e - s;
    }
    return out;
  });
}
