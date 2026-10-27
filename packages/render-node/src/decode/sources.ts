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
 *   QtImageReader); videos an effect reads (a matte `mask_reader`) per
 *   layer, since two clips of one file read different frames of its matte;
 *   LUT texts; per-layer clip audio when a layer asks.
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
  /** Per layer index: this frame of each video its effects read, by path; null when none. */
  layerImages: (Map<string, RgbaImage> | null)[];
  texts: Map<string, string>;
  /** Per layer index, when the layer's plan asks for audio. */
  audio: (KernelAudio | null)[];
}

type VideoSource = Extract<LayerPlan["source"], { kind: "video" }>;

interface DecoderEntry {
  decoder: Promise<VideoDecoder>;
  /** The decoder once it is open (adoption needs its stream position now). */
  ready?: VideoDecoder;
  /** File, draw size and rotation: clips with the same one can share the decoder, one after another. */
  fileKey: string;
  /** Clips drawn with it, or about to be. */
  clips: Set<string>;
  lastFrame: number;
  /** Started by `warm` and not drawn yet. */
  warming: boolean;
  /** When it was parked (its clips ended), for the parking limit. */
  parkedAt?: number;
  /**
   * Settles once the last frame asked of it is served. Clips sharing it take turns: `frame` reads one stream, and a
   * clip hidden for a frame (has_video, a zero-size crop) can show again next to the clip it handed its decoder to.
   */
  turn: Promise<unknown>;
}

/** Decoders `warm` may have started and not yet drawn, at most (each holds an ffmpeg child and a few frames). */
const MAX_WARMING = 4;
/** Decoders kept after their clip ended, for the next clip of the same file (each holds a paused ffmpeg child). */
const MAX_PARKED = 6;
/** Frames a parked decoder waits for a clip to take it over. */
const PARK_FRAMES = 150;
/** File-key prefix of the decoders effects read (mattes, Displace maps): kept per clip, never shared or parked. */
const AUX_KEY = "aux\0";

function closeEntry(entry: DecoderEntry): Promise<void> {
  return entry.decoder.then(
    (d) => d.close(),
    () => undefined,
  );
}

/** 0-based source frame index of a video layer: LayerSource.time is (k − 1) / reader fps for libopenshot source frame k. */
function sourceIndex(source: VideoSource): number {
  return Math.max(0, Math.round(source.frame) - 1);
}

export class SourceManager {
  /** Per clip (and draw size); a decoder handed from one clip to the next is under both keys. */
  private readonly decoders = new Map<string, DecoderEntry>();
  private readonly parked: DecoderEntry[] = [];
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
    return `${layer.clipId}\0${this.fileKey(layer, source)}`;
  }

  private fileKey(layer: LayerPlan, source: VideoSource): string {
    const width = Math.max(1, Math.round(layer.drawWidth));
    const height = Math.max(1, Math.round(layer.drawHeight));
    return `${source.fileId}\0${source.path}\0${width}x${height}\0${source.applyRotation !== false ? 1 : 0}`;
  }

  /** A decoder for one video at one size. */
  private async openDecoder(projectPath: string, reader: ProjectFile | undefined, size: { width: number; height: number }, autorotate: boolean): Promise<VideoDecoder> {
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
    return new VideoDecoder(info, size, { quality: this.options.quality, signal: this.options.signal });
  }

  private newEntry(layer: LayerPlan, source: VideoSource, lastFrame: number, warming: boolean): DecoderEntry {
    const size = { width: Math.max(1, Math.round(layer.drawWidth)), height: Math.max(1, Math.round(layer.drawHeight)) };
    const decoder = this.openDecoder(source.path, this.files.get(source.fileId), size, source.applyRotation !== false);
    return this.entryOf(decoder, this.fileKey(layer, source), layer.clipId, lastFrame, warming);
  }

  private entryOf(decoder: Promise<VideoDecoder>, fileKey: string, clipId: string, lastFrame: number, warming: boolean): DecoderEntry {
    const entry: DecoderEntry = { decoder, fileKey, clips: new Set([clipId]), lastFrame, warming, turn: Promise.resolve() };
    entry.decoder.then(
      (d) => (entry.ready = d),
      () => undefined,
    );
    return entry;
  }

  /** Frame `index` (0-based) of an entry's decoder, after the frames already asked of it. */
  private async entryFrame(entry: DecoderEntry, index: number): Promise<RgbaImage> {
    entry.lastFrame = Math.max(entry.lastFrame, this.frameCounter);
    entry.warming = false;
    const decoder = await entry.decoder;
    const picture = entry.turn.then(() => decoder.frame(index));
    entry.turn = picture.catch(() => undefined);
    return picture;
  }

  /**
   * A decoder of the same file and size that can read forward to this
   * clip's first frame instead of starting ffmpeg and seeking: a parked one
   * (its clip ended), or, when warming, one whose clips are not in the frame
   * the new clip starts in (they will have ended by then). Montages cut
   * one source in order, so a shot usually starts a few frames after an
   * earlier shot of the same file stopped. The pictures are the ones the
   * decoder would give a single clip reading forward.
   */
  private adopt(layer: LayerPlan, source: VideoSource, inPlan?: ReadonlySet<string>): DecoderEntry | undefined {
    const fileKey = this.fileKey(layer, source);
    const target = sourceIndex(source);
    const parked = this.parked.findIndex((e) => e.fileKey === fileKey && e.ready!.readsForwardTo(target));
    let entry: DecoderEntry | undefined;
    if (parked >= 0) {
      entry = this.parked.splice(parked, 1)[0]!;
      entry.parkedAt = undefined;
    } else if (inPlan) {
      for (const candidate of new Set(this.decoders.values())) {
        if (candidate.fileKey !== fileKey || !candidate.ready?.readsForwardTo(target)) continue;
        if ([...candidate.clips].some((clip) => inPlan.has(clip))) continue;
        entry = candidate;
        break;
      }
    }
    if (!entry) return undefined;
    entry.clips.add(layer.clipId);
    return entry;
  }

  private async videoFrame(layer: LayerPlan, source: VideoSource): Promise<RgbaImage> {
    const key = this.decoderKey(layer, source);
    let entry = this.decoders.get(key);
    if (!entry) {
      entry = this.adopt(layer, source) ?? this.newEntry(layer, source, this.frameCounter, false);
      this.decoders.set(key, entry);
    }
    return this.entryFrame(entry, sourceIndex(source));
  }

  /**
   * Frame `frame` (1-based) of a video an effect reads (a matte `mask_reader`,
   * a Displace map), at its coded size like libopenshot's mask reader, which
   * does not rotate frames.
   */
  private async auxVideoFrame(clipId: string, projectPath: string, frame: number): Promise<RgbaImage> {
    const reader = [...this.files.values()].find((f) => f.path === projectPath);
    const width = Math.max(1, Math.round(Number(reader?.width) || 0));
    const height = Math.max(1, Math.round(Number(reader?.height) || 0));
    if (!reader || width <= 1 || height <= 1) return this.auxImage(projectPath, { width: 1, height: 1 });
    // One decoder per clip, like layer videos: clones of a clip read its matte at different frames.
    // Its file key is not a layer's, so no layer adopts it, and it is closed, not parked, when its clip ends.
    const fileKey = `${AUX_KEY}${projectPath}\0${width}x${height}`;
    const key = `${clipId}\0${fileKey}`;
    let entry = this.decoders.get(key);
    if (!entry) {
      entry = this.entryOf(this.openDecoder(projectPath, reader, { width, height }, false), fileKey, clipId, this.frameCounter, false);
      this.decoders.set(key, entry);
    }
    return this.entryFrame(entry, Math.max(0, Math.round(frame) - 1));
  }

  /**
   * Get the video layers of a frame that will be prepared in about `ahead`
   * frames ready to decode, at the source frame each shows, so a cut to a
   * new clip waits neither for ffmpeg to start nor for its seek: hand it a
   * decoder of the same file that can read forward to it, else start one
   * (at most 4 waiting). Clips already open are left alone (their decoder
   * reads ahead on its own). Pictures are the same as without warming.
   */
  warm(plan: FramePlan, ahead: number): void {
    if (this.closed) return;
    const inPlan = new Set(plan.layers.map((layer) => layer.clipId));
    for (const layer of plan.layers) {
      const source = layer.source;
      if (source.kind !== "video") continue;
      const key = this.decoderKey(layer, source);
      if (this.decoders.has(key)) continue;
      const adopted = this.adopt(layer, source, inPlan);
      if (adopted) {
        adopted.lastFrame = Math.max(adopted.lastFrame, this.frameCounter + ahead);
        this.decoders.set(key, adopted);
        continue;
      }
      let warming = 0;
      for (const entry of this.decoders.values()) if (entry.warming) warming += 1;
      if (warming >= MAX_WARMING) return;
      // Kept from the idle sweep until it is due; a failure surfaces when the frame is prepared.
      const entry = this.newEntry(layer, source, this.frameCounter + ahead, true);
      this.decoders.set(key, entry);
      entry.decoder.then(
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
    // Video resources per layer: the source frame each path needs on that layer.
    const videoFrames = plan.layers.map(() => new Map<string, number>());
    plan.layers.forEach((layer, i) => {
      for (const mask of layer.masks) if (mask.maskPath) imagePaths.add(mask.maskPath);
      for (const effect of layer.effects) {
        for (const [p, at] of Object.entries(effect.imageFrames ?? {})) if (!videoFrames[i]!.has(p)) videoFrames[i]!.set(p, at.frame);
        for (const p of effect.images ?? []) if (!effect.imageFrames?.[p]) imagePaths.add(p);
        for (const p of effect.texts ?? []) textPaths.add(p);
      }
    });
    // Layers asking for the same frame of a video share one decode.
    const decoded = new Map<string, Promise<RgbaImage>>();
    const videoFrame = (clipId: string, p: string, frame: number): Promise<RgbaImage> => {
      const key = `${p}\0${frame}`;
      let hit = decoded.get(key);
      if (!hit) {
        hit = this.auxVideoFrame(clipId, p, frame);
        decoded.set(key, hit);
      }
      return hit;
    };
    const [layers, images, layerImages, texts, audio] = await Promise.all([
      Promise.all(plan.layers.map((layer) => this.layerImage(layer))),
      Promise.all([...imagePaths].map(async (p) => [p, await this.auxImage(p, fit)] as const)),
      Promise.all(
        plan.layers.map(async (layer, i) =>
          videoFrames[i]!.size ? new Map(await Promise.all([...videoFrames[i]!].map(async ([p, frame]) => [p, await videoFrame(layer.clipId, p, frame)] as const))) : null,
        ),
      ),
      Promise.all([...textPaths].map(async (p) => [p, await this.text(p)] as const)),
      Promise.all(
        plan.layers.map((layer) => {
          const request = (layer as { audio?: LayerAudioRequest }).audio;
          return request ? this.layerAudio(layer, request) : Promise.resolve(null);
        }),
      ),
    ]);
    this.sweep();
    return { layers, images: new Map(images), layerImages, texts: new Map(texts), audio };
  }

  /** Stop decoders whose clips have not been drawn recently. */
  private sweep(): void {
    const idle = this.options.idleFrames ?? 3;
    const ended = new Set<DecoderEntry>();
    for (const [key, entry] of this.decoders) {
      if (this.frameCounter - entry.lastFrame > idle) {
        this.decoders.delete(key);
        ended.add(entry);
      }
    }
    const live = new Set(this.decoders.values());
    for (const entry of ended) if (!live.has(entry)) this.park(entry);
    for (let i = this.parked.length - 1; i >= 0; i -= 1) {
      if (this.frameCounter - this.parked[i]!.parkedAt! > PARK_FRAMES) void closeEntry(this.parked.splice(i, 1)[0]!);
    }
    for (const [key, entry] of this.audioReaders) {
      if (this.frameCounter - entry.lastFrame > idle) {
        void entry.reader.close();
        this.audioReaders.delete(key);
      }
    }
  }

  /** Keep an ended clip's decoder (paused, without its backward cache) for the next clip of its file. */
  private park(entry: DecoderEntry): void {
    if (!entry.ready || entry.fileKey.startsWith(AUX_KEY)) {
      void closeEntry(entry);
      return;
    }
    entry.ready.dropCache();
    entry.clips.clear();
    entry.warming = false;
    entry.parkedAt = this.frameCounter;
    this.parked.push(entry);
    while (this.parked.length > MAX_PARKED) void closeEntry(this.parked.shift()!);
  }

  get activeDecoders(): number {
    return this.decoders.size;
  }

  async close(): Promise<void> {
    this.closed = true;
    const decoders = new Set([...this.decoders.values(), ...this.parked]);
    const readers = [...this.audioReaders.values()];
    this.decoders.clear();
    this.parked.length = 0;
    this.audioReaders.clear();
    await Promise.all([...[...decoders].map(closeEntry), ...readers.map((e) => e.reader.close())]);
    this.stills.clear();
  }
}
