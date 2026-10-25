/**
 * Beat tracking for music-cut edits: tempo, a regular beat grid, downbeats
 * and strong onsets, from mono PCM. Pure (no DOM, no Node), so every surface
 * runs the same analysis on whatever audio its host decodes.
 *
 *   onset envelope  spectral flux over 36 log-spaced bands (mel-like, so a
 *                   kick counts as much as a hi-hat), log-compressed,
 *                   1024-point FFT, 256-sample hop, local mean removed
 *   tempo           autocorrelation of the envelope with harmonic support
 *                   and a log-normal prior around 120 BPM
 *   beats           dynamic programming over the envelope (Ellis 2007,
 *                   "Beat Tracking by Dynamic Programming")
 *   phase check     a grid sitting on the off-beats (hi-hats) moves half a
 *                   beat when the half-beats carry more low-band (kick) flux
 *   downbeats       the bar phase (4/4) whose beats carry the most
 *                   low-band (kick) flux
 *
 * zenvi-core's detect_beats picks energy peaks (speech/beats.py); this
 * returns the same shape (`beats[{timeSec, strength}]`, `downbeats`, `bpm`)
 * but beats are a tempo-consistent grid, which is what cutting on the beat
 * needs.
 */

export interface BeatOptions {
  minBpm?: number;
  maxBpm?: number;
  /** How strongly beats keep the tempo (higher = more regular). */
  tightness?: number;
}

export interface BeatAnalysis {
  /** Tempo in beats per minute, 0 when nothing beat-like was found. */
  bpm: number;
  /** The beat grid, with the onset strength (0..1) at each beat. */
  beats: { timeSec: number; strength: number }[];
  /** First beat of each 4/4 bar. */
  downbeats: { timeSec: number }[];
  /** Strong onsets (hits), seconds, at least 100 ms apart. */
  onsets: number[];
  /** Loudness between each beat and the next, relative to the loudest beat (0..1). */
  beatEnergy: number[];
}

const WIN = 1024;
const HOP = 256;
/** Where in a frame's window the transient that peaks its flux sits, samples. */
const TRANSIENT_AT = (3 * WIN) / 4;
/** Analysis rate the parameters are tuned for; other rates are fine (seconds scale). */
export const BEAT_SAMPLE_RATE = 22050;

const EMPTY: BeatAnalysis = { bpm: 0, beats: [], downbeats: [], onsets: [], beatEnergy: [] };

/** In-place iterative radix-2 FFT (re/im arrays of the same power-of-two length). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

interface Envelopes {
  /** Full-band onset strength per frame, 0..1. */
  onset: Float64Array;
  /** Low-band (kick) flux per frame, 0..1. */
  low: Float64Array;
  /** Low-band (30-200 Hz) level per frame, log power. */
  lowLevel: Float64Array;
  /** RMS per frame. */
  rms: Float64Array;
  frameRate: number;
}

const BANDS = 36;
/** Bands below ~76 Hz: where a kick's flux lands. */
const LOW_BANDS = 6;
/** Bands below ~200 Hz: the kick and bass level that marks the bar's first beat. */
const BASS_BANDS = 12;

/** Log-spaced band edges (in FFT bins) from ~30 Hz to 8 kHz: each band counts once, like a mel spectrogram. */
function bandEdges(sampleRate: number): number[] {
  const binHz = sampleRate / WIN;
  const lo = Math.log(30);
  const hi = Math.log(Math.min(8000, sampleRate / 2));
  const edges: number[] = [];
  for (let b = 0; b <= BANDS; b += 1) edges.push(Math.max(1, Math.round(Math.exp(lo + ((hi - lo) * b) / BANDS) / binHz)));
  // Low bands narrower than one bin share it: keep every band at least one bin wide.
  for (let b = 1; b <= BANDS; b += 1) edges[b] = Math.max(edges[b]!, edges[b - 1]! + 1);
  return edges;
}

function envelopes(pcm: Float32Array, sampleRate: number): Envelopes {
  const frames = pcm.length >= WIN ? 1 + Math.floor((pcm.length - WIN) / HOP) : 0;
  const frameRate = sampleRate / HOP;
  const onset = new Float64Array(frames);
  const low = new Float64Array(frames);
  const lowLevel = new Float64Array(frames);
  const rms = new Float64Array(frames);
  if (frames === 0) return { onset, low, lowLevel, rms, frameRate };
  const window = new Float64Array(WIN);
  for (let i = 0; i < WIN; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1));
  const edges = bandEdges(sampleRate);
  const re = new Float64Array(WIN);
  const im = new Float64Array(WIN);
  let prev = new Float64Array(BANDS);
  let cur = new Float64Array(BANDS);
  for (let f = 0; f < frames; f += 1) {
    const offset = f * HOP;
    let energy = 0;
    for (let i = 0; i < WIN; i += 1) {
      const v = pcm[offset + i]!;
      energy += v * v;
      re[i] = v * window[i]!;
      im[i] = 0;
    }
    rms[f] = Math.sqrt(energy / WIN);
    fft(re, im);
    let flux = 0;
    let lowFlux = 0;
    let bassPower = 0;
    for (let b = 0; b < BANDS; b += 1) {
      let power = 0;
      const end = Math.min(edges[b + 1]!, WIN / 2);
      for (let k = edges[b]!; k < end; k += 1) power += re[k]! * re[k]! + im[k]! * im[k]!;
      if (b < BASS_BANDS) bassPower += power;
      const level = Math.log1p(1000 * power);
      cur[b] = level;
      const rise = level - prev[b]!;
      if (f > 0 && rise > 0) {
        flux += rise;
        if (b < LOW_BANDS) lowFlux += rise;
      }
    }
    onset[f] = flux / BANDS;
    low[f] = lowFlux;
    lowLevel[f] = Math.log1p(bassPower);
    [prev, cur] = [cur, prev];
  }
  return { onset: normalize(removeLocalMean(onset, 16)), low: normalize(low), lowLevel, rms, frameRate };
}

function removeLocalMean(x: Float64Array, radius: number): Float64Array {
  const out = new Float64Array(x.length);
  let sum = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < x.length; i += 1) {
    const want = Math.min(x.length - 1, i + radius);
    while (hi < want) sum += x[++hi]!;
    while (lo < i - radius) sum -= x[lo++]!;
    out[i] = Math.max(0, x[i]! - sum / (hi - lo + 1));
  }
  return out;
}

function normalize(x: Float64Array): Float64Array {
  let max = 0;
  for (const v of x) if (v > max) max = v;
  if (max > 0) for (let i = 0; i < x.length; i += 1) x[i] = x[i]! / max;
  return x;
}

function autocorrelation(env: Float64Array, maxLag: number): Float64Array {
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length || 1;
  const ac = new Float64Array(maxLag + 2);
  for (let lag = 0; lag <= maxLag + 1; lag += 1) {
    let s = 0;
    for (let i = 0; i + lag < env.length; i += 1) s += (env[i]! - mean) * (env[i + lag]! - mean);
    ac[lag] = s;
  }
  return ac;
}

function sampleAt(ac: Float64Array, lag: number): number {
  const i = Math.floor(lag);
  if (i < 0 || i + 1 >= ac.length) return 0;
  const t = lag - i;
  return ac[i]! * (1 - t) + ac[i + 1]! * t;
}

/** Tempo (BPM) of an onset envelope, or 0 when it has no periodicity. */
export function estimateTempo(env: Float64Array, frameRate: number, minBpm = 60, maxBpm = 200): number {
  if (env.length < frameRate * 2) return 0;
  const maxLag = Math.ceil((frameRate * 60 * 2) / minBpm);
  const ac = autocorrelation(env, Math.min(maxLag, env.length - 2));
  if (!(ac[0]! > 0)) return 0;
  let best = 0;
  let bestBpm = 0;
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.25) {
    const lag = (frameRate * 60) / bpm;
    const support = sampleAt(ac, lag) + 0.5 * sampleAt(ac, 2 * lag) + 0.5 * sampleAt(ac, lag / 2);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    const score = support * prior;
    if (score > best) {
      best = score;
      bestBpm = bpm;
    }
  }
  return best > 0 ? bestBpm : 0;
}

/** Beat frames by dynamic programming: each beat rewards onset strength and a gap close to the period. */
function trackBeats(env: Float64Array, period: number, tightness: number): number[] {
  const n = env.length;
  const score = Float64Array.from(env);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.max(1, Math.round(period / 2));
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t += 1) {
    let bestValue = 0;
    let bestPrev = -1;
    for (let p = Math.max(0, t - hi); p <= t - lo; p += 1) {
      const ratio = Math.log((t - p) / period);
      const value = score[p]! - tightness * ratio * ratio;
      if (value > bestValue) {
        bestValue = value;
        bestPrev = p;
      }
    }
    if (bestPrev >= 0) {
      score[t] = score[t]! + bestValue;
      back[t] = bestPrev;
    }
  }
  let end = Math.max(0, n - Math.round(period));
  for (let t = end; t < n; t += 1) if (score[t]! > score[end]!) end = t;
  const frames: number[] = [];
  for (let t = end; t >= 0; t = back[t]!) frames.push(t);
  return frames.reverse();
}

function pickOnsets(env: Float64Array, frameRate: number): number[] {
  const minGap = Math.round(0.1 * frameRate);
  const out: number[] = [];
  let last = -minGap;
  for (let i = 1; i + 1 < env.length; i += 1) {
    const v = env[i]!;
    if (v >= 0.3 && v >= env[i - 1]! && v > env[i + 1]! && i - last >= minGap) {
      out.push(i / frameRate);
      last = i;
    }
  }
  return out;
}

/** Beats, tempo, downbeats and hits of mono PCM. Silence or noise gives `bpm: 0` and no beats. */
export function detectBeats(pcm: Float32Array, sampleRate: number, options: BeatOptions = {}): BeatAnalysis {
  const { onset, low, lowLevel, rms, frameRate } = envelopes(pcm, sampleRate);
  if (onset.length < frameRate * 2) return EMPTY;
  const bpm = estimateTempo(onset, frameRate, options.minBpm ?? 60, options.maxBpm ?? 200);
  if (!(bpm > 0)) return EMPTY;
  const period = (frameRate * 60) / bpm;
  let frames = trackBeats(onset, period, options.tightness ?? 100);

  // Locked onto the off-beats (hats, claps) while the kicks fall between: move half a beat.
  const half = Math.round(period / 2);
  const lowAt = (list: number[]) => list.reduce((sum, f) => sum + (low[f] ?? 0), 0) / Math.max(1, list.length);
  const shifted = frames.map((f) => f + half).filter((f) => f < onset.length);
  if (lowAt(shifted) > 1.5 * lowAt(frames) + 0.02) frames = shifted;

  // No beats in the silent lead-in or tail: start and stop where the music does.
  let first = 0;
  while (first < onset.length && onset[first]! < 0.1) first += 1;
  let last = onset.length - 1;
  while (last > 0 && onset[last]! < 0.1) last -= 1;
  frames = frames.filter((f) => f >= first - period / 2 && f <= last + period / 2);
  if (frames.length < 2) return EMPTY;

  // The bar's first beat carries the most kick and bass (snares on 2 and 4 are often louder overall).
  const window = Math.max(1, Math.round(0.06 * frameRate));
  const bass = (f: number) => {
    let peak = 0;
    for (let k = f; k < Math.min(lowLevel.length, f + window); k += 1) if (lowLevel[k]! > peak) peak = lowLevel[k]!;
    return peak;
  };
  let phase = 0;
  let bestAccent = -1;
  for (let p = 0; p < 4; p += 1) {
    let sum = 0;
    let count = 0;
    for (let i = p; i < frames.length; i += 4) {
      sum += bass(frames[i]!);
      count += 1;
    }
    const accent = count > 0 ? sum / count : 0;
    if (accent > bestAccent) {
      bestAccent = accent;
      phase = p;
    }
  }

  const meanRms = frames.map((f, i) => {
    const end = i + 1 < frames.length ? frames[i + 1]! : Math.min(rms.length, f + Math.round(period));
    let sum = 0;
    for (let k = f; k < end; k += 1) sum += rms[k]!;
    return end > f ? sum / (end - f) : 0;
  });
  const loudest = Math.max(...meanRms, 0);
  const beatEnergy = meanRms.map((v) => (loudest > 0 ? Math.round((v / loudest) * 1000) / 1000 : 0));

  // A frame is timed three quarters into its window: the Hann window rises most steeply there, so that is where a
  // transient sits when it raises the flux the most. (Timing at the centre put beats a quarter window, ~12 ms, early.)
  const time = (frame: number) => Math.round(((frame * HOP + TRANSIENT_AT) / (frameRate * HOP)) * 1000) / 1000;
  return {
    bpm: Math.round(bpm * 10) / 10,
    beats: frames.map((f) => ({ timeSec: time(f), strength: Math.round(onset[f]! * 1000) / 1000 })),
    downbeats: frames.filter((_, i) => i % 4 === phase).map((f) => ({ timeSec: time(f) })),
    onsets: pickOnsets(onset, frameRate).map((t) => Math.round((t + TRANSIENT_AT / (frameRate * HOP)) * 1000) / 1000),
    beatEnergy,
  };
}
