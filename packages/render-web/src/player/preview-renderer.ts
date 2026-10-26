/**
 * PreviewRenderer: plans, decodes and composites preview frames onto a canvas
 * surface. The player's picture half; the clock and sound stay with the
 * player. Runs on the page or, behind `WorkerPreview`, in a Worker.
 *
 * Requests coalesce: while a frame renders, a newer request replaces the one
 * waiting, so only the latest frame renders next.
 */

import type { Project } from "@zenvi/engine";
import { KernelAudioSource } from "../audio/kernel-audio.js";
import { Compositor, type LayerError, type LayerResources } from "../compositor/compositor.js";
import { mediaResources } from "../compositor/resources.js";
import { defaultEngine, type RenderEngine } from "../engine.js";
import type { MediaRef, MediaRegistry } from "../media/registry.js";
import { StillCache } from "../media/stills.js";
import type { SvgRasterizer } from "../media/svg.js";
import type { DecodeMode } from "../video/decode-cursor.js";
import { FrameCache } from "../video/frame-cache.js";
import { FrameProvider } from "../video/frame-provider.js";
import { AdaptiveScale } from "./adaptive-scale.js";
import type { CanvasSurface } from "./canvas-binding.js";
import { fitViewport } from "./layout.js";

/** What the renderer reports: decode/effect failures of a layer, or of a whole frame. */
export type RenderErrorEvent = { kind: "layer"; clipId: string; stage: LayerError["stage"]; error: unknown } | { kind: "render"; error: unknown };

/**
 * The picture side of a `PreviewPlayer`: a `PreviewRenderer` on the page, or
 * `WorkerPreview` talking to one in a Worker.
 */
export interface PreviewTarget {
  setProject(project: Project): void;
  /** Frames in flight are stale (a resize): drop them instead of drawing. */
  invalidate(): void;
  /** Render `frame` next, replacing any frame still waiting to render. */
  request(frame: number, mode: DecodeMode): void;
  /** False when `frame` is on screen or already on its way. */
  wants(frame: number): boolean;
  /** Resolves once nothing is waiting to render. */
  whenIdle(): Promise<void>;
  /** A frame is rendering or waiting to. */
  readonly busy: boolean;
  /** The frame on screen (0 before the first). */
  readonly shownFrame: number;
  /** Frames drawn so far. */
  readonly presented: number;
  /** Fraction of the canvas box the frame on screen was planned at (below 1 when adaptive playback scaled it down). */
  readonly shownScale: number;
  /** Decoded pictures dropped because playback outran decoding. */
  readonly droppedFrames: number;
  /** Close decoders that have not been used for a while. */
  sweep(): void;
  /** The picture on screen, at most `maxWidth` wide; null before the first frame. */
  snapshot(maxWidth: number): Promise<ImageBitmap | null>;
  onBusy(listener: (busy: boolean) => void): () => void;
  /** Each event comes with a key; the player reports each distinct key once. */
  onError(listener: (key: string, event: RenderErrorEvent) => void): () => void;
  /** The canvas's backing store was resized. */
  onResize(listener: () => void): () => void;
  dispose(): void;
}

export interface PreviewRendererOptions {
  media: MediaRegistry;
  engine?: RenderEngine;
  /** Fraction of the canvas's pixels to render at. Default 1. */
  resolution?: number;
  /** CSS color around the frame, or "transparent". Default black. */
  letterbox?: string;
  /** Budget for decoded preview frames. Default 192 MB. */
  frameCacheBytes?: number;
  /** Lower the resolution of playback frames while they render slower than real time (`AdaptiveScale`). */
  adaptive?: boolean;
  /** A still/SVG cache to share with other consumers. */
  stills?: StillCache;
  /** SVG renderer when `stills` is not given (a Worker has no `<img>`). */
  svgRasterizer?: SvgRasterizer;
  /** Awaited before media is read: a Worker's registry fetches unknown sources from the page. */
  ensureMedia?: (ref: MediaRef) => Promise<void>;
}

export class PreviewRenderer implements PreviewTarget {
  private project: Project | null = null;
  private readonly engine: RenderEngine;
  private readonly frames: FrameProvider;
  private readonly stills: StillCache;
  private readonly ownsStills: boolean;
  private readonly compositor: Compositor;
  private readonly resources: LayerResources;
  private readonly kernelAudio: KernelAudioSource;
  private readonly resolution: number;
  private readonly letterbox: string;
  private readonly adaptive: AdaptiveScale | null;

  private pending: { frame: number; mode: DecodeMode } | null = null;
  private inFlight: number | null = null;
  private rendering = false;
  private shown = 0;
  private presentedCount = 0;
  private scaleShown = 1;
  private generation = 0;
  private idle: (() => void)[] = [];
  private readonly busyListeners = new Set<(busy: boolean) => void>();
  private readonly errorListeners = new Set<(key: string, event: RenderErrorEvent) => void>();
  private readonly presentListeners = new Set<(frame: number) => void>();
  private disposed = false;

  constructor(
    private readonly surface: CanvasSurface,
    options: PreviewRendererOptions,
  ) {
    this.engine = options.engine ?? defaultEngine;
    this.resolution = Math.min(1, Math.max(0.1, options.resolution ?? 1));
    this.letterbox = options.letterbox ?? "#000";
    this.adaptive = options.adaptive ? new AdaptiveScale() : null;
    const media = options.media;
    this.frames = new FrameProvider({ media, cache: new FrameCache(options.frameCacheBytes), quality: "medium" });
    this.ownsStills = !options.stills;
    this.stills = options.stills ?? new StillCache({ media, quality: "high", ...(options.svgRasterizer ? { svgRasterizer: options.svgRasterizer } : {}) });
    this.compositor = new Compositor({ engine: this.engine });
    this.kernelAudio = new KernelAudioSource(media);
    const resources = mediaResources({ media, frames: this.frames, stills: this.stills, audio: this.kernelAudio });
    this.resources = options.ensureMedia ? ensuring(resources, options.ensureMedia) : resources;
  }

  setProject(project: Project): void {
    this.project = project;
    this.generation += 1;
  }

  invalidate(): void {
    this.generation += 1;
  }

  request(frame: number, mode: DecodeMode): void {
    if (this.disposed) return;
    this.pending = { frame, mode };
    if (!this.rendering) void this.renderLoop();
  }

  wants(frame: number): boolean {
    return frame !== this.shown && frame !== this.pending?.frame && frame !== this.inFlight;
  }

  whenIdle(): Promise<void> {
    if (!this.rendering || this.disposed) return Promise.resolve();
    return new Promise((resolve) => this.idle.push(resolve));
  }

  get busy(): boolean {
    return this.rendering;
  }

  get shownFrame(): number {
    return this.shown;
  }

  get presented(): number {
    return this.presentedCount;
  }

  get shownScale(): number {
    return this.scaleShown;
  }

  get droppedFrames(): number {
    return this.frames.droppedFrames;
  }

  sweep(): void {
    this.frames.sweep();
  }

  async snapshot(maxWidth: number): Promise<ImageBitmap | null> {
    const { width, height } = this.surface.size();
    if (this.presentedCount === 0 || width < 2 || height < 2) return null;
    const scale = Math.min(1, maxWidth / width);
    return createImageBitmap(this.surface.canvas, { resizeWidth: Math.max(1, Math.round(width * scale)), resizeHeight: Math.max(1, Math.round(height * scale)), resizeQuality: "medium" });
  }

  onBusy(listener: (busy: boolean) => void): () => void {
    this.busyListeners.add(listener);
    return () => this.busyListeners.delete(listener);
  }

  onError(listener: (key: string, event: RenderErrorEvent) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onResize(listener: () => void): () => void {
    return this.surface.onResize(listener);
  }

  /** Called after each frame is drawn. */
  onPresent(listener: (frame: number) => void): () => void {
    this.presentListeners.add(listener);
    return () => this.presentListeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending = null;
    this.surface.dispose();
    void this.kernelAudio.reset();
    void this.frames.dispose();
    this.frames.cache.clear();
    if (this.ownsStills) this.stills.dispose();
    this.compositor.dispose();
    this.busyListeners.clear();
    this.errorListeners.clear();
    this.presentListeners.clear();
    for (const resolve of this.idle.splice(0)) resolve();
  }

  // -------------------------------------------------------------------------

  private async renderLoop(): Promise<void> {
    this.rendering = true;
    this.emitBusy(true);
    try {
      while (this.pending && !this.disposed) {
        const { frame, mode } = this.pending;
        this.pending = null;
        this.inFlight = frame;
        await this.renderFrame(frame, mode);
        this.inFlight = null;
      }
    } finally {
      this.rendering = false;
      this.inFlight = null;
      for (const resolve of this.idle.splice(0)) resolve();
      if (!this.disposed) this.emitBusy(false);
    }
  }

  private async renderFrame(frame: number, mode: DecodeMode): Promise<void> {
    const project = this.project;
    if (!project) return;
    const generation = this.generation;
    const canvas = this.surface.size();
    const projectSize = { width: project.width, height: project.height };
    // Paused frames, seeks and scrubs always render at full resolution.
    const playback = mode === "sequential" ? this.adaptive : null;
    const scale = this.resolution * (playback?.scale ?? 1);
    const started = performance.now();
    // The planner fits the project into this box (Timeline::SetMaxSize).
    const box = { width: Math.max(1, Math.floor(canvas.width * scale)), height: Math.max(1, Math.floor(canvas.height * scale)) };
    let prepared: Awaited<ReturnType<Compositor["prepare"]>> | null = null;
    try {
      const plan = this.engine.planFrame(project, frame, box, { preview: true });
      // A frame that does not follow the last one starts stateful effects afresh.
      if (mode !== "sequential") this.compositor.resetEffectState();
      prepared = await this.compositor.prepare(plan, this.resources, { mode });
      // A resize or a new project arrived meanwhile: its own render follows.
      if (generation !== this.generation || this.disposed) return;
      const ctx = this.surface.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      if (this.letterbox === "transparent") ctx.clearRect(0, 0, canvas.width, canvas.height);
      else {
        ctx.fillStyle = this.letterbox;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      this.compositor.draw(prepared, ctx, fitViewport(canvas, projectSize, plan));
      this.shown = frame;
      this.presentedCount += 1;
      this.scaleShown = playback?.scale ?? 1;
      playback?.record(performance.now() - started, (this.engine.frameTime(project, 2) - this.engine.frameTime(project, 1)) * 1000);
      for (const listener of [...this.presentListeners]) listener(frame);
      // A scrub preview: decode the exact frame next, unless the playhead already moved on.
      if (!prepared.exact && !this.pending) this.pending = { frame, mode: "seek" };
      for (const error of prepared.errors) {
        this.emitError(`${error.clipId}:${error.stage}:${String(error.error)}`, { kind: "layer", ...error });
      }
    } catch (error) {
      this.emitError(`render:${String(error)}`, { kind: "render", error });
    } finally {
      prepared?.release();
    }
  }

  private emitBusy(busy: boolean): void {
    for (const listener of [...this.busyListeners]) listener(busy);
  }

  private emitError(key: string, event: RenderErrorEvent): void {
    for (const listener of [...this.errorListeners]) listener(key, event);
  }
}

/** `resources`, waiting for `ensure` on each piece of media before reading it. */
function ensuring(resources: LayerResources, ensure: (ref: MediaRef) => Promise<void>): LayerResources {
  const { audio } = resources;
  return {
    async picture(layer, mode) {
      const source = layer.source;
      if (source.kind !== "color") await ensure({ fileId: source.fileId, path: source.path });
      return resources.picture(layer, mode);
    },
    async image(path, width, height, time, mode) {
      await ensure({ path });
      return resources.image(path, width, height, time, mode);
    },
    async text(path) {
      await ensure({ path });
      return resources.text(path);
    },
    ...(audio
      ? {
          async audio(request, lane) {
            await ensure({ fileId: request.fileId, path: request.path });
            return audio.call(resources, request, lane);
          },
        }
      : {}),
  };
}
