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
  /**
   * libopenshot `apply_before_clip` (default true): run on the source image
   * before the clip transform. When false (Shadow, Glow defaults) the kernel
   * runs on the canvas-sized, already-transformed layer (`Clip::GetFrame` step 6).
   */
  applyBeforeClip?: boolean;
  /**
   * Paths of images this kernel reads from `KernelContext.images` (effect
   * `mask_reader`, Displace `map_reader`). Renderers preload them at draw size.
   */
  images?: string[];
  /** Paths of text resources (e.g. ColorMap `.cube` LUTs) read from `KernelContext.texts`. */
  texts?: string[];
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
  | {
      kind: "video";
      fileId: string;
      path: string;
      /**
       * Seconds from the source's first video frame: libopenshot source frame k
       * (1-based, after FrameMapper and `time` remapping) → (k − 1) / reader fps.
       * Renderers pick the decoded picture whose (pts − first pts) rounds to
       * that frame (half-frame tolerance, like FFmpegReader).
       */
      time: number;
      /** The 1-based source frame number `time` was derived from. */
      frame: number;
      /**
       * Apply container rotation metadata (`reader_orientation_mode`). False
       * for legacy clips whose keyframes already rotate. Default true.
       */
      applyRotation?: boolean;
    }
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
   * Stable across a clip's frames: derived from the clip's maximum scale over
   * its keyframes (libopenshot decode box), so zooms do not re-decode per frame.
   * A kernel that returns a differently sized image (Crop `resize`) is drawn
   * into (0, 0, drawWidth, drawHeight); the planner folds the aspect change
   * into `transform`.
   */
  drawWidth: number;
  drawHeight: number;
  /** Maps draw-space pixels (0..drawWidth, 0..drawHeight) to canvas pixels. */
  transform: Affine;
  /** 0..1, multiplied into the layer after effects. */
  opacity: number;
  /** libopenshot `CompositeType` blend mode: 0 normal (default), 12–23 (Add … Exclusion). */
  composite?: number;
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
  /**
   * Playback rate (1 = normal; time keyframes are sampled into rate changes).
   * Negative = reverse. Segments may extend past a requested range; renderers clip.
   */
  rate: number;
  /**
   * Piecewise-linear gain envelope sampled from the volume keyframe, with
   * volume mixing (AVERAGE/REDUCE) and transition audio fades already folded
   * in. Renderers apply it verbatim.
   */
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
  /** Text resources (LUT `.cube` files), keyed by path. Preloaded by renderers. */
  texts?: ReadonlyMap<string, string>;
  /** libopenshot effect `Id()`: FilmGrain and AnalogTape seed their noise from it. */
  effectId?: string;
  /** Timeline (project) frame rate; effects fall back to 30 fps without it. */
  fps?: { num: number; den: number };
  /**
   * libopenshot `timeline->info.width/height`: the project (or export) size,
   * not the preview canvas. FilmGrain and AnalogTape scale their noise by
   * `timelineWidth / image width`. Defaults to the canvas size.
   */
  timelineWidth?: number;
  timelineHeight?: number;
  /** The clip the effect belongs to (Timer). Absent for timeline effects. */
  clip?: KernelClipContext;
  /** This frame's audio for the clip (AudioVisualization, BeatSync, waveform clips). */
  audio?: KernelAudio;
  /** Text shaping and rasterization (Caption, Timer). Without it text effects draw nothing. */
  text?: TextRasterizer;
  /**
   * Per effect-instance state that must survive across frames (BeatSync's
   * envelope, DenoiseImage's previous frame). Renderers keep one Map per
   * effect id for a sequential render and clear it on seeks.
   */
  state?: Map<string, unknown>;
}

export interface KernelClipContext {
  /** Clip frame after time remapping: `max(1, time.GetLong(n))` when `time` has 2+ points, else n. */
  mappedFrame: number;
  /** The clip reader's native frame rate (libopenshot `clip->Reader()->info.fps`). */
  readerFps: number;
  /** `Clip::End() - Start()` in seconds. */
  duration: number;
}

export interface KernelAudio {
  sampleRate: number;
  /**
   * Planar samples of this frame (one array per channel): the clip's audio
   * after time remapping, before clip volume, like `frame->GetAudioSamples`.
   */
  channels: readonly Float32Array[];
}

/** A font request: family name and pixel size (QFont + setPixelSize). */
export interface TextFont {
  family: string;
  pixelSize: number;
}

/** Axis-aligned rectangle in pixels. */
export interface TextRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Font engine hook for Caption and Timer. The engine does all layout (line
 * breaking, alignment, backgrounds, fades) in pure TypeScript and asks the
 * host only for metrics and glyph rasterization. Coordinates are pixels with
 * the text origin on the baseline, like `QPainterPath::addText`.
 */
export interface TextRasterizer {
  /** `QFontMetricsF` line metrics. */
  fontMetrics(font: TextFont): { ascent: number; descent: number; lineSpacing: number };
  /** `QFontMetricsF::horizontalAdvance(text)`. */
  advance(text: string, font: TextFont): number;
  /** `QFontMetricsF::boundingRect(text)`, relative to the baseline origin. */
  bounds(text: string, font: TextFont): TextRect;
  /** Ink bounds of the glyph outlines (`QPainterPath::addText(0, 0, …).boundingRect()`). */
  inkBounds(text: string, font: TextFont): TextRect;
  /**
   * Draw `text` with its baseline origin at (x, y) onto a transparent,
   * straight-RGBA `target`: fill with `fill`, then (when `strokeWidth` > 0)
   * stroke the outline centered with `stroke` (square cap, bevel join).
   * Colors are straight RGBA 0..255. `clip` limits drawing when given.
   */
  drawText(target: RgbaImage, text: string, x: number, y: number, font: TextFont, fill: RGBA, stroke: RGBA | null, strokeWidth: number, clip?: TextRect): void;
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
