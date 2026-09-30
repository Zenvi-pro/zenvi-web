/**
 * Waveform peaks: the largest absolute sample per bucket, over all channels.
 */

/**
 * Fold one block of planar samples, whose first frame is at `blockStart`
 * seconds, into `peaks`, which divides `[rangeStart, rangeEnd)` into equal
 * buckets.
 */
export function accumulatePeaks(
  peaks: Float32Array,
  channels: readonly Float32Array[],
  blockStart: number,
  sampleRate: number,
  rangeStart: number,
  rangeEnd: number,
): void {
  const buckets = peaks.length;
  const span = rangeEnd - rangeStart;
  const frames = channels[0]?.length ?? 0;
  if (buckets === 0 || !(span > 0) || frames === 0 || !(sampleRate > 0)) return;
  // Frames of this block inside the range.
  const first = Math.max(0, Math.ceil((rangeStart - blockStart) * sampleRate - 1e-9));
  const last = Math.min(frames, Math.ceil((rangeEnd - blockStart) * sampleRate - 1e-9));
  let bucket = -1;
  let bucketEndFrame = -1;
  let peak = 0;
  for (let i = first; i < last; i += 1) {
    if (i >= bucketEndFrame) {
      if (bucket >= 0 && peak > peaks[bucket]!) peaks[bucket] = peak;
      const t = blockStart + i / sampleRate;
      bucket = Math.min(buckets - 1, Math.floor(((t - rangeStart) / span) * buckets));
      // First frame of the next bucket, in this block's frames.
      const nextBucketTime = rangeStart + ((bucket + 1) * span) / buckets;
      bucketEndFrame = Math.ceil((nextBucketTime - blockStart) * sampleRate - 1e-9);
      if (bucketEndFrame <= i) bucketEndFrame = i + 1;
      peak = 0;
    }
    for (const channel of channels) {
      const v = Math.abs(channel[i] ?? 0);
      if (v > peak) peak = v;
    }
  }
  if (bucket >= 0 && peak > peaks[bucket]!) peaks[bucket] = peak;
}

/** Evenly spaced times at bucket centers: `count` thumbnails over `duration`. */
export function evenlySpacedTimes(count: number, duration: number): number[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0 || !(duration > 0)) return n === 0 ? [] : new Array<number>(n).fill(0);
  return Array.from({ length: n }, (_, i) => ((i + 0.5) * duration) / n);
}
