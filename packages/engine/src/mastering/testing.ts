/** Synthetic reference signals for loudness tests (EBU Tech 3341 style). Not part of the public API. */

/** A sine of `db` dBFS peak. */
export function dbfsSine(frequency: number, db: number, seconds: number, sampleRate: number, phase = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  const amplitude = 10 ** (db / 20);
  for (let n = 0; n < out.length; n += 1) out[n] = amplitude * Math.sin(2 * Math.PI * frequency * (n / sampleRate) + phase);
  return out;
}

/** The same sine on both channels. */
export function stereoSine(frequency: number, db: number, seconds: number, sampleRate: number): Float32Array[] {
  const tone = dbfsSine(frequency, db, seconds, sampleRate);
  return [tone, Float32Array.from(tone)];
}

/** Deterministic uniform noise in [-1, 1) (mulberry32). */
export function noise(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 31 - 1;
  };
}

export interface ScoreFixture {
  sampleRate: number;
  voice: Float32Array[];
  music: Float32Array[];
  sfx: Float32Array[];
  /** Hit times, seconds; the SFX clicks land on them. */
  hits: number[];
  speech: [number, number][];
}

export interface ScoreFixtureOptions {
  /** Music gain under the voice, dB (the duck). */
  duckDb?: number;
  /** SFX gain, dB. */
  sfxDb?: number;
  /** Seconds the clicks land after their hits. */
  late?: number;
  /** Music gain everywhere, dB. */
  musicDb?: number;
}

/**
 * A synthetic 8 s mix for the Sound Score tests: a 55/110 Hz harmonic bed,
 * a "voice" of 300 Hz-3 kHz noise with a 4 Hz syllable envelope on two lines,
 * and short 2 kHz clicks on six hit points, all stereo at 48 kHz.
 */
export function scoreFixture(options: ScoreFixtureOptions = {}): ScoreFixture {
  const sr = 48000;
  const n = 8 * sr;
  const speech: [number, number][] = [[1, 3.5], [4.5, 7]];
  const hits = [0.5, 1.5, 3.8, 4.2, 5.5, 7.5];
  const inSpeech = (t: number): boolean => speech.some(([s, e]) => t >= s && t < e);
  const music = new Float32Array(n);
  const voice = new Float32Array(n);
  const sfx = new Float32Array(n);
  const rand = noise(7);
  const musicGain = 10 ** ((options.musicDb ?? 0) / 20);
  // One-pole band-limiting of the noise: a crude 300 Hz-3 kHz band.
  let lp = 0;
  let hpState = 0;
  let duck = 1;
  const duckGain = 10 ** ((options.duckDb ?? -10) / 20);
  for (let i = 0; i < n; i += 1) {
    const t = i / sr;
    const target = inSpeech(t) || inSpeech(t + 0.05) ? duckGain : 1;
    duck += (target - duck) * (target < duck ? 1 / (0.04 * sr) : 1 / (0.3 * sr));
    let m = 0;
    for (let h = 1; h <= 6; h += 1) m += Math.sin(2 * Math.PI * 55 * h * t) / h + 0.5 * Math.sin(2 * Math.PI * 110 * h * t + h) / h;
    music[i] = 0.06 * m * duck * musicGain;
    const x = rand();
    lp += (x - lp) * 0.33;
    hpState += (lp - hpState) * 0.04;
    const syllable = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t);
    voice[i] = inSpeech(t) ? 0.5 * (lp - hpState) * syllable : 0;
  }
  const sfxGain = 0.5 * 10 ** ((options.sfxDb ?? 0) / 20);
  for (const hit of hits) {
    const start = Math.round((hit + (options.late ?? 0)) * sr);
    for (let k = 0; k < 0.08 * sr && start + k < n; k += 1) {
      const env = Math.exp(-k / (0.012 * sr));
      sfx[start + k] = sfxGain * env * (Math.sin(2 * Math.PI * 2000 * (k / sr)) + 0.5 * rand());
    }
  }
  const stereo = (x: Float32Array): Float32Array[] => [x, Float32Array.from(x)];
  return { sampleRate: sr, voice: stereo(voice), music: stereo(music), sfx: stereo(sfx), hits, speech };
}
