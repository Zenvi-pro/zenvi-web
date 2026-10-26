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

export class SourceManager {
  private readonly decoders = new Map<string, { decoder: VideoDecoder; lastFrame: number }>();
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

  /** A cached decoder for one video at one size (`key` names who reads it). */
  private async decoder(key: string, projectPath: string, reader: ProjectFile | undefined, size: { width: number; height: number }, autorotate: boolean): Promise<VideoDecoder> {
    let entry = this.decoders.get(key);
    if (!entry) {
      const file = await this.resolve(projectPath);
      const fps = reader?.fps && reader.fps.num > 0 && reader.fps.den > 0 ? reader.fps : { num: 30, den: 1 };
      const frameCount = Number(reader?.video_length);
      const starts = await streamStarts(file, this.options.signal);
      const info: VideoSourceInfo = {
        path: file,
        fps,
        videoStart: starts.videoStart,
        formatStart: starts.formatStart,
        frameCount: Number.isFinite(frameCount) && frameCount > 0 ? frameCount : undefined,
        autorotate,
      };
      entry = { decoder: new VideoDecoder(info, size, { quality: this.options.quality, signal: this.options.signal }), lastFrame: this.frameCounter };
      this.decoders.set(key, entry);
    }
    entry.lastFrame = this.frameCounter;
    return entry.decoder;
  }

  private async videoFrame(layer: LayerPlan, source: VideoSource): Promise<RgbaImage> {
    const width = Math.max(1, Math.round(layer.drawWidth));
    const height = Math.max(1, Math.round(layer.drawHeight));
    const autorotate = source.applyRotation !== false;
    const key = `${layer.clipId}\0${width}x${height}\0${autorotate ? 1 : 0}`;
    const decoder = await this.decoder(key, source.path, this.files.get(source.fileId), { width, height }, autorotate);
    // LayerSource.time is (k − 1) / reader fps for libopenshot source frame k.
    return decoder.frame(Math.max(0, Math.round(source.frame) - 1));
  }

  /**
   * Frame `frame` (1-based) of a video an effect reads (a matte `mask_reader`,
   * a Displace map), at its coded size like libopenshot's mask reader, which
   * does not rotate frames.
   */
  private async auxVideoFrame(projectPath: string, frame: number): Promise<RgbaImage> {
    const reader = [...this.files.values()].find((f) => f.path === projectPath);
    const width = Math.max(1, Math.round(Number(reader?.width) || 0));
    const height = Math.max(1, Math.round(Number(reader?.height) || 0));
    if (!reader || width <= 1 || height <= 1) return this.auxImage(projectPath, { width: 1, height: 1 });
    const decoder = await this.decoder(`aux\0${projectPath}\0${width}x${height}`, projectPath, reader, { width, height }, false);
    return decoder.frame(Math.max(0, Math.round(frame) - 1));
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
    // Video resources by path: the frame each needs (one per path and frame plan, like the kernels' `images`).
    const videoFrames = new Map<string, number>();
    for (const layer of plan.layers) {
      for (const mask of layer.masks) if (mask.maskPath) imagePaths.add(mask.maskPath);
      for (const effect of layer.effects) {
        for (const p of effect.images ?? []) imagePaths.add(p);
        for (const p of effect.texts ?? []) textPaths.add(p);
        for (const [p, at] of Object.entries(effect.imageFrames ?? {})) if (!videoFrames.has(p)) videoFrames.set(p, at.frame);
      }
    }
    const [layers, images, texts, audio] = await Promise.all([
      Promise.all(plan.layers.map((layer) => this.layerImage(layer))),
      Promise.all([...imagePaths].map(async (p) => [p, await (videoFrames.has(p) ? this.auxVideoFrame(p, videoFrames.get(p)!) : this.auxImage(p, fit))] as const)),
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
        void entry.decoder.close();
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
    await Promise.all([...decoders.map((e) => e.decoder.close()), ...readers.map((e) => e.reader.close())]);
    this.stills.clear();
  }
}
