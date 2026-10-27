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
 *   octave check    editing wants 80-180 BPM: a tempo above 180 is halved, and one
 *                   below 80 is doubled when the faster pulse is really in the
 *                   audio (a track that is clearly slow stays slow); the other
 *                   octave is always reported in `alternatives`
 *   phase check     a grid sitting on the off-beats (hi-hats) moves half a
 *                   beat when the half-beats carry more low-band (kick) flux
 *   downbeats       the bar phase whose beats carry the most low-band (kick)
 *                   flux, in bars of 4 beats (3 when the accents say waltz)
 *   confidence      how regular and how present the beats are (0..1)
 *
 * zenvi-core's detect_beats picks energy peaks (speech/beats.py); this
 * returns the same shape (`beats[{timeSec, strength}]`, `downbeats`, `bpm`)
 * but beats are a tempo-consistent grid, which is what cutting on the beat
 * needs.
 */

export interface BeatOptions {
  minBpm?: number;
  maxBpm?: number;
  /** Track this tempo instead of estimating one (the caller knows it); the beats still snap to where the audio hits. */
  bpm?: number;
  /** How strongly beats keep the tempo (higher = more regular). */
  tightness?: number;
}

/** Another tempo the audio supports: the same pulse an octave away. */
export interface TempoAlternative {
  bpm: number;
  /** How much of the main pulse's periodicity this tempo has (0..1); above ~0.5 the pulse really is there. */
  support: number;
}

export interface BeatAnalysis {
  /** Tempo in beats per minute, 0 when nothing beat-like was found. In 80-180 unless the track is clearly outside. */
  bpm: number;
  /** 0..1: how regular the beat grid is and how many of its beats land on a hit. Below ~0.4, check by ear. */
  confidence: number;
  /** The tempo the autocorrelation first picked when it was moved to the edit range (half/double), else absent. */
  foldedFrom?: number;
  /** The half- and double-time readings of `bpm` that fit the audio, strongest first. */
  alternatives: TempoAlternative[];
  /** Beats per bar the downbeats count in (4, or 3 when the accents repeat every third beat). */
  beatsPerBar: number;
  /** 0..1: how clearly one beat of the bar carries the kick/bass accent. */
  barConfidence: number;
  /** The tempo was given by the caller (BeatOptions.bpm), only the phase was tracked. */
  forced?: boolean;
  /** The beat grid, with the onset strength (0..1) at each beat. */
  beats: { timeSec: number; strength: number }[];
  /** First beat of each bar. */
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

/** The tempo range cuts are made to: slower than this is doubled, faster halved. */
export const EDIT_BPM_MIN = 80;
export const EDIT_BPM_MAX = 180;

/** A beat out-accents the rest of its bar by at least this much bass level (log power) to count. */
const ACCENT_MARGIN = 0.05;

const EMPTY: BeatAnalysis = { bpm: 0, confidence: 0, alternatives: [], beatsPerBar: 4, barConfidence: 0, beats: [], downbeats: [], onsets: [], beatEnergy: [] };

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

interface TempoReading {
  /** Tempo the autocorrelation (with harmonic support and the prior) prefers, 0 when there is none. */
  bpm: number;
  /** Autocorrelation at one beat of `bpm`, relative to lag 0 (0..1): how periodic the envelope is at that tempo. */
  periodicity(bpm: number): number;
}

function readTempo(env: Float64Array, frameRate: number, minBpm: number, maxBpm: number): TempoReading {
  const none: TempoReading = { bpm: 0, periodicity: () => 0 };
  if (env.length < frameRate * 2) return none;
  const maxLag = Math.ceil((frameRate * 60 * 2) / minBpm);
  const ac = autocorrelation(env, Math.min(maxLag, env.length - 2));
  if (!(ac[0]! > 0)) return none;
  // The peak of a pulse sits within a percent or two of where its tempo says: take the best of that neighbourhood.
  const periodicity = (bpm: number) => {
    let peak = 0;
    for (const k of [0.98, 0.99, 1, 1.01, 1.02]) peak = Math.max(peak, sampleAt(ac, (frameRate * 60) / (bpm * k)));
    return Math.min(1, peak / ac[0]!);
  };
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
  return { bpm: best > 0 ? bestBpm : 0, periodicity };
}

/** Tempo (BPM) of an onset envelope, or 0 when it has no periodicity. */
export function estimateTempo(env: Float64Array, frameRate: number, minBpm = 60, maxBpm = 200): number {
  return readTempo(env, frameRate, minBpm, maxBpm).bpm;
}

/** A faster pulse counts as present when its autocorrelation keeps this share of the slower one's. */
const PULSE_PRESENT = 0.45;

/**
 * Move a tempo into the range cuts are made to. Above 180 the half-time grid
 * is a subset of the beats (always safe); below 80 the double-time grid is used
 * only when its pulse is in the audio, so a ballad at 70 stays a ballad.
 */
function toEditRange(reading: TempoReading): number {
  let bpm = reading.bpm;
  while (bpm > EDIT_BPM_MAX && bpm / 2 >= 40) bpm /= 2;
  if (bpm < EDIT_BPM_MIN && bpm * 2 <= EDIT_BPM_MAX && reading.periodicity(bpm * 2) >= PULSE_PRESENT * reading.periodicity(bpm)) bpm *= 2;
  return bpm;
}

function tempoAlternatives(reading: TempoReading, bpm: number): TempoAlternative[] {
  const own = reading.periodicity(bpm);
  if (!(own > 0)) return [];
  return [bpm / 2, bpm * 2]
    .filter((c) => c >= 40 && c <= 200)
    .map((c) => ({ bpm: Math.round(c * 10) / 10, support: Math.round(Math.min(1, reading.periodicity(c) / own) * 100) / 100 }))
    .filter((a) => a.support >= 0.3)
    .sort((a, b) => b.support - a.support);
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

/**
 * The bar of `length` beats whose first beat carries the most accent, and how
 * reliably it does: the share of bars in which that beat is clearly the
 * strongest (0 when the beats are all alike, 1 when every bar starts on it).
 */
function barAccent(accents: readonly number[], length: number): { phase: number; consistency: number } {
  const sums = new Array<number>(length).fill(0);
  const counts = new Array<number>(length).fill(0);
  accents.forEach((a, i) => {
    sums[i % length]! += a;
    counts[i % length]! += 1;
  });
  const means = sums.map((v, p) => (counts[p]! > 0 ? v / counts[p]! : 0));
  const phase = means.indexOf(Math.max(...means));
  let bars = 0;
  let wins = 0;
  for (let i = phase; i + length <= accents.length; i += length) {
    bars += 1;
    let rest = 0;
    for (let k = 1; k < length; k += 1) rest = Math.max(rest, accents[i + k]!);
    if (accents[i]! > rest + ACCENT_MARGIN) wins += 1;
  }
  return { phase, consistency: bars > 0 ? Math.max(0, (wins / bars - 1 / length) / (1 - 1 / length)) : 0 };
}

/** Beats, tempo, downbeats and hits of mono PCM. Silence or noise gives `bpm: 0` and no beats. */
export function detectBeats(pcm: Float32Array, sampleRate: number, options: BeatOptions = {}): BeatAnalysis {
  const { onset, low, lowLevel, rms, frameRate } = envelopes(pcm, sampleRate);
  if (onset.length < frameRate * 2) return EMPTY;
  const forced = options.bpm !== undefined && options.bpm > 0;
  const reading = readTempo(onset, frameRate, options.minBpm ?? 60, options.maxBpm ?? 200);
  const bpm = forced ? options.bpm! : toEditRange(reading);
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
  const accents = frames.map(bass);
  const four = barAccent(accents, 4);
  const three = barAccent(accents, 3);
  // Waltz time needs a clear win: any 4/4 track has some accent pattern that three beats can also pick out.
  const waltz = three.consistency > 0.5 && three.consistency > four.consistency + 0.2;
  const bar = waltz ? three : four;
  const beatsPerBar = waltz ? 3 : 4;

  const meanRms = frames.map((f, i) => {
    const end = i + 1 < frames.length ? frames[i + 1]! : Math.min(rms.length, f + Math.round(period));
    let sum = 0;
    for (let k = f; k < end; k += 1) sum += rms[k]!;
    return end > f ? sum / (end - f) : 0;
  });
  const loudest = Math.max(...meanRms, 0);
  const beatEnergy = meanRms.map((v) => (loudest > 0 ? Math.round((v / loudest) * 1000) / 1000 : 0));

  // Sure of the grid when many beats land on a hit and the onset envelope repeats at the tempo.
  const hit = (f: number) => Math.max(onset[f - 1] ?? 0, onset[f] ?? 0, onset[f + 1] ?? 0) >= 0.15;
  const present = frames.filter(hit).length / frames.length;
  const confidence = Math.round(Math.min(1, reading.periodicity(bpm) / 0.2) * (0.5 + 0.5 * Math.min(1, present / 0.6)) * 100) / 100;

  // A frame is timed three quarters into its window: the Hann window rises most steeply there, so that is where a
  // transient sits when it raises the flux the most. (Timing at the centre put beats a quarter window, ~12 ms, early.)
  const time = (frame: number) => Math.round(((frame * HOP + TRANSIENT_AT) / (frameRate * HOP)) * 1000) / 1000;
  return {
    bpm: Math.round(bpm * 10) / 10,
    confidence,
    ...(!forced && Math.abs(bpm - reading.bpm) > 0.5 ? { foldedFrom: Math.round(reading.bpm * 10) / 10 } : {}),
    alternatives: tempoAlternatives(reading, bpm),
    beatsPerBar,
    barConfidence: Math.round(bar.consistency * 100) / 100,
    ...(forced ? { forced: true } : {}),
    beats: frames.map((f) => ({ timeSec: time(f), strength: Math.round(onset[f]! * 1000) / 1000 })),
    downbeats: frames.filter((_, i) => i % beatsPerBar === bar.phase).map((f) => ({ timeSec: time(f) })),
    onsets: pickOnsets(onset, frameRate).map((t) => Math.round((t + TRANSIENT_AT / (frameRate * HOP)) * 1000) / 1000),
    beatEnergy,
  };
}
