/**
 * In-browser export: every frame of the range planned by the engine, drawn by
 * the preview's compositor at output size and encoded with WebCodecs through
 * Mediabunny; audio mixed offline in windows by the preview's voices.
 */

import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  MkvOutputFormat,
  MovOutputFormat,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type OutputFormat,
  type StreamTargetChunk,
  type Target,
} from "mediabunny";
import { projectAtFrameRate, type Project } from "@zenvi/engine";
import type { AudioPlan } from "@zenvi/engine/render";
import type { ContainerFormat, ExportOptions } from "@zenvi/engine/tools";
import { windowEnd } from "../audio/channels.js";
import { mixWindow, planHasSound } from "../audio/mixdown.js";
import { AudioRenderer } from "../audio/renderer.js";
import type { LayerError } from "../compositor/compositor.js";
import { defaultEngine, type RenderEngine } from "../engine.js";
import type { MediaRegistry } from "../media/registry.js";
import type { SvgRasterizer } from "../media/svg.js";
import { canEncodeNamed, chooseCodecs, ExportError, type CodecChoice, type EncodeSupport, type WebContainer } from "./codecs.js";
import { FrameRenderer } from "./frame-renderer.js";

export interface ExportProgress {
  /** 0..1 */
  fraction: number;
  /** Frames encoded so far. */
  frame: number;
  frames: number;
  stage: "video" | "audio" | "finalizing";
}

export interface ExportRunOptions {
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
  /** Planner and kernels. Default: `@zenvi/engine`. */
  engine?: RenderEngine;
  /** Called once with how the export deviates from the options (container, codecs, size). */
  onNotes?: (notes: string[], choice: CodecChoice) => void;
  /** Called for layers that failed to render (the frame is still encoded without them). */
  onLayerError?: (error: LayerError, frame: number) => void;
  /** Encoder capability probes (tests). Default: Mediabunny's. */
  support?: EncodeSupport;
  /**
   * Export without sound when the browser cannot encode audio. Default false:
   * such an export fails with `ExportError` code `no-audio-encoder`, so the UI
   * can ask the person (or offer a cloud render) instead of dropping sound.
   * A timeline with nothing audible, or a project with `channels: 0`, never
   * needs it: its file simply has no audio track.
   */
  allowVideoOnly?: boolean;
  svgRasterizer?: SvgRasterizer;
}

/** Audio is mixed about this many seconds at a time (windows end on audio frame boundaries). */
const AUDIO_WINDOW = 10;

const QUALITY: Record<NonNullable<ExportOptions["quality"]>, "low" | "medium" | "high" | "very-high"> = {
  low: "low",
  medium: "medium",
  high: "high",
  lossless: "very-high",
};

const defaultSupport: EncodeSupport = {
  canEncodeVideo: (codec, options) => canEncodeVideo(codec, options),
  canEncodeAudio: (codec, options) => canEncodeAudio(codec, options),
};

/** `canEncodeNamed` with this browser's encoders. */
export function canExportWith(format: ContainerFormat, videoCodec: string, audioCodec: string, frame?: { width: number; height: number; fps: number }): Promise<boolean> {
  return canEncodeNamed(format, videoCodec, audioCodec, defaultSupport, frame);
}

function outputFormat(container: WebContainer): OutputFormat {
  switch (container) {
    case "mp4":
      return new Mp4OutputFormat();
    case "mov":
      return new MovOutputFormat();
    case "webm":
      return new WebMOutputFormat();
    case "mkv":
      return new MkvOutputFormat();
    case "wav":
      return new WavOutputFormat();
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The export was cancelled", "AbortError");
}

/**
 * Render and encode `project` (the whole timeline, or `options.range`) in
 * memory. Resolves with the file; rejects with the signal's reason when
 * cancelled. Long exports should use `exportProjectTo` (streams to disk).
 */
export async function exportProject(project: Project, media: MediaRegistry, options: ExportOptions, run: ExportRunOptions = {}): Promise<Blob> {
  const target = new BufferTarget();
  const { mimeType } = await encode(project, media, options, run, target);
  if (!target.buffer) throw new Error("Export produced no data");
  return new Blob([target.buffer], { type: mimeType });
}

export interface StreamedExport {
  mimeType: string;
  /** Size of the written file, bytes. */
  bytes: number;
  /** How the export deviates from the options (container, codecs, size), if it does. */
  notes: string[];
}

/**
 * Render and encode `project` into `writable` — typically an origin private
 * file system `FileSystemWritableFileStream` — so the file never has to fit in
 * memory. The stream is closed when the file is complete and aborted on
 * failure or cancel (an aborted OPFS writable discards the partial file).
 */
export async function exportProjectTo(
  writable: WritableStream<StreamTargetChunk>,
  project: Project,
  media: MediaRegistry,
  options: ExportOptions,
  run: ExportRunOptions = {},
): Promise<StreamedExport> {
  // Mediabunny locks the stream it writes to; keep our own writer on the
  // caller's stream so a failure can abort it.
  const sink = writable.getWriter();
  let bytes = 0;
  const proxy = new WritableStream<StreamTargetChunk>({
    write: async (chunk) => {
      bytes = Math.max(bytes, chunk.position + chunk.data.byteLength);
      await sink.ready;
      await sink.write(chunk);
    },
    close: () => sink.close(),
    abort: (reason) => sink.abort(reason),
  });
  let notes: string[] = [];
  try {
    const { mimeType } = await encode(project, media, options, { ...run, onNotes: (n, choice) => ((notes = n), run.onNotes?.(n, choice)) }, new StreamTarget(proxy, { chunked: true }));
    return { mimeType, bytes, notes };
  } catch (error) {
    await sink.abort(error).catch(() => undefined);
    throw error;
  } finally {
    sink.releaseLock();
  }
}

export interface ExportAudio {
  plan: AudioPlan;
  sampleRate: number;
  channels: number;
  /** Whether the file gets an audio track. */
  hasAudio: boolean;
}

/**
 * The audio an export encodes. A project with no channels (`channels: 0`) or
 * a range where nothing is audible gets no audio track, so it needs no audio
 * encoder; a WAV export always has one (silence when nothing plays).
 */
export function exportAudio(project: Project, engine: RenderEngine, options: Pick<ExportOptions, "format" | "sampleRate" | "channels">, range: { start: number; end: number }): ExportAudio {
  const sampleRate = options.sampleRate ?? project.sample_rate ?? 48000;
  const channels = Math.max(0, Math.trunc(options.channels ?? project.channels ?? 2) || 0);
  if (options.format === "wav" && channels < 1) throw new ExportError("unsupported-format", "A WAV export needs at least one audio channel");
  if (channels < 1) return { plan: { sampleRate, channels: 0, start: range.start, end: range.end, segments: [] }, sampleRate, channels: 0, hasAudio: false };
  const plan = engine.planAudio(project, range);
  return { plan, sampleRate, channels, hasAudio: options.format === "wav" || planHasSound(plan) };
}

/** The export pipeline, writing to any Mediabunny target. */
async function encode(source: Project, media: MediaRegistry, options: ExportOptions, run: ExportRunOptions, target: Target): Promise<{ mimeType: string }> {
  const engine = run.engine ?? defaultEngine;
  const signal = run.signal;
  if (signal?.aborted) throw abortReason(signal);

  const fps = options.fps && options.fps.num > 0 && options.fps.den > 0 ? options.fps : source.fps;
  // Frames at the export's rate, keyframes rescaled to it (as the desktop's export and render-node do).
  const project = projectAtFrameRate(source, fps);
  const rate = fps.num / fps.den;
  const last = engine.lastFrame(project);
  const timelineEnd = last > 0 ? engine.frameTime(project, last + 1) : 0;
  const start = Math.max(0, options.range?.start ?? 0);
  // An explicit range may run past the last clip (black, silent frames).
  const end = options.range ? Math.max(start, options.range.end) : timelineEnd;
  const frameCount = Math.round((end - start) * rate);
  if (!(frameCount > 0)) throw new ExportError("empty-range", "Nothing to export: the range has no frames");

  const { plan: audioPlan, sampleRate, channels, hasAudio } = exportAudio(project, engine, options, { start, end });
  const choice = await chooseCodecs(
    {
      format: options.format,
      width: options.width,
      height: options.height,
      frameRate: rate,
      ...(options.videoCodec ? { videoCodec: options.videoCodec } : {}),
      ...(options.audioCodec ? { audioCodec: options.audioCodec } : {}),
      ...(options.videoBitrate ? { videoBitrate: options.videoBitrate } : {}),
      ...(options.audioBitrate ? { audioBitrate: options.audioBitrate } : {}),
      sampleRate,
      channels,
      hasAudio,
      ...(run.allowVideoOnly ? { allowVideoOnly: true } : {}),
    },
    run.support ?? defaultSupport,
  );
  if (choice.notes.length > 0) run.onNotes?.(choice.notes, choice);

  const output = new Output({ format: outputFormat(choice.container), target });
  const frames = choice.videoCodec ? new FrameRenderer({ media, engine, ...(run.svgRasterizer ? { svgRasterizer: run.svgRasterizer } : {}) }) : null;
  const audio = choice.audioCodec ? new AudioRenderer({ media, engine }) : null;
  const quality = new Quality(options.videoBitrate ? { bitrate: options.videoBitrate } : QUALITY[options.quality ?? "high"]);
  const audioQuality = new Quality(options.audioBitrate ? { bitrate: options.audioBitrate } : "high");

  let videoSource: CanvasSource | null = null;
  if (frames && choice.videoCodec) {
    const surface = frames.surface({ width: choice.width, height: choice.height });
    videoSource = new CanvasSource(surface.canvas, { codec: choice.videoCodec, quality, keyFrameInterval: 2, latencyMode: "quality" });
    output.addVideoTrack(videoSource, { frameRate: rate });
  }
  let audioSource: AudioBufferSource | null = null;
  if (audio && choice.audioCodec) {
    audioSource = new AudioBufferSource({ codec: choice.audioCodec, quality: audioQuality });
    output.addAudioTrack(audioSource);
  }

  const report = (frame: number, stage: ExportProgress["stage"]) =>
    run.onProgress?.({ fraction: stage === "finalizing" ? 1 : Math.min(0.999, frame / frameCount), frame, frames: frameCount, stage });

  let audioAt = start;
  const mixUntil = async (until: number) => {
    if (!audio || !audioSource) return;
    while (audioAt < until - 1e-9) {
      if (signal?.aborted) throw abortReason(signal);
      const to = windowEnd(audioAt, AUDIO_WINDOW, end, sampleRate, fps, channels);
      const buffer = await mixWindow(audio, audioPlan, audioAt, to, sampleRate, channels, fps);
      await audioSource.add(buffer);
      await audio.releaseEnded(audioPlan, to);
      audioAt = to;
    }
  };

  try {
    await output.start();
    for (let i = 0; i < frameCount; i += 1) {
      if (signal?.aborted) throw abortReason(signal);
      const time = start + i / rate;
      if (frames && videoSource) {
        const frame = engine.frameAt(project, time);
        const errors = await frames.draw(project, frame, { width: choice.width, height: choice.height }, "sequential");
        for (const error of errors) run.onLayerError?.(error, frame);
        await videoSource.add(i / rate, 1 / rate);
        if (i % 120 === 119) frames.sweep();
      }
      // Keep audio just ahead of video so the muxer interleaves without buffering.
      await mixUntil(Math.min(end, time + 1 / rate));
      report(i + 1, "video");
    }
    await mixUntil(end);
    report(frameCount, "finalizing");
    videoSource?.close();
    audioSource?.close();
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw signal?.aborted ? abortReason(signal) : error;
  } finally {
    await frames?.dispose();
    await audio?.dispose();
  }
  return { mimeType: await output.getMimeType().catch(() => output.format.mimeType) };
}

export interface ExportFrameOptions {
  engine?: RenderEngine;
  /** JPEG/WebP quality 0..1. Default 0.92. */
  quality?: number;
  svgRasterizer?: SvgRasterizer;
}

/** One timeline frame as an image (desktop "Save Current Frame"; tool `preview_frame`). */
export async function exportFrame(
  project: Project,
  media: MediaRegistry,
  seconds: number,
  size: { width: number; height: number },
  type: "image/png" | "image/jpeg" | "image/webp" = "image/png",
  options: ExportFrameOptions = {},
): Promise<Blob> {
  const renderer = new FrameRenderer({ media, ...(options.engine ? { engine: options.engine } : {}), ...(options.svgRasterizer ? { svgRasterizer: options.svgRasterizer } : {}) });
  try {
    const frame = renderer.engine.frameAt(project, Math.max(0, seconds));
    await renderer.draw(project, frame, size, "seek");
    const { canvas } = renderer.surface(size);
    return await canvas.convertToBlob({ type, ...(type === "image/png" ? {} : { quality: options.quality ?? 0.92 }) });
  } finally {
    await renderer.dispose();
  }
}
