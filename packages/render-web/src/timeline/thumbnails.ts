/**
 * Timeline helpers: filmstrip thumbnails and waveform peaks for a file.
 */

import { AudioSampleSink, EncodedPacketSink, VideoSampleSink, type VideoSample } from "mediabunny";
import type { MediaRegistry } from "../media/registry.js";
import { sampleToBitmap } from "../video/convert.js";
import { accumulatePeaks, evenlySpacedTimes } from "./peaks.js";

export interface ThumbnailOptions {
  /** Evenly spaced thumbnails over the file. */
  count?: number;
  /** Or explicit source times, seconds. */
  times?: number[];
  /** Thumbnail height in pixels; width follows the picture's aspect ratio. */
  height: number;
  /**
   * Decode the exact frame at each time instead of the nearest keyframe at or
   * before it. Keyframes are much faster and fine for filmstrips.
   */
  exact?: boolean;
  signal?: AbortSignal;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

/** One bitmap per requested time (the caller closes them). Empty for audio-only files. */
export async function generateThumbnails(media: MediaRegistry, fileId: string, options: ThumbnailOptions): Promise<ImageBitmap[]> {
  const ref = { fileId };
  const height = Math.max(1, Math.round(options.height));
  const kind = media.kindOf(ref);
  if (kind === "image" || kind === "svg") return stillThumbnails(media, fileId, options, height);

  const lease = await media.acquire(ref);
  try {
    const { video, timeOffset, duration } = lease.media;
    if (!video) return [];
    const width = Math.max(1, Math.round((height * video.displayWidth) / Math.max(1, video.displayHeight)));
    const times = options.times ?? evenlySpacedTimes(options.count ?? 1, duration);
    const targets = times.map((t) => timeOffset + Math.min(Math.max(0, t), Math.max(0, duration)));

    let lookups = targets;
    if (!options.exact) {
      const packets = new EncodedPacketSink(video.track);
      const first = await packets.getFirstKeyPacket({ metadataOnly: true });
      lookups = await Promise.all(targets.map(async (t) => (await packets.getKeyPacket(t, { metadataOnly: true }))?.timestamp ?? first?.timestamp ?? t));
    }
    throwIfAborted(options.signal);

    // Decode each distinct picture once, in order (keyframes decode alone).
    const unique = [...new Set(lookups)].sort((a, b) => a - b);
    const sink = new VideoSampleSink(video.track);
    const bitmaps = new Map<number, ImageBitmap>();
    const iterator = sink.samplesAtTimestamps(unique);
    try {
      let index = 0;
      for await (const sample of iterator) {
        const key = unique[index++]!;
        if (!sample) continue;
        try {
          bitmaps.set(key, await sampleToBitmap(sample as VideoSample, { width, height }, true, "medium"));
        } finally {
          sample.close();
        }
        throwIfAborted(options.signal);
      }
    } catch (error) {
      for (const bitmap of bitmaps.values()) bitmap.close();
      throw error;
    } finally {
      await iterator.return();
    }

    // Times that share a picture each get their own bitmap (callers close each).
    const used = new Set<number>();
    const out: ImageBitmap[] = [];
    for (const key of lookups) {
      const bitmap = bitmaps.get(key);
      if (!bitmap) continue;
      if (!used.has(key)) {
        used.add(key);
        out.push(bitmap);
      } else {
        out.push(await createImageBitmap(bitmap));
      }
    }
    return out;
  } finally {
    lease.release();
  }
}

async function stillThumbnails(media: MediaRegistry, fileId: string, options: ThumbnailOptions, height: number): Promise<ImageBitmap[]> {
  const count = options.times?.length ?? Math.max(1, Math.floor(options.count ?? 1));
  const blob = await media.blob({ fileId });
  let first: ImageBitmap;
  if (media.kindOf({ fileId }) === "svg") {
    const { StillCache } = await import("../media/stills.js");
    const stills = new StillCache({ media });
    try {
      const borrowed = await stills.bitmap({ ref: { fileId }, width: height * 4, height });
      first = await createImageBitmap(borrowed.image, { resizeHeight: height, resizeQuality: "high" });
      borrowed.release();
    } finally {
      stills.dispose();
    }
  } else {
    first = await createImageBitmap(blob, { resizeHeight: height, resizeQuality: "high", imageOrientation: "from-image" });
  }
  const out = [first];
  for (let i = 1; i < count; i += 1) out.push(await createImageBitmap(first));
  return out;
}

export interface WaveformOptions {
  /** Number of peaks. */
  buckets: number;
  /** Source range, seconds. Default: the whole file. */
  start?: number;
  end?: number;
  signal?: AbortSignal;
}

/** Peak absolute amplitude (0..1) per bucket over all channels. Zeros for files without audio. */
export async function generateWaveform(media: MediaRegistry, fileId: string, options: WaveformOptions): Promise<Float32Array> {
  const peaks = new Float32Array(Math.max(0, Math.floor(options.buckets)));
  const kind = media.kindOf({ fileId });
  if (peaks.length === 0 || kind === "image" || kind === "svg") return peaks;
  const lease = await media.acquire({ fileId });
  try {
    const { audio, timeOffset, duration } = lease.media;
    if (!audio || !audio.canDecode) return peaks;
    const start = Math.max(0, options.start ?? 0);
    const end = Math.min(duration, options.end ?? duration);
    if (!(end > start)) return peaks;
    const sink = new AudioSampleSink(audio.track);
    for await (const sample of sink.samples(timeOffset + start, timeOffset + end)) {
      try {
        throwIfAborted(options.signal);
        const channels: Float32Array[] = [];
        for (let c = 0; c < sample.numberOfChannels; c += 1) {
          const plane = new Float32Array(sample.numberOfFrames);
          sample.copyTo(plane, { planeIndex: c, format: "f32-planar" });
          channels.push(plane);
        }
        accumulatePeaks(peaks, channels, sample.timestamp - timeOffset, sample.sampleRate, start, end);
      } finally {
        sample.close();
      }
    }
    for (let i = 0; i < peaks.length; i += 1) peaks[i] = Math.min(1, peaks[i]!);
    return peaks;
  } finally {
    lease.release();
  }
}
