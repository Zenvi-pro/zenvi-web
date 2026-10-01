/**
 * `planFrame`: what libopenshot's `Timeline::GetFrame` draws at one timeline
 * frame (src/Timeline.cpp:978-1162), as a renderer-independent `FramePlan`.
 *
 * Per clip it follows `Clip::GetFrame` (Clip.cpp:476-540): source frame via
 * the `time` curve and the FrameMapper, `has_video` override, waveform
 * replacement, effects before the transform (clip, then this layer's
 * timeline effects when the clip is the top clip), `get_transform`, alpha,
 * corner radius, effects after the transform, blend mode.
 */

import { getCount, getInt, getLength, getLong } from "../../keyframe/evaluate.js";
import { roundHalfAway } from "../../model/rounding.js";
import type { Clip, Effect, Fraction, Project } from "../../model/types.js";
import { sortClips } from "../../timeline/queries.js";
import { frameSampleOffset, samplesPerFrame } from "../../timeline/time.js";
import { frameWindow, localFrame, windowContains, type FrameWindow } from "../../timeline/windows.js";
import { cropOutputSize } from "../kernels/geometry.js";
import { QTransform } from "../qt/transform.js";
import type { EffectInstance, FramePlan, KernelClipContext, LayerAudioRequest, LayerPlan, LayerSource, MaskInstance, PlanSize, RGBA } from "../types.js";
import { applyBeforeClip, effectInstance, effectValue, mapMaskFrame, maskReaderOf, resolveParentEffect, sortEffects, VIDEO_EFFECT_TYPES } from "./effects.js";
import { mappedSourceFrame } from "./frame-mapper.js";
import { deliveredSource, qsizeScaled } from "./reader.js";
import { clipKeyframe, clipTransform } from "./transform.js";

export interface PlanOptions {
  /**
   * false (default): `size` is the render size; the canvas and libopenshot's
   * timeline info size both become `size` (the desktop exporter).
   * true: `size` is a preview box; the canvas is the project size fitted
   * into it (`Timeline::SetMaxSize`, never larger than the project) and the
   * timeline info size stays the project's.
   */
  preview?: boolean;
}

const f32 = Math.fround;

function int(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function bool(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return fallback;
}

function fractionOf(v: unknown, fallback: Fraction): Fraction {
  if (typeof v === "object" && v !== null) {
    const { num, den } = v as { num?: unknown; den?: unknown };
    if (typeof num === "number" && typeof den === "number" && num > 0 && den > 0) return { num, den };
  }
  return fallback;
}

interface CanvasInfo {
  width: number;
  height: number;
  timelineWidth: number;
  timelineHeight: number;
}

/** Canvas and timeline info sizes for a plan (Timeline::SetMaxSize, Timeline.cpp:1860-1871). */
export function planCanvas(project: Project, size: PlanSize | undefined, options: PlanOptions | undefined): CanvasInfo {
  const projW = Math.max(1, int(project.width, 1));
  const projH = Math.max(1, int(project.height, 1));
  if (options?.preview) {
    const box = size ?? { width: projW, height: projH };
    const fitted = qsizeScaled(projW, projH, Math.min(Math.trunc(box.width), projW), Math.min(Math.trunc(box.height), projH), "keep");
    return { width: Math.max(1, fitted.width), height: Math.max(1, fitted.height), timelineWidth: projW, timelineHeight: projH };
  }
  const w = Math.max(1, Math.trunc(size?.width ?? projW));
  const h = Math.max(1, Math.trunc(size?.height ?? projH));
  return { width: w, height: h, timelineWidth: w, timelineHeight: h };
}

/** Clip frame after the `time` curve (Clip::GetOrCreateFrame, Clip.cpp:749-765). */
export function remappedClipFrame(clip: Clip, n: number): number {
  let frame = Math.max(1, n);
  if (clip.time && getLength(clip.time) > 1) frame = Math.max(1, getLong(clip.time, frame));
  return frame;
}

/**
 * `Clip::End()`: with 2+ time points, the curve's length over the (mapped)
 * reader's float fps, else `end` (Clip.cpp:426-445).
 */
export function clipEnd(clip: Clip, fps: Fraction): number {
  if (clip.time && getCount(clip.time) > 1) {
    return f32(f32(getLength(clip.time)) / f32(f32(fps.num) / f32(fps.den)));
  }
  return f32(clip.end);
}

function parentOf(clip: Clip, project: Project): Clip | undefined {
  const id = clip.parentObjectId;
  if (typeof id !== "string" || id === "" || id === clip.id) return undefined;
  return project.clips.find((c) => c.id === id);
}

/** Samples of clip frame `k` in the FrameMapper's layout (FrameMapper.cpp:260-316, :1097-1117). */
function audioRequest(clip: Clip, k: number, project: Project, fps: Fraction): LayerAudioRequest | undefined {
  const reader = clip.reader;
  if (!reader || reader.has_audio === false) return undefined;
  const rate = int(project.sample_rate, 48000) || 48000;
  const channels = int(project.channels, 2) || 2;
  const fpsD = fps.num / fps.den;
  const clipStartFrame = Math.trunc(f32(clip.start) * fpsD) + 1;
  const clipStartPosition = Math.trunc(roundHalfAway(f32(clip.position) * fpsD)) + 1;
  const c = clipStartPosition - clipStartFrame;
  const first = frameSampleOffset(1 + c, fps, rate, channels);
  const start = frameSampleOffset(k + c, fps, rate, channels) - first;
  return {
    fileId: String(clip.file_id ?? ""),
    path: String(reader.path ?? ""),
    sourceStart: start / rate,
    samples: samplesPerFrame(k + c, fps, rate, channels),
    sampleRate: rate,
    channels,
  };
}

/** Clip::apply_waveform's AudioVisualization settings (Clip.cpp:1472-1520). */
function waveformEffect(clip: Clip, n: number): EffectInstance {
  const channel = (name: "red" | "green" | "blue" | "alpha", fallback: number): number => {
    const kf = clip.wave_color?.[name];
    return kf === undefined || kf === null ? fallback : getInt(kf, n);
  };
  return {
    id: `${clip.id}-waveform`,
    type: "AudioVisualization",
    frame: n,
    applyBeforeClip: true,
    params: {
      visualization_type: int(clip.waveform_mode, 1),
      style: 3,
      color: [channel("red", 0), channel("green", 123), channel("blue", 255), channel("alpha", 255)],
      intensity: 1,
      smoothing: 0.25,
      detail: 0.75,
      glow: 0,
      color_spread: 0,
      color_mode: 0,
      channel_layout: 0,
      frequency_low: 0,
      frequency_high: 1,
      background: 0,
    },
  };
}

interface Stage {
  effects: EffectInstance[];
  masks: MaskInstance[];
}

/** Timeline effects on the clip's layer at `f` (Timeline::apply_effects, Timeline.cpp:561-607). */
function timelineEffects(project: Project, layer: number, f: number, fps: Fraction, before: Stage, after: Stage): void {
  for (const raw of sortEffects(project.effects ?? [])) {
    const effect = raw as unknown as Effect;
    if (int(effect.layer) !== layer) continue;
    const window = frameWindow({ position: Number(effect.position ?? 0), start: Number(effect.start ?? 0), end: Number(effect.end ?? 0) }, fps);
    if (!windowContains(window, f)) continue;
    const lf = localFrame(window, f);
    const stage = applyBeforeClip(effect) ? before : after;
    if (effect.type === "Mask") {
      const reader = maskReaderOf(effect);
      if (!reader) continue;
      const mask: MaskInstance = {
        transitionId: String(effect.id ?? ""),
        maskPath: reader.path,
        brightness: effectValue(effect, "brightness", lf, 0),
        contrast: effectValue(effect, "contrast", lf, 0),
        replaceImage: bool(effect.replace_image),
        invert: bool(effect.mask_invert),
        applyBeforeClip: applyBeforeClip(effect),
        frame: lf,
      };
      if (reader.type === "FFmpegReader" && !reader.has_single_image) {
        const frame = mapMaskFrame(effect, reader, lf, fps, true);
        const mfps = fractionOf(reader.fps, { num: 30, den: 1 });
        mask.maskFrame = frame;
        mask.maskTime = (frame - 1) / (mfps.num / mfps.den);
      }
      stage.masks.push(mask);
    } else if (VIDEO_EFFECT_TYPES.has(String(effect.type))) {
      stage.effects.push(effectInstance(effect, lf, fps, true));
    }
  }
}

const AUDIO_REACTIVE = new Set(["AudioVisualization", "BeatSync"]);

function planLayer(
  project: Project,
  clip: Clip,
  window: FrameWindow,
  f: number,
  isTop: boolean,
  canvas: CanvasInfo,
  fps: Fraction,
): LayerPlan | null {
  const n = localFrame(window, f);
  const reader = clip.reader;
  const delivered = deliveredSource(clip, { previewWidth: canvas.width, previewHeight: canvas.height, timelineWidth: canvas.timelineWidth });
  if (delivered.kind === "unsupported") return null;
  const k = remappedClipFrame(clip, n);
  const hasVideoOverride = clip.has_video === undefined || clip.has_video === null ? -1 : getInt(clip.has_video, n);
  const readerHasVideo = delivered.kind !== "video" || reader.has_video !== false;
  const visible = hasVideoOverride !== 0 && readerHasVideo;

  const clipEffects = sortEffects(clip.effects ?? [])
    .map((e) => resolveParentEffect(e, project))
    .filter((e) => VIDEO_EFFECT_TYPES.has(String(e.type)));
  const before: Stage = { effects: [], masks: [] };
  const after: Stage = { effects: [], masks: [] };
  for (const e of clipEffects) (applyBeforeClip(e) ? before : after).effects.push(effectInstance(e, n, fps, false));
  if (isTop) timelineEffects(project, int(clip.layer), f, fps, before, after);

  let source: LayerSource;
  let drawW = delivered.width;
  let drawH = delivered.height;
  const waveform = bool(clip.waveform);
  if (waveform) {
    // The waveform replaces the image with a canvas-sized visualization.
    source = { kind: "color", color: [0, 0, 0, 0] };
    drawW = canvas.width;
    drawH = canvas.height;
    before.effects.unshift(waveformEffect(clip, n));
  } else if (!visible) {
    // Transparent frame of the reader's size: only effects can draw on it.
    // Audio-only FFmpegReaders report the timeline preview size
    // (FFmpegReader.cpp:999-1019), so Caption/Timer on audio clips cover the canvas.
    if (before.effects.length === 0 && after.effects.length === 0) return null;
    source = { kind: "color", color: [0, 0, 0, 0] };
    if (delivered.kind === "video" && reader.has_video === false) {
      drawW = canvas.width;
      drawH = canvas.height;
    }
  } else if (delivered.kind === "video") {
    const readerFps = fractionOf(reader.fps, fps);
    const sourceFrame = mappedSourceFrame(
      {
        fps: readerFps,
        videoLength: int(reader.video_length),
        hasVideo: reader.has_video !== false,
        hasAudio: reader.has_audio === true,
        hasSingleImage: reader.has_single_image === true,
      },
      fps,
      k,
    );
    source = {
      kind: "video",
      fileId: String(clip.file_id ?? ""),
      path: String(reader.path),
      time: (sourceFrame - 1) / (readerFps.num / readerFps.den),
      frame: sourceFrame,
      applyRotation: delivered.applyRotation,
    };
  } else {
    source = { kind: delivered.kind, fileId: String(clip.file_id ?? ""), path: String(reader.path) };
  }

  // Size of the image the transform is built for, after size-changing effects.
  let effW = drawW;
  let effH = drawH;
  for (const e of before.effects) {
    if (e.type === "Crop") ({ width: effW, height: effH } = cropOutputSize(e.params, effW, effH));
    if (effW <= 0 || effH <= 0) return null;
  }

  let t = clipTransform(clip, n, effW, effH, canvas.width, canvas.height, fps, parentOf(clip, project));
  if (effW !== drawW || effH !== drawH) {
    // Renderers draw the resized image into (0, 0, drawW, drawH).
    t = new QTransform().scale(effW / drawW, effH / drawH).multiply(t);
  }

  const alpha = Math.min(1, Math.max(0, f32(clipKeyframe(clip, "alpha", n))));
  const cornerFraction = Math.max(0, Math.min(0.5, clipKeyframe(clip, "corner_radius", n)));
  const layer: LayerPlan = {
    clipId: String(clip.id),
    layer: int(clip.layer),
    source,
    sourceWidth: delivered.naturalWidth || drawW,
    sourceHeight: delivered.naturalHeight || drawH,
    drawWidth: drawW,
    drawHeight: drawH,
    transform: t.toAffine(),
    opacity: alpha,
    composite: int(clip.composite, 0),
    effects: [...before.effects, ...after.effects],
    masks: [...before.masks, ...after.masks],
    clip: clipContext(clip, n, fps),
  };
  if (cornerFraction > 0) layer.cornerRadius = cornerFraction * Math.min(effW, effH) * (drawW / effW);
  if (waveform || layer.effects.some((e) => AUDIO_REACTIVE.has(e.type))) {
    const request = audioRequest(clip, k, project, fps);
    if (request) layer.audio = request;
  }
  return layer;
}

function clipContext(clip: Clip, n: number, fps: Fraction): KernelClipContext {
  const hasCurve = clip.time !== undefined && clip.time !== null && getLength(clip.time) > 1;
  return {
    mappedFrame: hasCurve ? Math.max(1, getLong(clip.time, n)) : n,
    readerFps: fps.num / fps.den,
    duration: f32(clipEnd(clip, fps) - f32(clip.start)),
  };
}

/** The timeline canvas color: always opaque black for desktop projects (see docs/PARITY.md). */
const BACKGROUND: RGBA = [0, 0, 0, 255];

/**
 * Plan timeline frame `frame` (1-based) at `size` (default: the project
 * size). See `PlanOptions` for preview versus render sizing.
 */
export function planFrame(project: Project, frame: number, size?: PlanSize, options?: PlanOptions): FramePlan {
  const fps = fractionOf(project.fps, { num: 30, den: 1 });
  const f = Math.max(1, Math.trunc(frame));
  const canvas = planCanvas(project, size, options);

  const clips = sortClips(project.clips ?? []);
  const windows = clips.map((c) => frameWindow(c, fps));
  const topByLayer = new Map<number, number>();
  const topStart = new Map<number, number>();
  clips.forEach((clip, i) => {
    const w = windows[i]!;
    if (!windowContains(w, f)) return;
    const layer = int(clip.layer);
    const best = topStart.get(layer);
    if (best === undefined || w.startFrame > best) {
      topStart.set(layer, w.startFrame);
      topByLayer.set(layer, i);
    }
  });

  const layers: LayerPlan[] = [];
  clips.forEach((clip, i) => {
    const w = windows[i]!;
    if (!windowContains(w, f)) return;
    const plan = planLayer(project, clip, w, f, topByLayer.get(int(clip.layer)) === i, canvas, fps);
    if (plan) layers.push(plan);
  });

  return {
    frame: f,
    time: (f - 1) / (fps.num / fps.den),
    width: canvas.width,
    height: canvas.height,
    background: [...BACKGROUND] as RGBA,
    layers,
    fps: { num: fps.num, den: fps.den },
    timelineWidth: canvas.timelineWidth,
    timelineHeight: canvas.timelineHeight,
    sampleRate: int(project.sample_rate, 48000) || 48000,
    channels: int(project.channels, 2) || 2,
  };
}
