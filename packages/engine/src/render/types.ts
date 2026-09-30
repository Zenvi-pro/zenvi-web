/**
 * Frame and audio plans: what to draw and play, independent of how.
 *
 * The planner (`planFrame`, `planAudio`) turns a project and a timeline frame
 * into these plain objects by evaluating keyframes, clip windows, time
 * remapping, transforms, effects and transitions exactly like libopenshot 1.0
 * (`docs/specs/libopenshot-semantics.md`). Renderers (`@zenvi/render-web`,
 * `@zenvi/render-node`) only execute plans. Nothing in a plan requires the
 * renderer to know OpenShot semantics.
 */

/** Straight (non-premultiplied) RGBA, row-major, 4 bytes per pixel. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** 2×3 affine matrix [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (Canvas2D order). */
export type Affine = [number, number, number, number, number, number];

export type RGBA = [number, number, number, number];

/** A parameter value after keyframe evaluation at one frame. */
export type EvaluatedParam = number | string | boolean | RGBA | EvaluatedParam[] | { [key: string]: EvaluatedParam };

export interface EffectInstance {
  id: string;
  /** libopenshot class name, e.g. "Brightness". */
  type: string;
  /** Frame number local to the effect (libopenshot passes this to GetFrame). */
  frame: number;
  params: Record<string, EvaluatedParam>;
}

export interface MaskInstance {
  transitionId: string;
  /** Source of the mask image (resolve like any media path). */
  maskPath: string;
  brightness: number;
  contrast: number;
  /** libopenshot Mask `replace_image`: draw the mask itself instead of applying it. */
  replaceImage: boolean;
}

export type LayerSource =
  | { kind: "video"; fileId: string; path: string; time: number; frame: number }
  | { kind: "image"; fileId: string; path: string }
  | { kind: "svg"; fileId: string; path: string }
  | { kind: "color"; color: RGBA };

export interface LayerPlan {
  clipId: string;
  layer: number;
  source: LayerSource;
  /** Natural size of the source in pixels (before any transform). */
  sourceWidth: number;
  sourceHeight: number;
  /**
   * Size the source should be rasterized/decoded at before `transform` is
   * applied (after the clip's scale mode). Renderers may decode at this size.
   */
  drawWidth: number;
  drawHeight: number;
  /** Maps draw-space pixels (0..drawWidth, 0..drawHeight) to canvas pixels. */
  transform: Affine;
  /** 0..1, multiplied into the layer after effects. */
  opacity: number;
  /** Clip effects in apply order, evaluated at this frame. */
  effects: EffectInstance[];
  /** Transitions that apply to this layer at this frame, in apply order. */
  masks: MaskInstance[];
}

export interface FramePlan {
  /** 1-based timeline frame number. */
  frame: number;
  /** Timeline time in seconds of this frame's start. */
  time: number;
  width: number;
  height: number;
  background: RGBA;
  /** Bottom to top. */
  layers: LayerPlan[];
}

export interface GainPoint {
  /** Seconds relative to the segment start. */
  t: number;
  gain: number;
}

export interface AudioSegment {
  clipId: string;
  fileId: string;
  path: string;
  /** Timeline start of this segment, seconds. */
  timelineStart: number;
  /** Source start, seconds. */
  sourceStart: number;
  /** Length on the timeline, seconds. */
  duration: number;
  /** Playback rate (1 = normal; time keyframes are sampled into rate changes). */
  rate: number;
  /** Piecewise-linear gain envelope sampled from the volume keyframe. */
  gain: GainPoint[];
  /** Audio effects to run on the segment, evaluated at its start. */
  effects: EffectInstance[];
}

export interface AudioPlan {
  sampleRate: number;
  channels: number;
  /** Covered timeline range, seconds. */
  start: number;
  end: number;
  segments: AudioSegment[];
}

/** Inputs every renderer resolves before executing a plan. */
export interface PlanSize {
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Kernels: effect math shared by every renderer
// ---------------------------------------------------------------------------

export interface KernelContext {
  /** Effect-local frame number (EffectInstance.frame). */
  frame: number;
  /** Canvas (output) size the layer will be composited into. */
  canvasWidth: number;
  canvasHeight: number;
  /**
   * Extra images the kernel needs (mask images for Mask), keyed by path.
   * Renderers preload them; kernels are synchronous.
   */
  images: ReadonlyMap<string, RgbaImage>;
}

/**
 * A video effect, in place on straight RGBA. May return a new image when the
 * effect changes the image size; otherwise returns void.
 */
export type VideoKernel = (image: RgbaImage, params: Record<string, EvaluatedParam>, ctx: KernelContext) => RgbaImage | void;

/** An audio effect, in place on planar float samples (one array per channel). */
export type AudioKernel = (
  channels: Float32Array[],
  sampleRate: number,
  params: Record<string, EvaluatedParam>,
  state: Map<string, unknown>,
) => void;
