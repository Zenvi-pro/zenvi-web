/**
 * FrameProvider: frame-accurate pictures for plan layers.
 *
 * One per consumer (a preview player, an export). It holds media leases, one
 * decode cursor per (media, lane) — a lane is a clip, so two clips showing the
 * same file at different times do not fight over one cursor — and borrows
 * converted pictures from a shared `FrameCache`.
 */

import { EncodedPacketSink, VideoSampleSink, type VideoSample } from "mediabunny";
import { MediaUnavailableError, type MediaLease, type MediaRef, type MediaRegistry, type OpenMedia } from "../media/registry.js";
import { bucketSize, type Size } from "../util/size-bucket.js";
import { sampleToBitmap, type ResizeQuality } from "./convert.js";
import { DecodeCursor, type DecodeMode, type KeyframeIndex } from "./decode-cursor.js";
import { FrameCache, type FrameKey } from "./frame-cache.js";
import { decodeTimestamp, spanCovers, spanEnd } from "./frame-lookup.js";
import type { FrameImage } from "./shared-bitmap.js";

export interface FrameRequest {
  ref: MediaRef;
  /** Plan source time: seconds from the first picture. */
  sourceTime: number;
  /** Size the layer draws the picture at (plan drawWidth × drawHeight). */
  width: number;
  height: number;
  /** Apply container rotation metadata (plan `applyRotation`, default true). */
  applyRotation?: boolean;
  /** Cursor lane, normally the clip id. */
  lane: string;
  /** `sequential` for playback/export, `seek` for scrubbing and stills. */
  mode: DecodeMode;
}

export interface FrameProviderOptions {
  media: MediaRegistry;
  /** Shared decoded-picture cache. Default: a private 192 MB cache. */
  cache?: FrameCache;
  /** Resize filter: "medium" for preview (default), "high" for export. */
  quality?: ResizeQuality;
  /** Close cursors (and their decoders) unused this long. Default 3 s. */
  idleCursorMs?: number;
  now?: () => number;
}

export class VideoDecodeUnsupportedError extends Error {
  constructor(readonly ref: MediaRef) {
    super(`This browser cannot decode the video of ${ref.fileId ?? ref.path ?? "a file"}`);
    this.name = "VideoDecodeUnsupportedError";
  }
}

interface MediaSlot {
  lease: MediaLease;
  /** Null when the media has no video stream. */
  sink: VideoSampleSink | null;
  keyframes: KeyframeIndex;
  lastUsed: number;
}

export class FrameProvider {
  readonly cache: FrameCache;
  private readonly media: MediaRegistry;
  private readonly quality: ResizeQuality;
  private readonly idleCursorMs: number;
  private readonly now: () => number;
  private readonly slots = new Map<string, Promise<MediaSlot>>();
  private readonly cursors = new Map<string, { cursor: DecodeCursor<VideoSample>; mediaKey: string }>();
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(options: FrameProviderOptions) {
    this.media = options.media;
    this.cache = options.cache ?? new FrameCache();
    this.quality = options.quality ?? "medium";
    this.idleCursorMs = options.idleCursorMs ?? 3000;
    this.now = options.now ?? (() => performance.now());
    this.unsubscribe = this.media.onInvalidate((key) => void this.forget(key));
  }

  /** The picture for `request`, borrowed (call `release`), or null when the media has no video. */
  async frame(request: FrameRequest): Promise<FrameImage | null> {
    if (this.disposed) throw new Error("FrameProvider is disposed");
    const slot = await this.slot(request.ref);
    // Disposed while the media was opening: a cursor made now would outlive
    // dispose's cleanup (an export cancelled with warm requests in flight).
    if (this.disposed) throw new Error("FrameProvider is disposed");
    const media = slot.lease.media;
    const video = media.video;
    if (!video || !slot.sink) return null;
    if (!video.canDecode) throw new VideoDecodeUnsupportedError(request.ref);
    slot.lastUsed = this.now();

    const applyRotation = request.applyRotation ?? true;
    // Past the end the last picture freezes: a cursor that reaches the end
    // gives it an open-ended span, so later requests hit the cache.
    const timestamp = decodeTimestamp(request.sourceTime, media.timeOffset, video.frameDuration);

    const quarterTurn = video.rotation === 90 || video.rotation === 270;
    const natural: Size =
      applyRotation || !quarterTurn
        ? { width: video.displayWidth, height: video.displayHeight }
        : { width: video.displayHeight, height: video.displayWidth };
    const size = bucketSize({ width: request.width, height: request.height }, natural);
    const key: FrameKey = { media: media.key, version: media.version, width: size.width, height: size.height, rotated: applyRotation };

    const hit = this.cache.lookup(key, timestamp);
    if (hit) return hit;
    if (request.mode === "preview") return this.keyframePreview(slot, slot.sink, key, timestamp, size, applyRotation, video.frameDuration);

    const cursor = this.cursor(media, slot.sink, slot.keyframes, request.lane);
    return cursor.at(timestamp, request.mode, async (sample, span) => {
      if (!sample || !span) return null;
      // Another lane may have produced this picture while we waited.
      const again = this.cache.lookup(key, timestamp);
      if (again) return again;
      const bitmap = await sampleToBitmap(sample, size, applyRotation, this.quality);
      return this.cache.insert(key, span, bitmap);
    });
  }

  /**
   * The keyframe at or before `timestamp`, decoded alone (one packet): what
   * scrubbing shows while the exact picture would still take a GOP to decode.
   * It is cached as the exact picture of its own time.
   */
  private async keyframePreview(
    slot: MediaSlot,
    sink: VideoSampleSink,
    key: FrameKey,
    timestamp: number,
    size: Size,
    applyRotation: boolean,
    frameDuration: number | null,
  ): Promise<FrameImage | null> {
    const keyTime = (await slot.keyframes.keyframeAtOrBefore?.(timestamp)) ?? timestamp;
    // The exact lookup just missed, so a cached keyframe does not cover `timestamp`.
    const cached = this.cache.lookup(key, keyTime);
    if (cached) return asPreview(cached, false);
    const sample = await sink.getSample(keyTime);
    if (!sample) return null;
    try {
      const bitmap = await sampleToBitmap(sample, size, applyRotation, this.quality);
      const span = { start: sample.timestamp, end: spanEnd(sample.timestamp, sample.duration, null, frameDuration) };
      return asPreview(this.cache.insert(key, span, bitmap), spanCovers(span, timestamp));
    } finally {
      sample.close();
    }
  }

  /** Close cursors and media leases nobody has used for a while. */
  sweep(): void {
    const now = this.now();
    for (const [id, { cursor, mediaKey }] of this.cursors) {
      if (now - cursor.lastUsed > this.idleCursorMs) {
        this.cursors.delete(id);
        void cursor.close();
        void this.maybeReleaseSlot(mediaKey, now);
      }
    }
    for (const key of this.slots.keys()) void this.maybeReleaseSlot(key, now);
  }

  /** Decoded pictures dropped because playback outran decoding (diagnostics). */
  get droppedFrames(): number {
    let total = 0;
    for (const { cursor } of this.cursors.values()) total += cursor.skipped;
    return total;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    const closing = [...this.cursors.values()].map(({ cursor }) => cursor.close().catch(() => undefined));
    this.cursors.clear();
    await Promise.all(closing);
    for (const pending of this.slots.values()) void pending.then((slot) => slot.lease.release(), () => undefined);
    this.slots.clear();
  }

  // -------------------------------------------------------------------------

  private slot(ref: MediaRef): Promise<MediaSlot> {
    const key = this.media.keyOf(ref);
    if (key === undefined) return Promise.reject(new MediaUnavailableError(ref));
    let pending = this.slots.get(key);
    if (!pending) {
      pending = this.media.acquire(ref).then((lease) => makeSlot(lease, this.now()));
      this.slots.set(key, pending);
      pending.catch(() => this.slots.delete(key));
    }
    return pending;
  }

  private cursor(media: OpenMedia, sink: VideoSampleSink, keyframes: KeyframeIndex, lane: string): DecodeCursor<VideoSample> {
    const id = `${media.key}@${media.version}#${lane}`;
    let entry = this.cursors.get(id);
    if (!entry) {
      entry = { cursor: new DecodeCursor(sink, keyframes, media.video?.frameDuration ?? null, this.now), mediaKey: media.key };
      this.cursors.set(id, entry);
    }
    return entry.cursor;
  }

  private async maybeReleaseSlot(key: string, now: number): Promise<void> {
    const pending = this.slots.get(key);
    if (!pending) return;
    const slot = await pending.catch(() => null);
    if (!slot || this.slots.get(key) !== pending) return;
    const inUse = [...this.cursors.values()].some((c) => c.mediaKey === key);
    if (!inUse && now - slot.lastUsed > this.idleCursorMs) {
      this.slots.delete(key);
      slot.lease.release();
    }
  }

  /** Media bytes changed or went away: drop its pictures, cursors and lease. */
  private async forget(key: string): Promise<void> {
    this.cache.evictMedia(key);
    for (const [id, entry] of this.cursors) {
      if (entry.mediaKey === key) {
        this.cursors.delete(id);
        void entry.cursor.close();
      }
    }
    const pending = this.slots.get(key);
    this.slots.delete(key);
    const slot = await pending?.catch(() => null);
    slot?.lease.release();
  }
}

/** `image`, flagged exact or not, keeping its release. */
function asPreview(image: FrameImage, exact: boolean): FrameImage {
  return { image: image.image, width: image.width, height: image.height, exact, release: () => image.release() };
}

function makeSlot(lease: MediaLease, now: number): MediaSlot {
  const video = lease.media.video;
  if (!video) {
    return { lease, sink: null, keyframes: { nextKeyframeAfter: async () => null }, lastUsed: now };
  }
  const packets = new EncodedPacketSink(video.track);
  const keyframes: KeyframeIndex = {
    async keyframeAtOrBefore(timestamp) {
      const key = (await packets.getKeyPacket(timestamp, { metadataOnly: true })) ?? (await packets.getFirstKeyPacket({ metadataOnly: true }));
      return key ? key.timestamp : null;
    },
    async nextKeyframeAfter(timestamp) {
      const key = await packets.getKeyPacket(timestamp, { metadataOnly: true });
      const next = key ? await packets.getNextKeyPacket(key, { metadataOnly: true }) : await packets.getFirstKeyPacket({ metadataOnly: true });
      return next ? next.timestamp : null;
    },
  };
  return { lease, sink: new VideoSampleSink(video.track), keyframes, lastUsed: now };
}
