/**
 * Canvas2D compositor: executes a `FramePlan`.
 *
 * `prepare` fetches every picture, mask, image, text and audio resource of a
 * plan in parallel; `draw` then composites synchronously, so a visible canvas
 * is never left half drawn and a stale frame can be dropped before it costs a
 * draw.
 *
 * Per layer, in the order the engine requires (libopenshot `Clip::GetFrame`,
 * libopenshot-semantics §2.3):
 * 1. effects with `applyBeforeClip !== false`, in order, on the draw-size source;
 * 2. masks with `applyBeforeClip !== false`, in order;
 * 3. draw into (0, 0, drawWidth, drawHeight) with `transform`, `opacity` and
 *    `composite`, clipped by `cornerRadius` (bilinear, like QPainter's
 *    SmoothPixmapTransform) — onto a transparent canvas-sized layer when
 *    step 4 exists;
 * 4. effects with `applyBeforeClip === false` (Shadow, Glow), then masks with
 *    `applyBeforeClip === false`, on that layer, which is then composited.
 * Layers without effects or masks are drawn straight from the decoded bitmap:
 * no pixel readback.
 */

import {
  createCompositorState,
  kernelContext,
  type CompositorState,
  type EffectInstance,
  type FramePlan,
  type KernelAudio,
  type LayerAudioRequest,
  type LayerPlan,
  type MaskInstance,
  type RgbaImage,
  type TextRasterizer,
} from "@zenvi/engine/render";
import type { RenderEngine } from "../engine.js";
import type { DecodeMode } from "../video/decode-cursor.js";
import type { FrameImage } from "../video/shared-bitmap.js";
import { layerComposite } from "./blend.js";
import { cssColor, opaqueCssColor } from "./color.js";
import { ScratchPool, type Context2D } from "./scratch.js";
import { CanvasTextRasterizer } from "./text.js";

export type DrawContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Where the compositor gets pixels for a plan. */
export interface LayerResources {
  /** The layer's picture at about `drawWidth × drawHeight` (video, still, SVG); null draws nothing. */
  picture(layer: LayerPlan, mode: DecodeMode): Promise<FrameImage | null>;
  /**
   * An image by path stretched to exactly `width × height` (masks, effect
   * images); `time` picks the frame (seconds from its first frame) when the
   * image is a video.
   */
  image(path: string, width: number, height: number, time: number | undefined, mode: DecodeMode): Promise<RgbaImage | null>;
  /** A text resource by path (ColorMap `.cube` LUTs). */
  text(path: string): Promise<string | null>;
  /** The audio window a layer's kernels read (`LayerPlan.audio`). */
  audio?(request: LayerAudioRequest, lane: string): Promise<KernelAudio | null>;
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

interface PreparedMask {
  instance: MaskInstance;
  image: RgbaImage;
}

interface PreparedLayer {
  readonly layer: LayerPlan;
  picture: FrameImage | null;
  /** Masks applied to the source before the transform, and after it (canvas-sized). */
  readonly sourceMasks: PreparedMask[];
  readonly canvasMasks: PreparedMask[];
  /** Images for source-stage kernels (draw size) and canvas-stage kernels (canvas size). */
  readonly sourceImages: Map<string, RgbaImage>;
  readonly canvasImages: Map<string, RgbaImage>;
  readonly texts: Map<string, string>;
  audio: KernelAudio | null;
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
  /** Glyphs for Caption and Timer. Default: Canvas2D text; null draws no text. */
  text?: TextRasterizer | null;
}

export interface PrepareOptions {
  mode?: DecodeMode;
  signal?: AbortSignal;
}

export class Compositor {
  private readonly engine: RenderEngine;
  private readonly smoothing: ImageSmoothingQuality;
  private readonly pool = new ScratchPool();
  private textRasterizer: TextRasterizer | null | undefined;
  /** Kernel state per effect instance (BeatSync, DenoiseImage), kept across a sequential render. */
  private state: CompositorState = createCompositorState();

  constructor(options: CompositorOptions) {
    this.engine = options.engine;
    this.smoothing = options.smoothing ?? "low";
    this.textRasterizer = options.text;
  }

  /** Forget stateful effects' history: call on a seek (the next frame does not follow the last). */
  resetEffectState(): void {
    this.state = createCompositorState();
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
    this.state = createCompositorState();
  }

  // -------------------------------------------------------------------------

  private async prepareLayer(plan: FramePlan, layer: LayerPlan, resources: LayerResources, mode: DecodeMode, errors: LayerError[]): Promise<PreparedLayer> {
    const prepared: PreparedLayer = {
      layer,
      picture: null,
      sourceMasks: [],
      canvasMasks: [],
      sourceImages: new Map(),
      canvasImages: new Map(),
      texts: new Map(),
      audio: null,
    };
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
    const stageSize = (canvasStage: boolean): [number, number] => (canvasStage ? [plan.width, plan.height] : [layer.drawWidth, layer.drawHeight]);
    // A mask that cannot be read leaves the frame unchanged (Mask.cpp), so failures are skipped.
    const masks: (PreparedMask | null)[] = layer.masks.map(() => null);
    layer.masks.forEach((instance, index) => {
      const [w, h] = stageSize(instance.applyBeforeClip === false);
      tasks.push(
        resources.image(instance.maskPath, w, h, instance.maskTime, mode).then((image) => {
          if (image) masks[index] = { instance, image };
        }, fail("mask")),
      );
    });
    for (const effect of layer.effects) {
      const canvasStage = effect.applyBeforeClip === false;
      const [w, h] = stageSize(canvasStage);
      const target = canvasStage ? prepared.canvasImages : prepared.sourceImages;
      for (const path of effect.images ?? []) {
        tasks.push(resources.image(path, w, h, effect.imageFrames?.[path]?.time, mode).then((image) => image && target.set(path, image), fail("resource")));
      }
      for (const path of effect.texts ?? []) {
        tasks.push(resources.text(path).then((text) => text !== null && prepared.texts.set(path, text), fail("resource")));
      }
    }
    if (layer.audio && resources.audio) {
      tasks.push(
        resources.audio(layer.audio, layer.clipId).then((audio) => {
          prepared.audio = audio;
        }, fail("resource")),
      );
    }
    await Promise.all(tasks);
    for (const mask of masks) {
      if (!mask) continue;
      (mask.instance.applyBeforeClip === false ? prepared.canvasMasks : prepared.sourceMasks).push(mask);
    }
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

    const sourceEffects = layer.effects.filter((e) => e.applyBeforeClip !== false && this.engine.supportsVideoEffect(e.type));
    const canvasEffects = layer.effects.filter((e) => e.applyBeforeClip === false && this.engine.supportsVideoEffect(e.type));

    let drawable: CanvasImageSource | null = prepared.picture?.image ?? null;
    let fill = layer.source.kind === "color" ? cssColor(layer.source.color) : null;
    if (sourceEffects.length > 0 || prepared.sourceMasks.length > 0) {
      drawable = this.sourceStage(frame, prepared, sourceEffects);
      fill = null;
    }

    if (canvasEffects.length === 0 && prepared.canvasMasks.length === 0) {
      const [a, b, c, d, e, f] = layer.transform;
      ctx.save();
      ctx.setTransform(vs * a, vs * b, vs * c, vs * d, vs * e + vx, vs * f + vy);
      clipCorners(ctx, layer);
      ctx.globalAlpha = clamp01(layer.opacity);
      ctx.globalCompositeOperation = composite.operation;
      paint(ctx, drawable, fill, layer.drawWidth, layer.drawHeight);
      ctx.restore();
      return;
    }
    const staged = this.canvasStage(frame, prepared, drawable, fill, canvasEffects, composite.operation);
    ctx.save();
    ctx.setTransform(vs, 0, 0, vs, vx, vy);
    // Opacity was applied when the layer was drawn, before its canvas-stage effects.
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = composite.operation;
    ctx.drawImage(staged, 0, 0, plan.width, plan.height);
    ctx.restore();
  }

  /** Steps 1–2: source picture → source-stage effects → source-stage masks, in draw space. */
  private sourceStage(frame: PreparedFrame, prepared: PreparedLayer, effects: EffectInstance[]): OffscreenCanvas {
    const { layer } = prepared;
    const dw = Math.max(1, Math.round(layer.drawWidth));
    const dh = Math.max(1, Math.round(layer.drawHeight));
    const scratch = this.pool.get("source", dw, dh);
    paint(scratch.ctx, prepared.picture?.image ?? null, layer.source.kind === "color" ? cssColor(layer.source.color) : null, dw, dh);
    let image = readPixels(scratch.ctx, dw, dh);
    for (const effect of effects) image = this.runEffect(effect, image, frame, prepared, prepared.sourceImages);
    image = this.runMasks(prepared.sourceMasks, image, frame, layer.clipId);
    const out = image.width === dw && image.height === dh ? scratch : this.pool.get("source-resized", image.width, image.height);
    writePixels(out.ctx, image);
    return out.canvas;
  }

  /** Steps 3–4 for layers with canvas-stage work: the transformed layer on a transparent frame-sized canvas → effects → masks. */
  private canvasStage(
    frame: PreparedFrame,
    prepared: PreparedLayer,
    drawable: CanvasImageSource | null,
    fill: string | null,
    effects: EffectInstance[],
    operation: GlobalCompositeOperation,
  ): OffscreenCanvas {
    const { layer } = prepared;
    const { width, height } = frame.plan;
    const scratch = this.pool.get("canvas", width, height);
    const sctx = scratch.ctx;
    sctx.save();
    sctx.imageSmoothingQuality = this.smoothing;
    sctx.setTransform(...layer.transform);
    clipCorners(sctx, layer);
    sctx.globalAlpha = clamp01(layer.opacity);
    sctx.globalCompositeOperation = operation;
    paint(sctx, drawable, fill, layer.drawWidth, layer.drawHeight);
    sctx.restore();
    let image = readPixels(sctx, width, height);
    for (const effect of effects) image = this.runEffect(effect, image, frame, prepared, prepared.canvasImages);
    image = this.runMasks(prepared.canvasMasks, image, frame, layer.clipId);
    const out = image.width === width && image.height === height ? scratch : this.pool.get("canvas-resized", image.width, image.height);
    writePixels(out.ctx, image);
    return out.canvas;
  }

  private runEffect(effect: EffectInstance, image: RgbaImage, frame: PreparedFrame, prepared: PreparedLayer, images: ReadonlyMap<string, RgbaImage>): RgbaImage {
    try {
      return this.engine.applyVideoEffect(image, effect, this.kernelContext(frame, prepared, effect, images));
    } catch (error) {
      frame.errors.push({ clipId: prepared.layer.clipId, stage: "effect", error });
      return image;
    }
  }

  private runMasks(masks: readonly PreparedMask[], image: RgbaImage, frame: PreparedFrame, clipId: string): RgbaImage {
    for (const { instance, image: mask } of masks) {
      try {
        this.engine.applyMask(image, mask, instance);
      } catch (error) {
        frame.errors.push({ clipId, stage: "mask", error });
      }
    }
    return image;
  }

  /** The context a kernel sees: the engine's `kernelContext` with this frame's resources. */
  private kernelContext(frame: PreparedFrame, prepared: PreparedLayer, effect: EffectInstance, images: ReadonlyMap<string, RgbaImage>) {
    const text = this.text();
    return kernelContext(frame.plan, prepared.layer, effect, {
      images,
      texts: prepared.texts,
      state: this.state,
      audio: prepared.audio,
      ...(text ? { text } : {}),
    });
  }

  private text(): TextRasterizer | null {
    if (this.textRasterizer === undefined) {
      this.textRasterizer = typeof OffscreenCanvas === "undefined" ? null : new CanvasTextRasterizer();
    }
    return this.textRasterizer;
  }
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** Clip `corner_radius`: the antialiased rounded rectangle of the draw rect (Clip.cpp:1416-1426). */
function clipCorners(ctx: DrawContext | Context2D, layer: LayerPlan): void {
  const radius = layer.cornerRadius ?? 0;
  if (!(radius > 0)) return;
  const r = Math.min(radius, layer.drawWidth / 2, layer.drawHeight / 2);
  ctx.beginPath();
  ctx.roundRect(0, 0, layer.drawWidth, layer.drawHeight, r);
  ctx.clip();
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
