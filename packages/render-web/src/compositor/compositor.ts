/**
 * Canvas2D compositor: executes a `FramePlan`.
 *
 * `prepare` fetches every picture, mask and kernel resource of a plan in
 * parallel; `draw` then composites synchronously, so a visible canvas is never
 * left half drawn and a stale frame can be dropped before it costs a draw.
 *
 * Per layer (libopenshot `Clip::GetFrame`, libopenshot-semantics §2.3):
 * 1. source stage, in draw space: the picture, then clip effects with
 *    `applyBeforeClip` and transition masks (engine kernels on RGBA);
 * 2. the clip transform (`setTransform`), bilinear like QPainter's
 *    SmoothPixmapTransform;
 * 3. canvas stage: effects with `applyBeforeClip: false` (Shadow, Glow) on the
 *    transformed, canvas-sized layer;
 * 4. composite onto the frame with the layer's opacity and blend mode.
 * Layers without effects or masks are drawn straight from the decoded bitmap:
 * no readback.
 */

import type { EffectInstance, FramePlan, KernelContext, LayerPlan, MaskInstance, RgbaImage } from "@zenvi/engine/render";
import type { RenderEngine } from "../engine.js";
import type { DecodeMode } from "../video/decode-cursor.js";
import type { FrameImage } from "../video/shared-bitmap.js";
import { layerComposite } from "./blend.js";
import { cssColor, opaqueCssColor } from "./color.js";
import { ScratchPool, type Context2D } from "./scratch.js";

export type DrawContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Where the compositor gets pixels for a plan. */
export interface LayerResources {
  /** The layer's picture at about `drawWidth × drawHeight` (video, still, SVG); null draws nothing. */
  picture(layer: LayerPlan, mode: DecodeMode): Promise<FrameImage | null>;
  /** An image by path stretched to exactly `width × height` (masks, effect images). */
  image(path: string, width: number, height: number): Promise<RgbaImage | null>;
  /** A text resource by path (ColorMap `.cube` LUTs). */
  text(path: string): Promise<string | null>;
}

/** Maps plan pixels to canvas pixels: `canvas = (x, y) + scale · plan`. */
export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export const IDENTITY_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };

export interface LayerError {
  clipId: string;
  stage: "decode" | "effect" | "mask" | "resource";
  error: unknown;
}

interface PreparedLayer {
  readonly layer: LayerPlan;
  picture: FrameImage | null;
  readonly masks: { instance: MaskInstance; image: RgbaImage }[];
  /** Images for source-stage kernels, at draw size. */
  readonly sourceImages: Map<string, RgbaImage>;
  /** Images for canvas-stage kernels, at canvas size. */
  readonly canvasImages: Map<string, RgbaImage>;
  readonly texts: Map<string, string>;
}

export interface PreparedFrame {
  readonly plan: FramePlan;
  readonly layers: readonly PreparedLayer[];
  /** Per-layer failures; the frame still draws without the failed part (libopenshot skips too). */
  readonly errors: LayerError[];
  /** Give the borrowed pictures back. Call once, after the last `draw`. */
  release(): void;
}

export interface CompositorOptions {
  engine: RenderEngine;
  /**
   * Filter for transformed draws. "low" is bilinear, matching QPainter's
   * SmoothPixmapTransform; pictures are already decoded near their draw size.
   */
  smoothing?: ImageSmoothingQuality;
}

export interface PrepareOptions {
  mode?: DecodeMode;
  signal?: AbortSignal;
}

export class Compositor {
  private readonly engine: RenderEngine;
  private readonly smoothing: ImageSmoothingQuality;
  private readonly pool = new ScratchPool();

  constructor(options: CompositorOptions) {
    this.engine = options.engine;
    this.smoothing = options.smoothing ?? "low";
  }

  async prepare(plan: FramePlan, resources: LayerResources, options: PrepareOptions = {}): Promise<PreparedFrame> {
    const mode = options.mode ?? "seek";
    const errors: LayerError[] = [];
    const layers = await Promise.all(plan.layers.map((layer) => this.prepareLayer(plan, layer, resources, mode, errors)));
    const frame: PreparedFrame = {
      plan,
      layers,
      errors,
      release: () => {
        for (const layer of layers) {
          layer.picture?.release();
          layer.picture = null;
        }
      },
    };
    if (options.signal?.aborted) {
      frame.release();
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    return frame;
  }

  draw(frame: PreparedFrame, ctx: DrawContext, viewport: Viewport = IDENTITY_VIEWPORT): void {
    const { plan } = frame;
    const { x, y, scale } = viewport;
    ctx.save();
    try {
      ctx.setTransform(scale, 0, 0, scale, x, y);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = opaqueCssColor(plan.background);
      ctx.fillRect(0, 0, plan.width, plan.height);
      // The frame is the canvas: unbounded blend modes stop at its edge.
      ctx.beginPath();
      ctx.rect(0, 0, plan.width, plan.height);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = this.smoothing;
      for (const layer of frame.layers) {
        try {
          this.drawLayer(ctx, frame, layer, viewport);
        } catch (error) {
          frame.errors.push({ clipId: layer.layer.clipId, stage: "effect", error });
        }
      }
    } finally {
      ctx.restore();
    }
  }

  /** prepare + draw + release. Returns the per-layer errors. */
  async render(plan: FramePlan, ctx: DrawContext, resources: LayerResources, options: PrepareOptions & { viewport?: Viewport } = {}): Promise<LayerError[]> {
    const frame = await this.prepare(plan, resources, options);
    try {
      this.draw(frame, ctx, options.viewport);
      return frame.errors;
    } finally {
      frame.release();
    }
  }

  dispose(): void {
    this.pool.clear();
  }

  // -------------------------------------------------------------------------

  private async prepareLayer(plan: FramePlan, layer: LayerPlan, resources: LayerResources, mode: DecodeMode, errors: LayerError[]): Promise<PreparedLayer> {
    const prepared: PreparedLayer = { layer, picture: null, masks: [], sourceImages: new Map(), canvasImages: new Map(), texts: new Map() };
    const fail = (stage: LayerError["stage"]) => (error: unknown) => {
      errors.push({ clipId: layer.clipId, stage, error });
    };
    const tasks: Promise<unknown>[] = [];
    if (layer.source.kind !== "color") {
      tasks.push(
        resources.picture(layer, mode).then((picture) => {
          prepared.picture = picture;
        }, fail("decode")),
      );
    }
    const dw = layer.drawWidth;
    const dh = layer.drawHeight;
    const masks: ({ instance: MaskInstance; image: RgbaImage } | null)[] = layer.masks.map(() => null);
    layer.masks.forEach((instance, index) => {
      // A mask that cannot be read leaves the frame unchanged (Mask.cpp).
      tasks.push(
        resources.image(instance.maskPath, dw, dh).then((image) => {
          if (image) masks[index] = { instance, image };
        }, fail("mask")),
      );
    });
    for (const effect of layer.effects) {
      const canvasStage = effect.applyBeforeClip === false;
      const [w, h] = canvasStage ? [plan.width, plan.height] : [dw, dh];
      const target = canvasStage ? prepared.canvasImages : prepared.sourceImages;
      for (const path of effect.images ?? []) {
        tasks.push(resources.image(path, w, h).then((image) => image && target.set(path, image), fail("resource")));
      }
      for (const path of effect.texts ?? []) {
        tasks.push(resources.text(path).then((text) => text !== null && prepared.texts.set(path, text), fail("resource")));
      }
    }
    await Promise.all(tasks);
    for (const mask of masks) if (mask) prepared.masks.push(mask);
    return prepared;
  }

  private drawLayer(ctx: DrawContext, frame: PreparedFrame, prepared: PreparedLayer, viewport: Viewport): void {
    const { layer } = prepared;
    const { plan } = frame;
    const composite = layerComposite(layer.composite);
    if (composite.kind === "skip") return;
    const { x: vx, y: vy, scale: vs } = viewport;
    if (composite.kind === "clear") {
      ctx.setTransform(vs, 0, 0, vs, vx, vy);
      ctx.clearRect(0, 0, plan.width, plan.height);
      return;
    }
    if (!(layer.drawWidth > 0) || !(layer.drawHeight > 0)) return;
    if (layer.source.kind !== "color" && !prepared.picture) return;

    const sourceKernels = layer.effects.filter((e) => e.applyBeforeClip !== false && this.engine.getVideoKernel(e.type));
    const canvasKernels = layer.effects.filter((e) => e.applyBeforeClip === false && this.engine.getVideoKernel(e.type));

    let drawable: CanvasImageSource | null = prepared.picture?.image ?? null;
    let fill = layer.source.kind === "color" ? cssColor(layer.source.color) : null;
    if (sourceKernels.length > 0 || prepared.masks.length > 0) {
      drawable = this.sourceStage(frame, prepared, sourceKernels);
      fill = null;
    }

    ctx.globalAlpha = clamp01(layer.opacity);
    ctx.globalCompositeOperation = composite.operation;
    if (canvasKernels.length === 0) {
      const [a, b, c, d, e, f] = layer.transform;
      ctx.setTransform(vs * a, vs * b, vs * c, vs * d, vs * e + vx, vs * f + vy);
      paint(ctx, drawable, fill, layer.drawWidth, layer.drawHeight);
      return;
    }
    const staged = this.canvasStage(frame, prepared, drawable, fill, canvasKernels);
    ctx.setTransform(vs, 0, 0, vs, vx, vy);
    ctx.drawImage(staged, 0, 0, plan.width, plan.height);
  }

  /** Source picture → source kernels → transition masks, in draw space. */
  private sourceStage(frame: PreparedFrame, prepared: PreparedLayer, kernels: EffectInstance[]): OffscreenCanvas {
    const { layer } = prepared;
    const dw = Math.max(1, Math.round(layer.drawWidth));
    const dh = Math.max(1, Math.round(layer.drawHeight));
    const scratch = this.pool.get("source", dw, dh);
    paint(scratch.ctx, prepared.picture?.image ?? null, layer.source.kind === "color" ? cssColor(layer.source.color) : null, dw, dh);
    let image = readPixels(scratch.ctx, dw, dh);
    const context = { canvasWidth: frame.plan.width, canvasHeight: frame.plan.height, images: prepared.sourceImages, texts: prepared.texts };
    for (const effect of kernels) image = this.runKernel(effect, image, context, frame, layer.clipId);
    for (const { instance, image: mask } of prepared.masks) {
      try {
        const sized = mask.width === image.width && mask.height === image.height ? mask : this.resample(mask, image.width, image.height);
        this.engine.applyMask(image, sized, instance);
      } catch (error) {
        frame.errors.push({ clipId: layer.clipId, stage: "mask", error });
      }
    }
    const out = image.width === dw && image.height === dh ? scratch : this.pool.get("source-resized", image.width, image.height);
    writePixels(out.ctx, image);
    return out.canvas;
  }

  /** The transformed layer on a transparent frame-sized canvas → canvas kernels. */
  private canvasStage(frame: PreparedFrame, prepared: PreparedLayer, drawable: CanvasImageSource | null, fill: string | null, kernels: EffectInstance[]): OffscreenCanvas {
    const { layer } = prepared;
    const { width, height } = frame.plan;
    const scratch = this.pool.get("canvas", width, height);
    scratch.ctx.imageSmoothingQuality = this.smoothing;
    scratch.ctx.setTransform(...layer.transform);
    paint(scratch.ctx, drawable, fill, layer.drawWidth, layer.drawHeight);
    scratch.ctx.setTransform(1, 0, 0, 1, 0, 0);
    let image = readPixels(scratch.ctx, width, height);
    const context = { canvasWidth: width, canvasHeight: height, images: prepared.canvasImages, texts: prepared.texts };
    for (const effect of kernels) image = this.runKernel(effect, image, context, frame, layer.clipId);
    const out = image.width === width && image.height === height ? scratch : this.pool.get("canvas-resized", image.width, image.height);
    writePixels(out.ctx, image);
    return out.canvas;
  }

  private runKernel(effect: EffectInstance, image: RgbaImage, base: Omit<KernelContext, "frame">, frame: PreparedFrame, clipId: string): RgbaImage {
    const kernel = this.engine.getVideoKernel(effect.type);
    if (!kernel) return image;
    try {
      return kernel(image, effect.params, { ...base, frame: effect.frame }) ?? image;
    } catch (error) {
      frame.errors.push({ clipId, stage: "effect", error });
      return image;
    }
  }

  /** Stretch an RGBA image (a mask after a size-changing kernel). */
  private resample(image: RgbaImage, width: number, height: number): RgbaImage {
    const from = this.pool.get("resample-from", image.width, image.height);
    writePixels(from.ctx, image);
    const to = this.pool.get("resample-to", width, height);
    to.ctx.drawImage(from.canvas, 0, 0, width, height);
    return readPixels(to.ctx, width, height);
  }
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function paint(ctx: DrawContext | Context2D, drawable: CanvasImageSource | null, fill: string | null, width: number, height: number): void {
  if (drawable) {
    ctx.drawImage(drawable, 0, 0, width, height);
  } else if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, width, height);
  }
}

function readPixels(ctx: Context2D, width: number, height: number): RgbaImage {
  const data = ctx.getImageData(0, 0, width, height);
  return { width, height, data: data.data };
}

function writePixels(ctx: Context2D, image: RgbaImage): void {
  const data = image.data.buffer instanceof ArrayBuffer ? (image.data as Uint8ClampedArray<ArrayBuffer>) : new Uint8ClampedArray(image.data);
  ctx.putImageData(new ImageData(data, image.width, image.height), 0, 0);
}
