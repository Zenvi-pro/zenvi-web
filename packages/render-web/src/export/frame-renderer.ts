/**
 * Offscreen frame rendering for exports, stills and tool previews: the same
 * compositor, decoder and caches as the preview, at an arbitrary size.
 */

import type { Project } from "@zenvi/engine";
import { KernelAudioSource } from "../audio/kernel-audio.js";
import { Compositor, type LayerError, type LayerResources, type PreparedFrame } from "../compositor/compositor.js";
import { mediaResources } from "../compositor/resources.js";
import { createCanvas, type Scratch } from "../compositor/scratch.js";
import { defaultEngine, type RenderEngine } from "../engine.js";
import type { MediaRegistry } from "../media/registry.js";
import { StillCache } from "../media/stills.js";
import type { SvgRasterizer } from "../media/svg.js";
import type { DecodeMode } from "../video/decode-cursor.js";
import { FrameCache } from "../video/frame-cache.js";
import { FrameProvider } from "../video/frame-provider.js";
import type { Size } from "../util/size-bucket.js";

export interface FrameRendererOptions {
  media: MediaRegistry;
  engine?: RenderEngine;
  /** Decoded-picture budget. Default 256 MB. */
  frameCacheBytes?: number;
  svgRasterizer?: SvgRasterizer;
}

export class FrameRenderer {
  readonly engine: RenderEngine;
  private readonly frames: FrameProvider;
  private readonly stills: StillCache;
  private readonly compositor: Compositor;
  private readonly resources: LayerResources;
  private readonly kernelAudio: KernelAudioSource;
  private canvas: Scratch | null = null;

  constructor(options: FrameRendererOptions) {
    this.engine = options.engine ?? defaultEngine;
    // Exports decode with the best filters; the preview trades them for speed.
    this.frames = new FrameProvider({ media: options.media, cache: new FrameCache(options.frameCacheBytes ?? 256 * 1024 * 1024), quality: "high" });
    this.stills = new StillCache({ media: options.media, quality: "high", ...(options.svgRasterizer ? { svgRasterizer: options.svgRasterizer } : {}) });
    this.compositor = new Compositor({ engine: this.engine });
    this.kernelAudio = new KernelAudioSource(options.media);
    this.resources = mediaResources({ media: options.media, frames: this.frames, stills: this.stills, audio: this.kernelAudio });
  }

  /** The canvas frames are drawn into (reused while the size stays the same). */
  surface(size: Size): Scratch {
    const width = Math.max(1, Math.round(size.width));
    const height = Math.max(1, Math.round(size.height));
    if (!this.canvas || this.canvas.canvas.width !== width || this.canvas.canvas.height !== height) {
      this.canvas = createCanvas(width, height, false);
    }
    return this.canvas;
  }

  /** Draw timeline `frame` at `size` into `surface(size)`. Returns per-layer errors. */
  async draw(project: Project, frame: number, size: Size, mode: DecodeMode): Promise<LayerError[]> {
    return this.drawPrepared(await this.prepare(project, frame, size, mode), size);
  }

  /**
   * Decode everything timeline `frame` draws at `size`, without drawing it:
   * an export prepares the next frame while it draws this one. Pass the
   * result to `drawPrepared` (which releases it).
   */
  prepare(project: Project, frame: number, size: Size, mode: DecodeMode): Promise<PreparedFrame> {
    const target = this.surface(size);
    const plan = this.engine.planFrame(project, frame, { width: target.canvas.width, height: target.canvas.height });
    return this.compositor.prepare(plan, this.resources, { mode });
  }

  /** Draw a prepared frame into `surface(size)` and release its pictures. Returns per-layer errors. */
  drawPrepared(prepared: PreparedFrame, size: Size): LayerError[] {
    const target = this.surface(size);
    target.ctx.setTransform(1, 0, 0, 1, 0, 0);
    try {
      this.compositor.draw(prepared, target.ctx);
      return prepared.errors;
    } finally {
      prepared.release();
    }
  }

  /**
   * Start decoding the first picture of each video clip of timeline `frame`
   * that `warm` has not seen yet, so a cut to it does not wait for the seek.
   * Call it for the frames of a sequential export in order, a few frames
   * ahead of the one being drawn: a clip's first appearance is then its
   * first frame, and its decode lane continues forward from there. Errors are
   * left for the frame that draws the clip.
   */
  warm(project: Project, frame: number, size: Size, seen: Set<string>): void {
    const target = this.surface(size);
    const plan = this.engine.planFrame(project, frame, { width: target.canvas.width, height: target.canvas.height });
    for (const layer of plan.layers) {
      if (layer.source.kind !== "video" || seen.has(layer.clipId)) continue;
      seen.add(layer.clipId);
      this.resources.picture(layer, "sequential").then(
        (picture) => picture?.release(),
        () => undefined,
      );
    }
  }

  /** Close decoders idle for a while (long exports touch many files). */
  sweep(): void {
    this.frames.sweep();
  }

  async dispose(): Promise<void> {
    await this.kernelAudio.reset();
    await this.frames.dispose();
    this.frames.cache.clear();
    this.stills.dispose();
    this.compositor.dispose();
    if (this.canvas) {
      this.canvas.canvas.width = 1;
      this.canvas.canvas.height = 1;
      this.canvas = null;
    }
  }
}
