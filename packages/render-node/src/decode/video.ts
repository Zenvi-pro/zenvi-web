/**
 * Frame-accurate video decoding: one ffmpeg child per active clip streaming
 * raw RGBA at the size the frame plan draws it.
 *
 * Frame numbering follows libopenshot's FFmpegReader: source frame k (0-based
 * here, `k + 1` in libopenshot) is the frame whose timestamp, measured from
 * the first video packet, rounds to k at the reader frame rate
 * (FFmpegReader::ConvertVideoPTStoFrame, FFmpegReader.cpp:2626, with
 * UpdatePTSOffset anchoring to the video stream start, :2614).
 *
 * The ffmpeg command reproduces that mapping:
 *   -ss <video_start + k/fps − δ>          accurate seek, a quarter frame early so
 *                                          float rounding never drops frame k
 *   setpts=PTS-δ/TB                        put frame k's nominal time at 0
 *   fps=<fps>:start_time=0:round=near      one output frame per source frame
 *                                          number, duplicating/dropping like
 *                                          libopenshot does for VFR input
 * Output frame n is then source frame k + n.
 */

import type { Fraction, RgbaImage } from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { AbortedError, spawnManaged, type ManagedChild } from "../ffmpeg/process.js";
import { ffmpegThreads } from "../limits.js";
import { rgbaView } from "../image/rgba.js";

export type ScaleQuality = "export" | "preview";

export interface VideoSourceInfo {
  path: string;
  /** Reader frame rate (project file entry `fps`). */
  fps: Fraction;
  /** Video stream start time in the container, seconds (ffprobe stream start_time). */
  videoStart?: number;
  /** Container start time, seconds (ffprobe format start_time); `-ss` is relative to it. */
  formatStart?: number;
  /** Frames in the source (`video_length`), when known: requests clamp to the last one. */
  frameCount?: number;
  /**
   * Apply container rotation metadata (default true; libopenshot
   * `apply_orientation_metadata`). False decodes the stored orientation.
   */
  autorotate?: boolean;
}

export interface DecodeSize {
  width: number;
  height: number;
}

function fpsValue(fps: Fraction): number {
  return fps.num > 0 && fps.den > 0 ? fps.num / fps.den : 30;
}

/** swscale flags: desktop export uses SWS_BICUBIC (HIGH_QUALITY_SCALING), preview SWS_FAST_BILINEAR (FFmpegReader.cpp:2061). */
function scaleFlags(quality: ScaleQuality): string {
  return quality === "export" ? "bicubic" : "fast_bilinear";
}

/**
 * An image sequence pattern (`frame_%04d.png`). ffmpeg's image2 demuxer
 * reads it at `-framerate` (the file's fps, which the desktop sets on import)
 * with whole-frame timestamps and seeks by frame index, so frame k is the
 * k-th image, as in libopenshot.
 */
function isImageSequence(file: string): boolean {
  const name = file.split(/[\\/]/).pop() ?? file;
  return /%0?\d*d/.test(name);
}

export function videoDecodeArgs(source: VideoSourceInfo, startFrame: number, size: DecodeSize, quality: ScaleQuality = "export"): string[] {
  const fps = fpsValue(source.fps);
  const sequence = isImageSequence(source.path);
  const nominal = (source.videoStart ?? 0) - (source.formatStart ?? 0) + startFrame / fps;
  // image2 timestamps are whole frames: seek exactly (to the microsecond below) and do not shift.
  const seek = sequence ? Math.floor(Math.max(0, nominal) * 1e6) / 1e6 : Math.max(0, nominal - 0.25 / fps);
  // When the seek clamps at 0 the shift must shrink with it.
  const shift = sequence ? 0 : nominal - seek;
  const fpsText = `${source.fps.num > 0 ? source.fps.num : 30}/${source.fps.den > 0 ? source.fps.den : 1}`;
  const filters = [
    shift > 0 ? `setpts=PTS-${shift.toFixed(9)}/TB` : "setpts=PTS",
    `fps=fps=${fpsText}:start_time=0:round=near`,
    `scale=${size.width}:${size.height}:flags=${scaleFlags(quality)}`,
    "format=rgba",
  ];
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-nostdin",
    ...ffmpegThreads("decode"),
    ...(source.autorotate === false ? ["-noautorotate"] : []),
    ...(sequence ? ["-framerate", fpsText] : []),
    ...(seek > 0 ? ["-ss", seek.toFixed(6)] : []),
    "-i", source.path,
    "-map", "0:v:0",
    "-an", "-sn", "-dn",
    "-vf", filters.join(","),
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "pipe:1",
  ];
}

/**
 * One ffmpeg child decoding sequential frames from `startFrame`. Frames are
 * read ahead up to `prefetch` frames, then the pipe is paused (ffmpeg blocks),
 * so memory stays bounded.
 */
export class VideoFrameStream {
  readonly frameBytes: number;
  private readonly managed: ManagedChild;
  private readonly queue: Uint8Array[] = [];
  private partial: Buffer[] = [];
  private partialBytes = 0;
  private waiters: Array<(frame: Uint8Array | undefined) => void> = [];
  private ended = false;
  private error: Error | undefined;
  /** Index of the frame the next `read()` returns. */
  position: number;
  private readonly prefetch: number;

  constructor(
    readonly source: VideoSourceInfo,
    readonly startFrame: number,
    readonly size: DecodeSize,
    options: { quality?: ScaleQuality; prefetch?: number; signal?: AbortSignal } = {},
  ) {
    this.position = startFrame;
    this.frameBytes = size.width * size.height * 4;
    // Read ahead up to ~32 MB (3..16 frames) so ffmpeg keeps decoding while frames composite.
    this.prefetch = options.prefetch ?? Math.max(3, Math.min(16, Math.floor((32 * 1024 * 1024) / Math.max(1, this.frameBytes))));
    const prefetch = this.prefetch;
    this.managed = spawnManaged(resolveBinary("ffmpeg"), videoDecodeArgs(source, startFrame, size, options.quality), {
      signal: options.signal,
    });
    const stdout = this.managed.child.stdout!;
    stdout.on("data", (chunk: Buffer) => {
      let offset = 0;
      while (offset < chunk.length) {
        const need = this.frameBytes - this.partialBytes;
        const take = Math.min(need, chunk.length - offset);
        this.partial.push(chunk.subarray(offset, offset + take));
        this.partialBytes += take;
        offset += take;
        if (this.partialBytes === this.frameBytes) {
          const frame = this.partial.length === 1 ? new Uint8Array(this.partial[0]!) : new Uint8Array(Buffer.concat(this.partial));
          this.partial = [];
          this.partialBytes = 0;
          this.deliver(frame);
        }
      }
      if (this.queue.length >= prefetch) stdout.pause();
    });
    void this.managed.exited.then((code) => {
      this.ended = true;
      const spawnError = this.managed.spawnError();
      if (spawnError) this.error = spawnError;
      else if (options.signal?.aborted) this.error = new AbortedError();
      else if (code !== 0 && code !== null) this.error = this.managed.failure(`Decoding ${source.path} failed`);
      for (const waiter of this.waiters.splice(0)) waiter(undefined);
    });
  }

  private deliver(frame: Uint8Array): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(frame);
    else this.queue.push(frame);
  }

  /** Next frame, or undefined at the end of the stream. Throws if ffmpeg failed. */
  async read(): Promise<Uint8Array | undefined> {
    let frame = this.queue.shift();
    if (!frame && !this.ended) {
      this.managed.child.stdout?.resume();
      frame = await new Promise<Uint8Array | undefined>((resolve) => this.waiters.push(resolve));
    }
    if (this.queue.length < this.prefetch) this.managed.child.stdout?.resume();
    if (!frame) {
      if (this.error) throw this.error;
      return undefined;
    }
    this.position += 1;
    return frame;
  }

  get done(): boolean {
    return this.ended && this.queue.length === 0;
  }

  async close(): Promise<void> {
    this.managed.child.stdout?.destroy();
    await this.managed.kill(500);
  }
}

export interface VideoDecoderOptions {
  quality?: ScaleQuality;
  signal?: AbortSignal;
  /** Keep this many recent frames for backward steps (reverse playback). */
  cacheFrames?: number;
  /** Restart instead of reading forward when the next request is this many frames ahead. */
  maxSkip?: number;
}

/**
 * Serves frames by index for one source at one size. Forward requests read
 * the running stream (skipping frames if needed); backward or far jumps
 * restart ffmpeg at the new position. Recent frames are cached so small
 * backward steps do not restart.
 */
export class VideoDecoder {
  private stream: VideoFrameStream | undefined;
  private readonly cache = new Map<number, Uint8Array>();
  private readonly cacheFrames: number;
  private readonly maxSkip: number;
  /** Frame index past the end of the stream (learned when a stream ends early). */
  private endFrame: number | undefined;
  restarts = 0;

  constructor(
    readonly source: VideoSourceInfo,
    readonly size: DecodeSize,
    private readonly options: VideoDecoderOptions = {},
  ) {
    const frameBytes = size.width * size.height * 4;
    this.cacheFrames = options.cacheFrames ?? Math.max(2, Math.min(24, Math.floor((96 * 1024 * 1024) / Math.max(1, frameBytes))));
    this.maxSkip = options.maxSkip ?? Math.max(30, Math.round(fpsValue(source.fps) * 2));
  }

  private remember(index: number, frame: Uint8Array): void {
    this.cache.set(index, frame);
    if (this.cache.size > this.cacheFrames) {
      const oldest = this.cache.keys().next().value as number;
      this.cache.delete(oldest);
    }
  }

  private clamp(index: number): number {
    let target = Math.max(0, Math.floor(index));
    const count = this.source.frameCount;
    if (count !== undefined && count > 0 && target >= count) target = count - 1;
    if (this.endFrame !== undefined && target >= this.endFrame) target = Math.max(0, this.endFrame - 1);
    return target;
  }

  /**
   * Whether `frame(index)` would read forward on the running stream (no
   * restart): what lets the next clip of the same file take this decoder
   * over where the last one stopped.
   */
  readsForwardTo(index: number): boolean {
    const target = this.clamp(index);
    return this.stream !== undefined && !this.stream.done && target >= this.stream.position && target - this.stream.position <= this.maxSkip;
  }

  /** Drop the recent frames kept for backward steps (a decoder parked between clips needs none). */
  dropCache(): void {
    this.cache.clear();
  }

  /**
   * Start decoding at source frame `index` before it is asked for, so the
   * ffmpeg start-up and seek overlap other work (a render's next shots).
   * Does nothing once a stream is running.
   */
  prime(index: number): void {
    if (this.stream || this.options.signal?.aborted) return;
    this.stream = new VideoFrameStream(this.source, this.clamp(index), this.size, {
      quality: this.options.quality,
      signal: this.options.signal,
    });
    this.restarts += 1;
  }

  /**
   * RGBA of source frame `index` (0-based at the reader frame rate), clamped
   * to the last decodable frame like libopenshot clamps requested frames.
   */
  async frame(index: number): Promise<RgbaImage> {
    if (this.options.signal?.aborted) throw new AbortedError();
    const target = this.clamp(index);
    const cached = this.cache.get(target);
    if (cached) return rgbaView(cached, this.size.width, this.size.height);

    if (!this.stream || target < this.stream.position || target - this.stream.position > this.maxSkip) {
      await this.stream?.close();
      // Start a little before the target when stepping backward so the next
      // backward steps hit the cache.
      const backward = this.stream !== undefined && target < this.stream.position;
      const start = backward ? Math.max(0, target - Math.floor(this.cacheFrames / 2)) : target;
      this.stream = new VideoFrameStream(this.source, start, this.size, {
        quality: this.options.quality,
        signal: this.options.signal,
      });
      this.restarts += 1;
    }
    const stream = this.stream;
    let last: Uint8Array | undefined;
    let lastIndex = -1;
    while (stream.position <= target) {
      const index = stream.position;
      const frame = await stream.read();
      if (!frame) break;
      last = frame;
      lastIndex = index;
      this.remember(index, frame);
    }
    if (lastIndex === target && last) return rgbaView(last, this.size.width, this.size.height);
    // The stream ended before `target`: the source is shorter than asked.
    this.endFrame = stream.position;
    const fallback = last ?? this.cache.get(stream.position - 1);
    if (fallback) return rgbaView(fallback, this.size.width, this.size.height);
    if (stream.startFrame > 0) {
      // Seeked past the real end (frame count metadata was optimistic): step
      // back a window and take the last frame that decodes.
      await stream.close();
      this.stream = new VideoFrameStream(this.source, Math.max(0, stream.startFrame - this.maxSkip), this.size, {
        quality: this.options.quality,
        signal: this.options.signal,
      });
      this.restarts += 1;
      let tail: Uint8Array | undefined;
      for (;;) {
        const index = this.stream.position;
        const frame = await this.stream.read();
        if (!frame) break;
        tail = frame;
        this.remember(index, frame);
      }
      this.endFrame = this.stream.position;
      if (tail) return rgbaView(tail, this.size.width, this.size.height);
    }
    throw new Error(`No video frames could be decoded from ${this.source.path}`);
  }

  async close(): Promise<void> {
    await this.stream?.close();
    this.stream = undefined;
    this.cache.clear();
  }
}
