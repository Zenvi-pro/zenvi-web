/**
 * Everything a frame plan needs decoded, per the engine compositor's
 * contract (scratchpad/requests/W2-render.md):
 *
 * - video layers: the frame at draw size (one ffmpeg child per clip);
 * - raster stills: the natural image, EXIF-oriented (the compositor scales
 *   it with Qt's smooth-scale, reproducing QtImageReader);
 * - SVG layers: rasterized at draw size (vector, so no rescale);
 * - color layers: nothing;
 * - masks / effect images: natural size (SVG fitted to the canvas like
 *   QtImageReader); LUT texts; per-layer clip audio when a layer asks.
 *
 * One `SourceManager` serves one render or preview and owns its children.
 */

import { readFile } from "node:fs/promises";
import type { FramePlan, KernelAudio, LayerPlan, Project, ProjectFile, RgbaImage } from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { runBinary } from "../ffmpeg/process.js";
import { imageOrientation, orientationSwapsAxes } from "../probe/exif.js";
import { streamStarts } from "../probe/starts.js";
import { readSvgFile, svgIntrinsicSize } from "../svg/rasterize.js";
import { AudioSampleReader, type LayerAudioRequest } from "./audio.js";
import { decodeStill, isSvgPath, StillCache } from "./still.js";
import { VideoDecoder, type ScaleQuality, type VideoSourceInfo } from "./video.js";

/** Maps a path as stored in the project (absolute, relative, `@transitions/…`) to a local file. */
export type MediaResolver = (projectPath: string) => string | Promise<string>;

export interface SourceManagerOptions {
  resolveMedia: MediaResolver;
  quality?: ScaleQuality;
  signal?: AbortSignal;
  /** Close a clip's decoders after this many frames without use. */
  idleFrames?: number;
}

export interface PreparedFrame {
  /** Per `plan.layers` index; null for color layers. */
  layers: (RgbaImage | null)[];
  images: Map<string, RgbaImage>;
  texts: Map<string, string>;
  /** Per layer index, when the layer's plan asks for audio. */
  audio: (KernelAudio | null)[];
}

type VideoSource = Extract<LayerPlan["source"], { kind: "video" }>;

interface DecoderEntry {
  decoder: Promise<VideoDecoder>;
  lastFrame: number;
  /** Started by `warm` and not drawn yet. */
  warming: boolean;
}

/** Decoders `warm` may have started and not yet drawn, at most (each holds an ffmpeg child and a few frames). */
const MAX_WARMING = 4;

/** 0-based source frame index of a video layer: LayerSource.time is (k − 1) / reader fps for libopenshot source frame k. */
function sourceIndex(source: VideoSource): number {
  return Math.max(0, Math.round(source.frame) - 1);
}

export class SourceManager {
  private readonly decoders = new Map<string, DecoderEntry>();
  private readonly audioReaders = new Map<string, { reader: AudioSampleReader; lastFrame: number }>();
  private readonly stills = new StillCache();
  private readonly resolved = new Map<string, Promise<string>>();
  private readonly texts = new Map<string, Promise<string>>();
  private readonly naturalSizes = new Map<string, Promise<{ width: number; height: number }>>();
  private readonly files: Map<string, ProjectFile>;
  private frameCounter = 0;
  private closed = false;

  constructor(
    project: Project,
    private readonly options: SourceManagerOptions,
  ) {
    this.files = new Map(project.files.map((f) => [f.id, f]));
  }

  /** Resolve a project path to a local file (memoized). */
  resolve(projectPath: string): Promise<string> {
    let hit = this.resolved.get(projectPath);
    if (!hit) {
      hit = Promise.resolve(this.options.resolveMedia(projectPath));
      this.resolved.set(projectPath, hit);
    }
    return hit;
  }

  private decoderKey(layer: LayerPlan, source: VideoSource): string {
    const width = Math.max(1, Math.round(layer.drawWidth));
    const height = Math.max(1, Math.round(layer.drawHeight));
    return `${layer.clipId}\0${width}x${height}\0${source.applyRotation !== false ? 1 : 0}`;
  }

  private async openDecoder(layer: LayerPlan, source: VideoSource): Promise<VideoDecoder> {
    const width = Math.max(1, Math.round(layer.drawWidth));
    const height = Math.max(1, Math.round(layer.drawHeight));
    const file = await this.resolve(source.path);
    const reader = this.files.get(source.fileId);
    const fps = reader?.fps && reader.fps.num > 0 && reader.fps.den > 0 ? reader.fps : { num: 30, den: 1 };
    const frameCount = Number(reader?.video_length);
    const starts = await streamStarts(file, this.options.signal);
    const info: VideoSourceInfo = {
      path: file,
      fps,
      videoStart: starts.videoStart,
      formatStart: starts.formatStart,
      frameCount: Number.isFinite(frameCount) && frameCount > 0 ? frameCount : undefined,
      autorotate: source.applyRotation !== false,
    };
    return new VideoDecoder(info, { width, height }, { quality: this.options.quality, signal: this.options.signal });
  }

  private async videoFrame(layer: LayerPlan, source: VideoSource): Promise<RgbaImage> {
    const key = this.decoderKey(layer, source);
    let entry = this.decoders.get(key);
    if (!entry) {
      entry = { decoder: this.openDecoder(layer, source), lastFrame: this.frameCounter, warming: false };
      this.decoders.set(key, entry);
    }
    entry.lastFrame = this.frameCounter;
    entry.warming = false;
    return (await entry.decoder).frame(sourceIndex(source));
  }

  /**
   * Start decoding the video layers of a frame that will be prepared in
   * about `ahead` frames, at the source frame it shows, so a cut to a new
   * clip does not wait for ffmpeg to start and seek. Clips already open are
   * left alone (their decoder reads ahead on its own). Pictures are the same
   * as without warming: the decoder just started earlier.
   */
  warm(plan: FramePlan, ahead: number): void {
    if (this.closed) return;
    for (const layer of plan.layers) {
      const source = layer.source;
      if (source.kind !== "video") continue;
      const key = this.decoderKey(layer, source);
      if (this.decoders.has(key)) continue;
      let warming = 0;
      for (const entry of this.decoders.values()) if (entry.warming) warming += 1;
      if (warming >= MAX_WARMING) return;
      const decoder = this.openDecoder(layer, source);
      // Kept from the idle sweep until it is due; a failure surfaces when the frame is prepared.
      this.decoders.set(key, { decoder, lastFrame: this.frameCounter + ahead, warming: true });
      decoder.then(
        (d) => {
          if (!this.closed) d.prime(sourceIndex(source));
        },
        () => undefined,
      );
    }
  }

  /** Natural size of a raster image after EXIF orientation. */
  private naturalSize(file: string): Promise<{ width: number; height: number }> {
    let hit = this.naturalSizes.get(file);
    if (!hit) {
      hit = Promise.all([
        runBinary(resolveBinary("ffprobe"), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file], {
          signal: this.options.signal,
          timeoutMs: 60_000,
        }),
        imageOrientation(file).catch(() => 1 as const),
      ]).then(([{ stdout }, orientation]) => {
        const [w, h] = stdout.toString("utf8").trim().split("x").map(Number);
        if (!w || !h) throw new Error(`Cannot read the image size of ${file}`);
        return orientationSwapsAxes(orientation) ? { width: h, height: w } : { width: w, height: h };
      });
      this.naturalSizes.set(file, hit);
    }
    return hit;
  }

  private async naturalStill(file: string): Promise<RgbaImage> {
    const size = await this.naturalSize(file);
    return this.stills.get(file, size, () => decodeStill(file, size, { quality: this.options.quality, signal: this.options.signal }));
  }

  /** The source image for one layer, or null for color layers. */
  async layerImage(layer: LayerPlan): Promise<RgbaImage | null> {
    if (this.closed) throw new Error("SourceManager is closed");
    const source = layer.source;
    switch (source.kind) {
      case "video":
        return this.videoFrame(layer, source);
      case "image": {
        const file = await this.resolve(source.path);
        if (!isSvgPath(file)) return this.naturalStill(file);
        const size = { width: Math.max(1, Math.round(layer.drawWidth)), height: Math.max(1, Math.round(layer.drawHeight)) };
        return this.stills.get(file, size, () => decodeStill(file, size, { signal: this.options.signal }));
      }
      case "svg": {
        const file = await this.resolve(source.path);
        const size = { width: Math.max(1, Math.round(layer.drawWidth)), height: Math.max(1, Math.round(layer.drawHeight)) };
        return this.stills.get(file, size, () => decodeStill(file, size, { signal: this.options.signal }));
      }
      case "color":
        return null;
    }
  }

  /** A mask / effect image at natural size (SVG fitted to `fit` keeping its aspect). */
  async auxImage(projectPath: string, fit: { width: number; height: number }): Promise<RgbaImage> {
    const file = await this.resolve(projectPath);
    if (isSvgPath(file)) {
      const natural = await svgIntrinsicSize(await readSvgFile(file));
      const scale = Math.min(fit.width / natural.width, fit.height / natural.height);
      const size = { width: Math.max(1, Math.round(natural.width * scale)), height: Math.max(1, Math.round(natural.height * scale)) };
      return this.stills.get(file, size, () => decodeStill(file, size, { signal: this.options.signal }));
    }
    return this.naturalStill(file);
  }

  /** A text resource (e.g. a `.cube` LUT), read once. */
  text(projectPath: string): Promise<string> {
    let hit = this.texts.get(projectPath);
    if (!hit) {
      hit = this.resolve(projectPath).then((file) => readFile(file, "utf8"));
      this.texts.set(projectPath, hit);
    }
    return hit;
  }

  private async layerAudio(layer: LayerPlan, request: LayerAudioRequest): Promise<KernelAudio> {
    const key = `${layer.clipId}\0${request.sampleRate}\0${request.channels}`;
    let entry = this.audioReaders.get(key);
    if (!entry) {
      const file = await this.resolve(request.path);
      const starts = await streamStarts(file, this.options.signal);
      entry = { reader: new AudioSampleReader(file, request.sampleRate, request.channels, starts, this.options.signal), lastFrame: this.frameCounter };
      this.audioReaders.set(key, entry);
    }
    entry.lastFrame = this.frameCounter;
    return { sampleRate: request.sampleRate, channels: await entry.reader.read(request.sourceStart, request.samples) };
  }

  /** Decode everything `plan` references. */
  async prepare(plan: FramePlan): Promise<PreparedFrame> {
    this.frameCounter += 1;
    const fit = { width: plan.width, height: plan.height };
    const imagePaths = new Set<string>();
    const textPaths = new Set<string>();
    for (const layer of plan.layers) {
      for (const mask of layer.masks) if (mask.maskPath) imagePaths.add(mask.maskPath);
      for (const effect of layer.effects) {
        for (const p of effect.images ?? []) imagePaths.add(p);
        for (const p of effect.texts ?? []) textPaths.add(p);
      }
    }
    const [layers, images, texts, audio] = await Promise.all([
      Promise.all(plan.layers.map((layer) => this.layerImage(layer))),
      Promise.all([...imagePaths].map(async (p) => [p, await this.auxImage(p, fit)] as const)),
      Promise.all([...textPaths].map(async (p) => [p, await this.text(p)] as const)),
      Promise.all(
        plan.layers.map((layer) => {
          const request = (layer as { audio?: LayerAudioRequest }).audio;
          return request ? this.layerAudio(layer, request) : Promise.resolve(null);
        }),
      ),
    ]);
    this.sweep();
    return { layers, images: new Map(images), texts: new Map(texts), audio };
  }

  /** Stop decoders whose clips have not been drawn recently. */
  private sweep(): void {
    const idle = this.options.idleFrames ?? 3;
    for (const [key, entry] of this.decoders) {
      if (this.frameCounter - entry.lastFrame > idle) {
        void entry.decoder.then((d) => d.close(), () => undefined);
        this.decoders.delete(key);
      }
    }
    for (const [key, entry] of this.audioReaders) {
      if (this.frameCounter - entry.lastFrame > idle) {
        void entry.reader.close();
        this.audioReaders.delete(key);
      }
    }
  }

  get activeDecoders(): number {
    return this.decoders.size;
  }

  async close(): Promise<void> {
    this.closed = true;
    const decoders = [...this.decoders.values()];
    const readers = [...this.audioReaders.values()];
    this.decoders.clear();
    this.audioReaders.clear();
    await Promise.all([...decoders.map((e) => e.decoder.then((d) => d.close(), () => undefined)), ...readers.map((e) => e.reader.close())]);
    this.stills.clear();
  }
}
