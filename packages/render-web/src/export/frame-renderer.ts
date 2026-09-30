/**
 * Offscreen frame rendering for exports, stills and tool previews: the same
 * compositor, decoder and caches as the preview, at an arbitrary size.
 */

import type { Project } from "@zenvi/engine";
import { Compositor, type LayerError, type LayerResources } from "../compositor/compositor.js";
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
  private canvas: Scratch | null = null;

  constructor(options: FrameRendererOptions) {
    this.engine = options.engine ?? defaultEngine;
    // Exports decode with the best filters; the preview trades them for speed.
    this.frames = new FrameProvider({ media: options.media, cache: new FrameCache(options.frameCacheBytes ?? 256 * 1024 * 1024), quality: "high" });
    this.stills = new StillCache({ media: options.media, quality: "high", ...(options.svgRasterizer ? { svgRasterizer: options.svgRasterizer } : {}) });
    this.compositor = new Compositor({ engine: this.engine });
    this.resources = mediaResources({ media: options.media, frames: this.frames, stills: this.stills });
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
    const target = this.surface(size);
    const plan = this.engine.planFrame(project, frame, { width: target.canvas.width, height: target.canvas.height });
    target.ctx.setTransform(1, 0, 0, 1, 0, 0);
    return this.compositor.render(plan, target.ctx, this.resources, { mode });
  }

  /** Close decoders idle for a while (long exports touch many files). */
  sweep(): void {
    this.frames.sweep();
  }

  async dispose(): Promise<void> {
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
