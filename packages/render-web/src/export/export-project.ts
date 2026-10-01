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
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type OutputFormat,
} from "mediabunny";
import type { Project } from "@zenvi/engine";
import type { ExportOptions } from "@zenvi/engine/tools";
import { mixWindow } from "../audio/mixdown.js";
import { AudioRenderer } from "../audio/renderer.js";
import type { LayerError } from "../compositor/compositor.js";
import { defaultEngine, type RenderEngine } from "../engine.js";
import type { MediaRegistry } from "../media/registry.js";
import type { SvgRasterizer } from "../media/svg.js";
import { chooseCodecs, ExportError, type CodecChoice, type EncodeSupport, type WebContainer } from "./codecs.js";
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
  svgRasterizer?: SvgRasterizer;
}

/** Audio is mixed this many seconds at a time. */
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
 * Render and encode `project` (the whole timeline, or `options.range`).
 * Resolves with the file; rejects with the signal's reason when cancelled.
 */
export async function exportProject(project: Project, media: MediaRegistry, options: ExportOptions, run: ExportRunOptions = {}): Promise<Blob> {
  const engine = run.engine ?? defaultEngine;
  const signal = run.signal;
  if (signal?.aborted) throw abortReason(signal);

  const fps = options.fps && options.fps.num > 0 && options.fps.den > 0 ? options.fps : project.fps;
  const rate = fps.num / fps.den;
  const last = engine.lastFrame(project);
  const timelineEnd = last > 0 ? engine.frameTime(project, last + 1) : 0;
  const start = Math.max(0, options.range?.start ?? 0);
  // An explicit range may run past the last clip (black, silent frames).
  const end = options.range ? Math.max(start, options.range.end) : timelineEnd;
  const frameCount = Math.round((end - start) * rate);
  if (!(frameCount > 0)) throw new ExportError("empty-range", "Nothing to export: the range has no frames");

  const sampleRate = options.sampleRate ?? project.sample_rate ?? 48000;
  const channels = options.channels ?? project.channels ?? 2;
  const audioPlan = engine.planAudio(project, { start, end });
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
      hasAudio: audioPlan.segments.length > 0 || options.format === "wav",
    },
    run.support ?? defaultSupport,
  );
  if (choice.notes.length > 0) run.onNotes?.(choice.notes, choice);

  const target = new BufferTarget();
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
      const to = Math.min(end, audioAt + AUDIO_WINDOW);
      const buffer = await mixWindow(audio, audioPlan, audioAt, to, sampleRate, channels);
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
  const buffer = target.buffer;
  if (!buffer) throw new Error("Export produced no data");
  return new Blob([buffer], { type: await output.getMimeType().catch(() => output.format.mimeType) });
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
