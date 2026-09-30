/**
 * Everything a frame plan needs decoded: layer sources at draw size, mask and
 * effect images, and text resources (LUTs). One `SourceManager` serves one
 * render (or one preview session) and owns every ffmpeg child it starts.
 */

import { readFile } from "node:fs/promises";
import type { FramePlan, LayerPlan, Project, ProjectFile, RgbaImage, RGBA } from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { runBinary } from "../ffmpeg/process.js";
import { createRgba } from "../image/rgba.js";
import { readSvgFile, svgIntrinsicSize } from "../svg/rasterize.js";
import { decodeStill, isSvgPath, StillCache } from "./still.js";
import { VideoDecoder, type ScaleQuality, type VideoSourceInfo } from "./video.js";

/** Maps a path as stored in the project (absolute, relative, `@transitions/…`) to a local file. */
export type MediaResolver = (projectPath: string) => string | Promise<string>;

export interface SourceManagerOptions {
  resolveMedia: MediaResolver;
  quality?: ScaleQuality;
  signal?: AbortSignal;
  /** Close a clip's decoder after it has been idle this many frames. */
  idleFrames?: number;
}

export interface PreparedFrame {
  /** Source image per layer (index into `plan.layers`), at the layer's draw size. */
  layers: RgbaImage[];
  /** Mask and effect images by path. */
  images: Map<string, RgbaImage>;
  /** Text resources by path. */
  texts: Map<string, string>;
}

interface StartTimes {
  videoStart: number;
  formatStart: number;
}

async function probeStartTimes(file: string, signal?: AbortSignal): Promise<StartTimes> {
  const { stdout } = await runBinary(
    resolveBinary("ffprobe"),
    ["-v", "error", "-print_format", "json", "-show_entries", "stream=codec_type,start_time:format=start_time", file],
    { signal, timeoutMs: 60_000 },
  );
  const parsed = JSON.parse(stdout.toString("utf8")) as {
    streams?: Array<{ codec_type?: string; start_time?: string }>;
    format?: { start_time?: string };
  };
  const video = parsed.streams?.find((s) => s.codec_type === "video");
  const num = (v: string | undefined) => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : 0);
  return { videoStart: num(video?.start_time), formatStart: num(parsed.format?.start_time) };
}

function colorKey(color: RGBA, w: number, h: number): string {
  return `${color.join(",")}@${w}x${h}`;
}

export class SourceManager {
  private readonly decoders = new Map<string, { decoder: VideoDecoder; lastFrame: number }>();
  private readonly stills = new StillCache();
  private readonly startTimes = new Map<string, Promise<StartTimes>>();
  private readonly resolved = new Map<string, Promise<string>>();
  private readonly texts = new Map<string, Promise<string>>();
  private readonly colors = new Map<string, RgbaImage>();
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

  private startTimesFor(file: string): Promise<StartTimes> {
    let hit = this.startTimes.get(file);
    if (!hit) {
      hit = probeStartTimes(file, this.options.signal).catch(() => ({ videoStart: 0, formatStart: 0 }));
      this.startTimes.set(file, hit);
    }
    return hit;
  }

  private async videoFrame(layer: LayerPlan, source: Extract<LayerPlan["source"], { kind: "video" }>): Promise<RgbaImage> {
    const width = Math.max(1, Math.round(layer.drawWidth));
    const height = Math.max(1, Math.round(layer.drawHeight));
    const autorotate = source.applyRotation !== false;
    const key = `${layer.clipId}\0${width}x${height}\0${autorotate ? 1 : 0}`;
    let entry = this.decoders.get(key);
    if (!entry) {
      const file = await this.resolve(source.path);
      const reader = this.files.get(source.fileId);
      const fps = reader?.fps && reader.fps.num > 0 && reader.fps.den > 0 ? reader.fps : { num: 30, den: 1 };
      const frameCount = Number(reader?.video_length);
      const times = await this.startTimesFor(file);
      const info: VideoSourceInfo = {
        path: file,
        fps,
        videoStart: times.videoStart,
        formatStart: times.formatStart,
        frameCount: Number.isFinite(frameCount) && frameCount > 0 ? frameCount : undefined,
        autorotate,
      };
      entry = {
        decoder: new VideoDecoder(info, { width, height }, { quality: this.options.quality, signal: this.options.signal }),
        lastFrame: this.frameCounter,
      };
      this.decoders.set(key, entry);
    }
    entry.lastFrame = this.frameCounter;
    // LayerSource.time is (k − 1) / reader fps for libopenshot source frame k.
    return entry.decoder.frame(Math.max(0, Math.round(source.frame) - 1));
  }

  private colorImage(color: RGBA, width: number, height: number): RgbaImage {
    const key = colorKey(color, width, height);
    let image = this.colors.get(key);
    if (!image) {
      image = createRgba(width, height);
      const d = image.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = color[0];
        d[i + 1] = color[1];
        d[i + 2] = color[2];
        d[i + 3] = color[3];
      }
      if (this.colors.size > 32) this.colors.clear();
      this.colors.set(key, image);
    }
    return image;
  }

  /** The source image for one layer at its draw size. */
  async layerImage(layer: LayerPlan): Promise<RgbaImage> {
    if (this.closed) throw new Error("SourceManager is closed");
    const width = Math.max(1, Math.round(layer.drawWidth));
    const height = Math.max(1, Math.round(layer.drawHeight));
    const source = layer.source;
    switch (source.kind) {
      case "video":
        return this.videoFrame(layer, source);
      case "image":
      case "svg": {
        const file = await this.resolve(source.path);
        return this.stills.get(file, { width, height }, () =>
          decodeStill(file, { width, height }, { quality: this.options.quality, signal: this.options.signal }),
        );
      }
      case "color":
        return this.colorImage(source.color, width, height);
    }
  }

  /**
   * An auxiliary image (transition mask, effect mask, displacement map) at
   * its natural size, like libopenshot's reader hands it to the effect, which
   * then scales it. SVGs are rasterized to fit `fit` keeping their aspect
   * (QtImageReader renders SVGs at the canvas size).
   */
  async auxImage(projectPath: string, fit: { width: number; height: number }): Promise<RgbaImage> {
    const file = await this.resolve(projectPath);
    if (isSvgPath(file)) {
      const natural = await svgIntrinsicSize(await readSvgFile(file));
      const scale = Math.min(fit.width / natural.width, fit.height / natural.height);
      const size = { width: Math.max(1, Math.round(natural.width * scale)), height: Math.max(1, Math.round(natural.height * scale)) };
      return this.stills.get(file, size, () => decodeStill(file, size, { signal: this.options.signal }));
    }
    const dims = await this.naturalSize(file);
    return this.stills.get(file, dims, () => decodeStill(file, dims, { signal: this.options.signal }));
  }

  private readonly naturalSizes = new Map<string, Promise<{ width: number; height: number }>>();

  private naturalSize(file: string): Promise<{ width: number; height: number }> {
    let hit = this.naturalSizes.get(file);
    if (!hit) {
      hit = runBinary(resolveBinary("ffprobe"), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file], {
        signal: this.options.signal,
        timeoutMs: 60_000,
      }).then(({ stdout }) => {
        const [w, h] = stdout.toString("utf8").trim().split("x").map(Number);
        if (!w || !h) throw new Error(`Cannot read image size of ${file}`);
        return { width: w, height: h };
      });
      this.naturalSizes.set(file, hit);
    }
    return hit;
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
    const [layers, images, texts] = await Promise.all([
      Promise.all(plan.layers.map((layer) => this.layerImage(layer))),
      Promise.all([...imagePaths].map(async (p) => [p, await this.auxImage(p, fit)] as const)),
      Promise.all([...textPaths].map(async (p) => [p, await this.text(p)] as const)),
    ]);
    this.sweep();
    return { layers, images: new Map(images), texts: new Map(texts) };
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
  }

  get activeDecoders(): number {
    return this.decoders.size;
  }

  async close(): Promise<void> {
    this.closed = true;
    const all = [...this.decoders.values()];
    this.decoders.clear();
    await Promise.all(all.map((e) => e.decoder.close()));
    this.stills.clear();
    this.colors.clear();
  }
}
