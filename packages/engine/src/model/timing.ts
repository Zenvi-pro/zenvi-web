/**
 * Clip timing rules the desktop applies whenever a clip is saved from the
 * timeline, ported from zenvi-core src/classes/clip_utils.py
 * (`clamp_timing_to_media` and helpers, `video_length_to_project_frames`,
 * `clip_time_bounds`).
 *
 * Clip start/end are clamped to the media; clips with a remapped `time`
 * curve are bounded by the curve instead; still images are only normalized
 * (they can be any length).
 */

import type { Fraction } from "./types.js";
import { isSingleImageMedia } from "./media.js";
import { pyRound } from "./rounding.js";
import { limitDenominator } from "../timeline/time.js";

type Data = Record<string, unknown>;

function isRecord(value: unknown): value is Data {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFloat(value: unknown): number | null {
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim());
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function roundedInt(value: unknown): number | null {
  const f = toFloat(value);
  return f === null || !Number.isFinite(f) ? null : pyRound(f);
}

function positiveInt(value: unknown): number | null {
  const n = roundedInt(value);
  return n === null || n <= 0 ? null : n;
}

function positiveFloat(value: unknown): number | null {
  const n = toFloat(value);
  return n === null || n <= 0 ? null : n;
}

/** clip_utils `_fps_fraction`: a {num, den} object or a positive number. */
function fpsFraction(value: unknown): Fraction | null {
  if (typeof value === "number") return value > 0 ? limitDenominator(value, 1_000_000) : null;
  if (!isRecord(value)) return null;
  const num = Math.trunc(Number(value.num));
  const den = Math.trunc(Number(value.den));
  return Number.isFinite(num) && Number.isFinite(den) && num !== 0 && den !== 0 ? { num, den } : null;
}

/**
 * Project frames needed to play `media` (clip_utils
 * `video_length_to_project_frames`): `video_length` (or duration × source
 * fps) rescaled from the source frame rate to the project's.
 */
export function videoLengthToProjectFrames(media: unknown, projectFps: Fraction): number | null {
  const data = isRecord(media) ? media : {};
  let frames = positiveInt(data.video_length);
  const sourceFps = fpsFraction(data.fps);
  const duration = positiveFloat(data.duration);
  if (frames === null && duration !== null && sourceFps) {
    frames = Math.trunc(pyRound(duration * (sourceFps.num / sourceFps.den)));
  }
  if (frames === null || frames <= 0) return null;
  if (!sourceFps) return Math.max(frames, 1);
  // Fraction(frames) * project / source, then float() and round().
  const scaled = (frames * projectFps.num * sourceFps.den) / (projectFps.den * sourceFps.num);
  if (!Number.isFinite(scaled)) return Math.max(frames, 1);
  return Math.max(pyRound(scaled), 1);
}

/** clip_utils `_reader_bounds`: the reader's duration (s) and length in project frames. */
export function readerBounds(reader: unknown, projectFps: Fraction): { duration: number | null; frames: number | null } {
  const data = isRecord(reader) ? reader : {};
  let duration = toFloat(data.duration);
  if (duration !== null && duration < 0) duration = null;
  const rate = projectFps.num / projectFps.den;
  let frames = videoLengthToProjectFrames(data, projectFps);
  if (duration === null && frames) duration = frames / rate;
  if (frames === null && duration !== null) frames = positiveInt(duration * rate);
  return { duration, frames };
}

function timePoints(clip: Data): Data[] | null {
  const time = clip.time;
  const points = isRecord(time) ? time.Points : undefined;
  return Array.isArray(points) ? (points as Data[]) : null;
}

function timeCurveLengthFrames(points: Data[] | null): number | null {
  let maxX = 0;
  for (const point of points ?? []) {
    const co = isRecord(point) ? point.co : undefined;
    if (!isRecord(co)) continue;
    const x = roundedInt(co.X);
    if (x !== null) maxX = Math.max(maxX, x);
  }
  return maxX || null;
}

/** Round time points to integers and keep Y (source frame) within [1, maxFrames]. Returns new points. */
function clampTimePoints(points: Data[], maxFrames: number): Data[] {
  return points.map((point) => {
    const co = isRecord(point) ? point.co : undefined;
    if (!isRecord(co)) return point;
    const next: Data = { ...co };
    const x = roundedInt(co.X);
    if (x !== null) next.X = x;
    const y = roundedInt(co.Y);
    if (y !== null) next.Y = y < 1 ? 1 : y > maxFrames ? maxFrames : y;
    return { ...point, co: next };
  });
}

export interface ClipTiming {
  start: number;
  end: number;
  duration: number;
  /** New `time` keyframe when the points were rounded/clamped, else undefined. */
  time?: { Points: Data[]; [key: string]: unknown };
}

/**
 * The timing the desktop would save for `clip` (clip_utils
 * `clamp_timing_to_media`). `clip` needs `start`/`end`/`duration`, `time`
 * and `reader`; `existing` supplies missing timing fields and the reader.
 */
export function clampTimingToMedia(clip: Data, projectFps: Fraction, existing?: Data): ClipTiming {
  const reader = isRecord(clip.reader) && Object.keys(clip.reader).length ? clip.reader : existing?.reader;
  const pick = (key: "start" | "end" | "duration"): unknown =>
    clip[key] === undefined || clip[key] === null ? existing?.[key] : clip[key];
  const rate = projectFps.num / projectFps.den;

  const single =
    isSingleImageMedia(reader) ||
    isSingleImageMedia(clip) ||
    isSingleImageMedia(clip.reader) ||
    isSingleImageMedia(existing) ||
    isSingleImageMedia(existing?.reader);
  if (single) {
    let start = toFloat(pick("start"));
    if (start === null || start < 0) start = 0;
    let end = toFloat(pick("end"));
    let duration = toFloat(pick("duration"));
    if (duration === null && end !== null) duration = end - start;
    if (end === null && duration !== null) end = start + duration;
    if (end === null) end = start;
    if (end < start) end = start;
    return { start, end, duration: Math.max(0, end - start) };
  }

  const points = timePoints(clip);
  const bounds = readerBounds(reader, projectFps);
  const timeObject = isRecord(clip.time) ? clip.time : {};

  if (points && points.length > 1) {
    const maxFrames = timeCurveLengthFrames(points) ?? bounds.frames;
    const clamped = bounds.frames ? clampTimePoints(points, bounds.frames) : undefined;
    let maxDuration: number | null = null;
    if (maxFrames) maxDuration = maxFrames / rate;
    else if (bounds.duration !== null) maxDuration = bounds.duration;
    let start = toFloat(pick("start"));
    if (start === null || start < 0) start = 0;
    if (maxDuration !== null && start > maxDuration) start = maxDuration;
    const end = toFloat(pick("end")) ?? start;
    const duration = toFloat(pick("duration")) ?? Math.max(0, end - start);
    const result: ClipTiming = { start, end, duration };
    if (clamped) result.time = { ...timeObject, Points: clamped };
    return result;
  }

  const maxDuration = bounds.duration;
  let start = toFloat(pick("start"));
  if (start === null || start < 0) start = 0;
  if (maxDuration !== null && start > maxDuration) start = maxDuration;
  let end = toFloat(pick("end"));
  const duration = toFloat(pick("duration"));
  if (end === null) {
    if (duration !== null) end = start + Math.max(duration, 0);
    else if (maxDuration !== null) end = maxDuration;
    else end = start;
  }
  if (maxDuration !== null && end > maxDuration) end = maxDuration;
  if (end < start) start = end;
  const result: ClipTiming = { start, end, duration: Math.max(0, end - start) };
  if (bounds.frames && points) result.time = { ...timeObject, Points: clampTimePoints(points, bounds.frames) };
  return result;
}

/**
 * The longest a clip can be, seconds and project frames (clip_utils
 * `clip_time_bounds`): the media length, or the time curve's span for
 * remapped clips; still images report their own duration.
 */
export function clipTimeBounds(clip: Data, projectFps: Fraction): { maxDuration: number; maxFrames: number } {
  const reader = isRecord(clip.reader) ? clip.reader : {};
  const rate = projectFps.num / projectFps.den;
  if (isSingleImageMedia(reader) || isSingleImageMedia(clip)) {
    const duration = toFloat(clip.duration) ?? toFloat(reader.duration) ?? 0;
    const maxFrames = duration ? Math.max(1, Math.trunc(pyRound(duration * rate))) : 1;
    return { maxDuration: duration, maxFrames };
  }
  const points = timePoints(clip);
  const bounds = readerBounds(reader, projectFps);
  if (points && points.length > 1) {
    const maxFrames = timeCurveLengthFrames(points) ?? bounds.frames ?? 1;
    return { maxDuration: maxFrames / rate, maxFrames };
  }
  const maxFrames = bounds.frames ?? 1;
  const maxDuration = bounds.duration ?? maxFrames / rate;
  return { maxDuration, maxFrames };
}
