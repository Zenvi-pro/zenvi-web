/**
 * Levels by role (DEPLOY.md S4.4): a cue's gain is set so its 50 ms peak
 * lands a set distance over the bed at that moment, not from a static
 * recipe level. Hero +6…+12 dB, sweetener 0…+6, micro -6…+3 (the reference
 * reels' cut cues peak 7.5 dB over the local bed, CRAFT.md §12). The
 * envelope matches METRICS.md's (sound_score.py env50: 50 ms RMS frames on
 * a 10 ms hop, of the mono sum), so what is planned is what gets measured.
 */

/** Hop of the 50 ms envelope, seconds. */
export const ENV_HOP = 0.01;
const WINDOW = 0.05;
const FLOOR_DB = -120;

/** 50 ms RMS of the mono sum every 10 ms, dBFS (frame k is centred on k × 10 ms). */
export function envelope50(left: Float32Array, right: Float32Array | undefined, sampleRate: number): Float32Array {
  const n = left.length;
  const squares = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) {
    const m = right ? (left[i]! + right[i]!) / 2 : left[i]!;
    squares[i + 1] = squares[i]! + m * m;
  }
  const hop = Math.round(ENV_HOP * sampleRate);
  const half = Math.round((WINDOW * sampleRate) / 2);
  const frames = Math.floor(n / hop) + 1;
  const out = new Float32Array(frames);
  for (let k = 0; k < frames; k += 1) {
    const c = k * hop;
    // librosa pads the edges with zeros: the window is always 50 ms long.
    const a = Math.max(0, c - half);
    const b = Math.min(n, c + half);
    const rms = Math.sqrt(Math.max(0, squares[b]! - squares[a]!) / (2 * half));
    out[k] = rms > 1e-6 ? 20 * Math.log10(rms) : FLOOR_DB;
  }
  return out;
}

/** The loudest 50 ms frame from 30 ms before `hit` to 120 ms after it (where METRICS.md measures a cue), dBFS. */
export function peakNear(env: Float32Array, hit: number): number {
  const a = Math.max(0, Math.round((hit - 0.03) / ENV_HOP));
  const b = Math.min(env.length - 1, Math.round((hit + 0.12) / ENV_HOP));
  let peak = FLOOR_DB;
  for (let k = a; k <= b; k += 1) peak = Math.max(peak, env[k]!);
  return peak;
}

/** The bed's median 50 ms level from 1 s before `t` to 1 s after (silence counts), dBFS. */
export function bedLevelAt(env: Float32Array, t: number): number {
  const a = Math.max(0, Math.round((t - 1) / ENV_HOP));
  const b = Math.min(env.length, Math.round((t + 1) / ENV_HOP) + 1);
  if (b <= a) return FLOOR_DB;
  const slice = Array.from(env.subarray(a, b)).sort((x, y) => x - y);
  return slice[Math.floor(slice.length / 2)]!;
}

export type LevelRole = "hero" | "sweetener" | "micro";

/**
 * Where each role's 50 ms peak sits over the bed, dB: the bottom of its
 * band (DEPLOY.md S4.4), because master_audio_tool lifts the
 * effects lane a few dB to its place under the music afterwards.
 */
export const PROMINENCE_DB: Readonly<Record<LevelRole, number>> = { hero: 6, sweetener: 1, micro: -5 };

/** Bed quieter than this is no bed: the cue keeps its designed level. */
export const NO_BED_DB = -45;

/**
 * Gain for a cue whose file peaks at `cuePeakDb` (50 ms, at 0 dB gain) so
 * it sits `PROMINENCE_DB[role] + offsetDb` over a bed at `bedDb`; null when
 * there is no bed to sit over.
 */
export function gainOverBed(role: LevelRole, cuePeakDb: number, bedDb: number, offsetDb = 0): number | null {
  if (!(bedDb > NO_BED_DB) || !(cuePeakDb > FLOOR_DB + 1)) return null;
  return PROMINENCE_DB[role] + offsetDb + bedDb - cuePeakDb;
}
