/**
 * Which effects run on a clip at a frame, in which order, with which
 * resources: libopenshot `Clip::apply_effects` (Clip.cpp:1357-1375),
 * `Timeline::apply_effects` (Timeline.cpp:561-607), `EffectBase` JSON
 * handling (EffectBase.cpp:146-238) and `MapMaskFrameNumber` (:410-483).
 */

import { evaluate } from "../../keyframe/evaluate.js";
import { roundHalfAway } from "../../model/rounding.js";
import type { Effect, Fraction, Project, ReaderInfo } from "../../model/types.js";
import type { EffectInstance, EvaluatedParam } from "../types.js";
import { evaluateEffectParams } from "./effect-params.js";

/** libopenshot EffectInfo video effect types (EffectInfo.cpp:29-158), OpenCV ones included. */
export const VIDEO_EFFECT_TYPES: ReadonlySet<string> = new Set([
  "AnalogTape",
  "AudioVisualization",
  "Bars",
  "BeatSync",
  "Blur",
  "Brightness",
  "Caption",
  "ChromaKey",
  "ColorGrade",
  "ColorMap",
  "ColorShift",
  "Crop",
  "Deinterlace",
  "Displace",
  "FilmGrain",
  "Glow",
  "Hue",
  "LensFlare",
  "Mask",
  "Negate",
  "Pixelate",
  "Saturation",
  "Sharpen",
  "Shadow",
  "Shift",
  "SphericalProjection",
  "Timer",
  "DenoiseImage",
  "Wave",
  "Outline",
  "Stabilizer",
  "Tracker",
  "ObjectDetection",
  "ObjectMask",
]);

/** libopenshot audio effects (src/audio_effects). */
export const AUDIO_EFFECT_TYPES: ReadonlySet<string> = new Set([
  "Noise",
  "Delay",
  "Echo",
  "Distortion",
  "ParametricEQ",
  "Compressor",
  "Expander",
  "Robotization",
  "Whisperization",
]);

/** Effects constructed with `apply_before_clip = false` (Shadow.cpp:232, Glow.cpp:182). */
export function defaultApplyBeforeClip(type: string): boolean {
  return !(type === "Shadow" || type === "Glow");
}

export function applyBeforeClip(effect: Readonly<Record<string, unknown>>): boolean {
  const v = effect.apply_before_clip;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return defaultApplyBeforeClip(String(effect.type ?? effect.class_name ?? ""));
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * CompareClipEffects / CompareEffects (Clip.h:48-54, Timeline.h:64-70):
 * layer asc, position asc, order desc. std::list::sort is stable, so ties
 * keep JSON order.
 */
export function sortEffects<T extends Readonly<Record<string, unknown>>>(effects: readonly T[]): T[] {
  return effects
    .map((effect, index) => ({ effect, index }))
    .sort(
      (a, b) =>
        num(a.effect.layer) - num(b.effect.layer) ||
        Math.fround(num(a.effect.position)) - Math.fround(num(b.effect.position)) ||
        num(b.effect.order) - num(a.effect.order) ||
        a.index - b.index,
    )
    .map((e) => e.effect);
}

/**
 * `parent_effect_id`: the effect takes all JSON of the parent clip effect
 * except its own `id` and `parent_effect_id` (EffectBase.cpp:146-170).
 */
export function resolveParentEffect(effect: Effect, project: Project): Effect {
  const parentId = effect.parent_effect_id;
  if (typeof parentId !== "string" || parentId === "" || parentId === effect.id) return effect;
  for (const clip of project.clips) {
    for (const candidate of clip.effects ?? []) {
      if (candidate.id === parentId && candidate !== effect) {
        return { ...candidate, id: effect.id, parent_effect_id: parentId };
      }
    }
  }
  return effect;
}

function readerOf(value: unknown): ReaderInfo | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const r = value as ReaderInfo;
  return typeof r.path === "string" && r.path !== "" && typeof r.type === "string" ? r : undefined;
}

/**
 * The effect's mask reader as libopenshot resolves it: `mask_reader` when the
 * key is present (an empty object means none), else the legacy `reader` key
 * (EffectBase.cpp:208-218, Mask.cpp:207-211). Displace consumes `reader` as
 * its map before the mask parser runs (Displace.cpp), so it has no alias. A
 * reader without `type` is ignored (`CreateReaderFromJson`).
 */
export function maskReaderOf(effect: Readonly<Record<string, unknown>>): ReaderInfo | undefined {
  const json = effect.mask_reader !== undefined && effect.mask_reader !== null ? effect.mask_reader : effect.type === "Displace" ? undefined : effect.reader;
  return readerOf(json);
}

function fraction(v: unknown): Fraction | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const { num: n, den: d } = v as { num?: unknown; den?: unknown };
  return typeof n === "number" && typeof d === "number" && n > 0 && d > 0 ? { num: n, den: d } : undefined;
}

function intOf(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * `EffectBase::MapMaskFrameNumber` (EffectBase.cpp:410-483): which frame of a
 * video mask reader an effect uses at effect frame `n`. `timelineEffect` is
 * true for transitions (no parent clip), which subtract their start offset.
 */
export function mapMaskFrame(effect: Readonly<Record<string, unknown>>, reader: ReaderInfo, n: number, hostFps: Fraction, timelineEffect: boolean): number {
  const host = hostFps.num / hostFps.den;
  const start = Math.fround(num(effect.start));
  const end = Math.fround(num(effect.end));
  let index = Math.max(0, n - 1);
  if (timelineEffect) index = Math.max(0, index - Math.trunc(roundHalfAway(Math.max(0, start) * host)));
  let mapped = index;
  const maskFps = fraction(reader.fps);
  const timeMode = effect.mask_time_mode === 0 ? 0 : 1;
  if (timeMode === 1 && maskFps) {
    mapped = Math.trunc(roundHalfAway((index / host) * (maskFps.num / maskFps.den)));
  }
  const sourceLen = intOf(reader.video_length);
  const sourceFps = maskFps ? maskFps.num / maskFps.den : 30;
  const duration = num(reader.duration) > 0 ? Math.fround(num(reader.duration)) : sourceLen > 0 ? sourceLen / sourceFps : 0;
  const startSec = Math.min(Math.max(0, start), duration);
  const endSec = Math.min(Math.max(0, end), duration);
  const rangeStart = Math.max(1, Math.trunc(roundHalfAway(startSec * sourceFps)) + 1);
  let rangeEnd = endSec > 0 ? Math.trunc(roundHalfAway(endSec * sourceFps)) + 1 : sourceLen;
  if (sourceLen > 0) rangeEnd = Math.min(rangeEnd, sourceLen);
  if (rangeEnd < rangeStart) rangeEnd = rangeStart;
  const rangeLen = Math.max(1, rangeEnd - rangeStart + 1);
  let rangeIndex: number;
  const loop = typeof effect.mask_loop_mode === "number" && effect.mask_loop_mode >= 0 && effect.mask_loop_mode <= 2 ? effect.mask_loop_mode : 0;
  if (loop === 1) rangeIndex = mapped % rangeLen;
  else if (loop === 2) {
    if (rangeLen > 1) {
      const cycle = rangeLen * 2 - 2;
      let phase = mapped % cycle;
      if (phase >= rangeLen) phase = cycle - phase;
      rangeIndex = phase;
    } else rangeIndex = 0;
  } else rangeIndex = mapped < 0 ? 0 : mapped >= rangeLen ? rangeLen - 1 : mapped;
  let frame = rangeStart + rangeIndex;
  if (sourceLen > 0) frame = Math.min(Math.max(1, frame), sourceLen);
  return Math.max(1, frame);
}

/**
 * Displace's map: `map_reader` when present (an empty object clears it), else
 * the legacy `reader` (Displace.cpp:282-289).
 */
export function displaceMapReader(effect: Readonly<Record<string, unknown>>): ReaderInfo | undefined {
  const json = effect.map_reader !== undefined && effect.map_reader !== null ? effect.map_reader : effect.reader;
  return readerOf(json);
}

/** The video-map frame Displace reads at effect frame `n` (Displace.cpp:115-131). */
export function displaceMapFrame(reader: ReaderInfo, n: number, hostFps: Fraction): number {
  const length = intOf(reader.video_length);
  const fps = fraction(reader.fps);
  if (reader.has_video === false || length <= 0 || !fps) return n;
  const seconds = Math.max(0, n - 1) / (hostFps.num / hostFps.den);
  const mapped = Math.floor(seconds * (fps.num / fps.den)) + 1;
  return Math.min(Math.max(1, mapped), length);
}

export interface ResourceRefs {
  images: string[];
  texts: string[];
  imageFrames: Record<string, { frame: number; time: number }>;
}

/**
 * Images and texts an effect's kernel reads: the generic effect mask, the
 * Mask effect's own reader, Displace's map, LUT files. Video readers get the
 * source frame to decode.
 */
export function effectResources(effect: Readonly<Record<string, unknown>>, n: number, hostFps: Fraction, timelineEffect: boolean): ResourceRefs {
  const refs: ResourceRefs = { images: [], texts: [], imageFrames: {} };
  const addReader = (reader: ReaderInfo | undefined): void => {
    if (!reader) return;
    if (!refs.images.includes(reader.path)) refs.images.push(reader.path);
    if (reader.type === "FFmpegReader" && !reader.has_single_image) {
      const frame = mapMaskFrame(effect, reader, n, hostFps, timelineEffect);
      const fps = fraction(reader.fps);
      refs.imageFrames[reader.path] = { frame, time: fps ? (frame - 1) / (fps.num / fps.den) : (frame - 1) / 30 };
    }
  };
  addReader(maskReaderOf(effect));
  if (effect.type === "Displace") {
    const map = displaceMapReader(effect);
    if (map && !refs.images.includes(map.path)) refs.images.push(map.path);
    if (map && map.type === "FFmpegReader" && !map.has_single_image) {
      const frame = displaceMapFrame(map, n, hostFps);
      const fps = fraction(map.fps);
      refs.imageFrames[map.path] = { frame, time: fps ? (frame - 1) / (fps.num / fps.den) : (frame - 1) / 30 };
    }
  }
  const lut = effect.lut_path;
  if (typeof lut === "string" && lut !== "") refs.texts.push(lut);
  return refs;
}

/** An evaluated effect instance at effect-local frame `n`. */
export function effectInstance(effect: Effect, n: number, hostFps: Fraction, timelineEffect: boolean): EffectInstance {
  const type = String(effect.type ?? effect.class_name ?? "");
  const params: Record<string, EvaluatedParam> = evaluateEffectParams(effect, n);
  const refs = effectResources(effect, n, hostFps, timelineEffect);
  const instance: EffectInstance = { id: String(effect.id ?? ""), type, frame: n, params, applyBeforeClip: applyBeforeClip(effect) };
  if (refs.images.length) instance.images = refs.images;
  if (refs.texts.length) instance.texts = refs.texts;
  if (Object.keys(refs.imageFrames).length) instance.imageFrames = refs.imageFrames;
  return instance;
}

/** Keyframe or plain number property of an effect at a frame (empty keyframes are 0, like libopenshot). */
export function effectValue(effect: Readonly<Record<string, unknown>>, key: string, n: number, fallback: number): number {
  const v = effect[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v === "number") return v;
  return evaluate(v as never, n);
}
