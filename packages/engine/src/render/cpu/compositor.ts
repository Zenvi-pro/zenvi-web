/**
 * The CPU reference compositor: executes a `FramePlan` exactly like
 * libopenshot composites a timeline frame (Clip::GetFrame, Clip.cpp:476-540;
 * apply_keyframes :1384-1469; apply_background :1338-1354), on premultiplied
 * pixels with the Qt raster ports in `../qt`.
 *
 * Per layer: source → effects/masks before the transform → draw with the
 * clip transform (bilinear unless the transform is the identity, opacity,
 * antialiased rounded-corner clip) into a transparent canvas-sized layer →
 * effects/masks after the transform → composite onto the canvas with the
 * clip's blend mode. For SourceOver without after-effects the two draws are
 * fused into one: drawing onto transparent pixels yields exactly the
 * source-over operand, so the result is identical.
 */

import { applyMaskFromSource } from "../kernels/mask.js";
import { processEffect } from "../kernels/registry.js";
import { byteMul, createPremul, premultiply, unpremultiply, type PremulImage } from "../pixels.js";
import { CompositionMode } from "../qt/compose.js";
import { drawImage, roundedRectClip } from "../qt/draw-image.js";
import { smoothScale } from "../qt/smooth-scale.js";
import { QTransform } from "../qt/transform.js";
import type { EffectInstance, FramePlan, KernelAudio, KernelContext, LayerPlan, MaskInstance, RgbaImage, TextRasterizer } from "../types.js";

/** Effect state that persists across the frames of one sequential render. */
export interface CompositorState {
  effects: Map<string, Map<string, unknown>>;
}

export function createCompositorState(): CompositorState {
  return { effects: new Map() };
}

export interface CompositeSources {
  /**
   * Decoded source per `plan.layers` index (straight RGBA). Draw size is
   * preferred; any other size is smooth-scaled to drawWidth×drawHeight with
   * Qt's algorithm (pass stills at their natural size to reproduce
   * QtImageReader exactly). `color` sources need no entry.
   */
  layers: readonly (RgbaImage | null | undefined)[];
  /** Mask images (transitions, effect `mask_reader`) and Displace maps by path, natural size. */
  images?: ReadonlyMap<string, RgbaImage>;
  /** LUT `.cube` texts by path. */
  texts?: ReadonlyMap<string, string>;
  /** Font hook for Caption and Timer. */
  text?: TextRasterizer;
  /** This frame's clip audio per layer index (see `LayerPlan.audio`). */
  audio?: readonly (KernelAudio | null | undefined)[];
  /** Pass the same object for every frame of a sequential render. */
  state?: CompositorState;
}

const EMPTY_IMAGES: ReadonlyMap<string, RgbaImage> = new Map();

/** Everything a kernel may read about its frame, layer and effect. */
export function kernelContext(
  plan: FramePlan,
  layer: LayerPlan,
  effect: EffectInstance,
  extras: Pick<CompositeSources, "images" | "texts" | "text" | "state"> & { audio?: KernelAudio | null },
): KernelContext {
  const ctx: KernelContext = {
    frame: effect.frame,
    canvasWidth: plan.width,
    canvasHeight: plan.height,
    images: extras.images ?? EMPTY_IMAGES,
    effectId: effect.id,
    timelineWidth: plan.timelineWidth ?? plan.width,
    timelineHeight: plan.timelineHeight ?? plan.height,
  };
  if (extras.texts) ctx.texts = extras.texts;
  if (effect.imageSizes) ctx.imageSizes = effect.imageSizes;
  if (plan.fps) ctx.fps = plan.fps;
  if (layer.clip) ctx.clip = layer.clip;
  if (extras.audio) ctx.audio = extras.audio;
  if (extras.text) ctx.text = extras.text;
  if (extras.state) {
    let map = extras.state.effects.get(effect.id);
    if (!map) {
      map = new Map();
      extras.state.effects.set(effect.id, map);
    }
    ctx.state = map;
  }
  return ctx;
}

function solid(width: number, height: number, rgba: readonly number[]): PremulImage {
  const img = createPremul(width, height);
  // QImage::fill(QColor) premultiplies with qPremultiply.
  const a = Math.min(255, Math.max(0, Math.round(rgba[3] ?? 255)));
  const r = byteMul(Math.min(255, Math.max(0, Math.round(rgba[0] ?? 0))), a);
  const g = byteMul(Math.min(255, Math.max(0, Math.round(rgba[1] ?? 0))), a);
  const b = byteMul(Math.min(255, Math.max(0, Math.round(rgba[2] ?? 0))), a);
  if (r || g || b || a) {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = a;
    }
  }
  return img;
}

function sourceImage(layer: LayerPlan, source: RgbaImage | null | undefined): PremulImage | null {
  if (layer.source.kind === "color") return solid(layer.drawWidth, layer.drawHeight, layer.source.color);
  if (!source || source.width <= 0 || source.height <= 0) return null;
  const pm = premultiply(source);
  if (pm.width === layer.drawWidth && pm.height === layer.drawHeight) return pm;
  return smoothScale(pm, layer.drawWidth, layer.drawHeight);
}

function applyMasks(image: PremulImage, masks: readonly MaskInstance[], images: ReadonlyMap<string, RgbaImage>): void {
  for (const m of masks) {
    const src = images.get(m.maskPath);
    if (!src) continue;
    applyMaskFromSource(image, src, { brightness: m.brightness, contrast: m.contrast, replaceImage: m.replaceImage, invert: m.invert ?? false });
  }
}

function drawLayer(canvas: PremulImage, plan: FramePlan, layer: LayerPlan, index: number, sources: CompositeSources): void {
  let image = sourceImage(layer, sources.layers[index]);
  if (!image) return;
  const images = sources.images ?? EMPTY_IMAGES;
  const request = layer.audio;
  const audio = request?.silent
    ? { sampleRate: request.sampleRate, channels: Array.from({ length: request.channels }, () => new Float32Array(request.samples)) }
    : (sources.audio?.[index] ?? null);
  const extras = { images, texts: sources.texts, text: sources.text, state: sources.state, audio };

  for (const effect of layer.effects) {
    if (effect.applyBeforeClip === false) continue;
    image = processEffect(image, effect, kernelContext(plan, layer, effect, extras));
    if (image.width <= 0 || image.height <= 0) return;
  }
  applyMasks(
    image,
    layer.masks.filter((m) => m.applyBeforeClip !== false),
    images,
  );

  let transform = QTransform.fromAffine(layer.transform);
  if (image.width !== layer.drawWidth || image.height !== layer.drawHeight) {
    // The image is drawn into (0, 0, drawWidth, drawHeight) (render/types.ts LayerPlan).
    transform = new QTransform().scale(layer.drawWidth / image.width, layer.drawHeight / image.height).multiply(transform);
  }
  const radius = (layer.cornerRadius ?? 0) * (image.width / layer.drawWidth);
  const clip = radius > 0 ? roundedRectClip(image.width, image.height, radius, transform, canvas.width, canvas.height) : null;
  const mode = layer.composite ?? CompositionMode.SourceOver;
  const afterEffects = layer.effects.filter((e) => e.applyBeforeClip === false);
  const afterMasks = layer.masks.filter((m) => m.applyBeforeClip === false);
  const state = { transform, smooth: !transform.isIdentity(), antialias: radius > 0, opacity: layer.opacity, mode, clip };

  if (mode === CompositionMode.SourceOver && afterEffects.length === 0 && afterMasks.length === 0) {
    drawImage(canvas, image, state);
    return;
  }
  let layerCanvas = createPremul(canvas.width, canvas.height);
  drawImage(layerCanvas, image, state);
  for (const effect of afterEffects) {
    layerCanvas = processEffect(layerCanvas, effect, kernelContext(plan, layer, effect, extras));
  }
  applyMasks(layerCanvas, afterMasks, images);
  drawImage(canvas, layerCanvas, { transform: new QTransform(), smooth: false, antialias: false, opacity: 1, mode, clip: null });
}

/**
 * Composite a planned frame. Returns straight RGBA of plan.width ×
 * plan.height (written into `out` when given).
 */
export function compositeFrame(plan: FramePlan, sources: CompositeSources, out?: RgbaImage): RgbaImage {
  const canvas = solid(plan.width, plan.height, plan.background);
  plan.layers.forEach((layer, i) => drawLayer(canvas, plan, layer, i, sources));
  if (out && (out.width !== plan.width || out.height !== plan.height)) {
    throw new RangeError(`compositeFrame: out is ${out.width}x${out.height}, plan is ${plan.width}x${plan.height}`);
  }
  return unpremultiply(canvas, out);
}
