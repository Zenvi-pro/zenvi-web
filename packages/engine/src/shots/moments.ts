/**
 * Moments of a file that match a query: runs of keyframes around a peak
 * score. A keyframe stands for the `interval` around it, so a moment of one
 * keyframe is `interval` long.
 */

export interface Moment {
  /** Source seconds. */
  start: number;
  end: number;
  /** The best keyframe's time. */
  peak: number;
  /** The best keyframe's score. */
  score: number;
}

export interface MomentOptions {
  /** Keyframe spacing, seconds. */
  interval: number;
  /** File length, seconds (moments end there; 0 = no limit). */
  duration: number;
  /** A keyframe joins its peak's moment while it scores at least `peak - drop`. */
  drop: number;
  /** At most this many moments, best first. */
  max: number;
}

/** The best non-overlapping moments, best first. `times` ascend; `scores[i]` belongs to `times[i]`. */
export function findMoments(times: readonly number[], scores: readonly number[], options: MomentOptions): Moment[] {
  const n = Math.min(times.length, scores.length);
  const taken = new Uint8Array(n);
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[b]! - scores[a]! || a - b);
  const half = options.interval / 2;
  const out: Moment[] = [];
  for (const peak of order) {
    if (out.length >= options.max) break;
    if (taken[peak]) continue;
    const floor = scores[peak]! - options.drop;
    let lo = peak;
    let hi = peak;
    while (lo > 0 && !taken[lo - 1] && scores[lo - 1]! >= floor) lo -= 1;
    while (hi < n - 1 && !taken[hi + 1] && scores[hi + 1]! >= floor) hi += 1;
    taken.fill(1, lo, hi + 1);
    out.push({
      start: Math.max(0, times[lo]! - half),
      end: options.duration > 0 ? Math.min(options.duration, times[hi]! + half) : times[hi]! + half,
      peak: times[peak]!,
      score: scores[peak]!,
    });
  }
  return out;
}
