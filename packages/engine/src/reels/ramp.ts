/**
 * Shot-length ramps (TECHNIQUES2 T036): shots shorten across a section,
 * about 4 s down to 1-1.5 s, or 1.2 s to 0.3 s in a trailer's last quarter,
 * then the edit settles on a longer shot. Pure functions over numbers:
 *
 *   lengths   the curve from the first shot's length to the last one's:
 *             exponential (each shot the same fraction shorter, how an
 *             accelerating montage feels), linear, ease_in (holds long,
 *             then collapses) or ease_out (drops fast, then steadies);
 *             with a total duration instead of a count, the count whose
 *             curve fills it best, scaled to fill it exactly
 *   cuts      on the frame grid, every shot at least two frames
 *   snapping  each cut moves to the nearest beat or onset within a share of
 *             its shorter neighbour, so the ramp keeps its shape
 *   sources   media in the order given, each video continuing where it was
 *             last cut (a long take gives a new moment every time), and a
 *             motif clip re-inserted every N shots from the same moment
 */

export const RAMP_CURVES = ["exponential", "linear", "ease_in", "ease_out"] as const;
export type RampCurve = (typeof RAMP_CURVES)[number];

/** Shortest shot a ramp cuts, frames: one frame reads as a flash, not a shot. */
export const MIN_SHOT_FRAMES = 2;
/** Most shots in one ramp. */
export const MAX_RAMP_SHOTS = 300;
/** A cut may move at most this share of its shorter neighbouring shot to reach a hit. */
const SNAP_SHARE = 0.35;

export interface RampShape {
  /** Seconds of the first shot. */
  first: number;
  /** Seconds of the last shot of the ramp (before `settle`). */
  last: number;
  curve: RampCurve;
  /** How many shots the ramp has (not counting `settle`); or give `duration`. */
  shots?: number;
  /** Seconds the ramp lasts (not counting `settle`) when `shots` is absent. */
  duration?: number;
  /** Seconds of a final held shot after the ramp; 0 or absent: none. */
  settle?: number;
}

function ease(curve: RampCurve, u: number): number {
  if (curve === "ease_in") return u * u;
  if (curve === "ease_out") return 1 - (1 - u) * (1 - u);
  return u;
}

function curveLengths(first: number, last: number, curve: RampCurve, n: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const u = ease(curve, n === 1 ? 1 : i / (n - 1));
    return curve === "linear" ? first + (last - first) * u : first * (last / first) ** u;
  });
}

/** Shot lengths, seconds, in order (the settle shot last when there is one). */
export function rampLengths(shape: RampShape): number[] {
  let lengths: number[];
  if (shape.shots !== undefined) {
    lengths = curveLengths(shape.first, shape.last, shape.curve, Math.max(2, Math.min(MAX_RAMP_SHOTS, Math.round(shape.shots))));
  } else {
    const target = shape.duration ?? 0;
    let best = curveLengths(shape.first, shape.last, shape.curve, 2);
    const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
    for (let n = 3; n <= MAX_RAMP_SHOTS; n += 1) {
      const candidate = curveLengths(shape.first, shape.last, shape.curve, n);
      if (Math.abs(sum(candidate) - target) < Math.abs(sum(best) - target)) best = candidate;
      if (sum(candidate) > target) break;
    }
    const scale = target / sum(best);
    lengths = best.map((x) => x * scale);
  }
  return shape.settle && shape.settle > 0 ? [...lengths, shape.settle] : lengths;
}

/** Cut times (seconds from the ramp's start) on the frame grid, the end last: `lengths.length + 1` times from 0. */
export function cutTimes(lengths: readonly number[], fps: number): number[] {
  const times = [0];
  let exact = 0;
  for (const length of lengths) {
    exact += length;
    const previous = times[times.length - 1]!;
    times.push(Math.max(previous + MIN_SHOT_FRAMES / fps, Math.round(exact * fps) / fps));
  }
  return times.map((t) => Math.round(t * fps) / fps);
}

export interface SnappedCuts {
  times: number[];
  /** Per inner cut (times[1..n-1]): moved onto a hit. */
  snapped: boolean[];
}

/**
 * Move each inner cut (not the start or the end) to the nearest hit (seconds
 * from the ramp's start) within SNAP_SHARE of its shorter neighbour, keeping
 * every shot at least MIN_SHOT_FRAMES long. Left to right, so each cut sees
 * where the one before it landed.
 */
export function snapCutTimes(times: readonly number[], hits: readonly number[], fps: number): SnappedCuts {
  const out = [...times];
  const snapped: boolean[] = [];
  const minShot = MIN_SHOT_FRAMES / fps;
  const sorted = [...hits].sort((a, b) => a - b);
  for (let i = 1; i + 1 < out.length; i += 1) {
    const reach = SNAP_SHARE * Math.min(times[i]! - times[i - 1]!, times[i + 1]! - times[i]!);
    let best: number | null = null;
    for (const h of sorted) {
      const t = Math.round(h * fps) / fps;
      if (Math.abs(t - out[i]!) > reach + 1e-9 || t < out[i - 1]! + minShot - 1e-9 || t > out[i + 1]! - minShot + 1e-9) continue;
      if (best === null || Math.abs(t - out[i]!) < Math.abs(best - out[i]!)) best = t;
    }
    snapped.push(best !== null);
    if (best !== null) out[i] = best;
  }
  return { times: out, snapped };
}

export interface RampSource {
  fileId: string;
  kind: "video" | "image";
  /** Usable range, seconds (videos). */
  start: number;
  end: number;
}

export interface RampShot {
  fileId: string;
  kind: "video" | "image";
  /** Seconds from the ramp's start. */
  at: number;
  length: number;
  /** Source in point, seconds (videos; images 0). */
  sourceStart: number;
  motif: boolean;
}

/**
 * Fill each shot: the sources in order, round and round, each video
 * continuing where it was last cut (from its start again once used up); a
 * video too short for a shot gives its turn to the next one that fits. With
 * a motif, every `motifEvery`-th shot is the motif from the same moment. Or the
 * first shot no source is long enough for.
 */
export function fillShots(times: readonly number[], sources: readonly RampSource[], motif?: { source: RampSource; every: number }): RampShot[] | { unfilled: number; length: number } {
  const cursor = sources.map((s) => s.start);
  const shots: RampShot[] = [];
  let next = 0;
  for (let i = 0; i + 1 < times.length; i += 1) {
    const at = times[i]!;
    const length = times[i + 1]! - at;
    const fits = (s: RampSource) => s.kind === "image" || s.end - s.start >= length - 1e-9;
    if (motif && (i + 1) % motif.every === 0 && fits(motif.source)) {
      shots.push({ fileId: motif.source.fileId, kind: motif.source.kind, at, length, sourceStart: motif.source.kind === "video" ? motif.source.start : 0, motif: true });
      continue;
    }
    let k = 0;
    while (k < sources.length && !fits(sources[(next + k) % sources.length]!)) k += 1;
    if (k === sources.length) return { unfilled: i, length };
    const index = (next + k) % sources.length;
    const source = sources[index]!;
    next = index + 1;
    if (source.kind === "image") {
      shots.push({ fileId: source.fileId, kind: "image", at, length, sourceStart: 0, motif: false });
      continue;
    }
    if (cursor[index]! + length > source.end + 1e-9) cursor[index] = source.start;
    shots.push({ fileId: source.fileId, kind: "video", at, length, sourceStart: cursor[index]!, motif: false });
    cursor[index] = cursor[index]! + length;
  }
  return shots;
}
