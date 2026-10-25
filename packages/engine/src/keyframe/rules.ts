/**
 * Keyframe rules shared by the clip menus, the Properties panel and the
 * agent tools: which keys each Clip menu > Copy > Keyframes group copies,
 * what a property falls back to when its last keyframe is removed, how far
 * scale and shear may go, and the level a fade aims for.
 *
 * Port of zenvi-core develop 1f80cb3d0 src/classes/keyframe_rules.py, plus
 * `_base.keyframe_point` (the point the editor tools write).
 */

import { Interpolation, type KeyframePoint } from "../model/types.js";
import { pyRound } from "../model/rounding.js";
import { evaluateAtX } from "./evaluate.js";

/**
 * Clip menu > Copy > Keyframes groups, in menu order. Scale, Rotation and
 * Location carry gravity with them because those values are relative to it.
 */
export const COPY_KEYFRAME_GROUPS = {
  all: ["alpha", "gravity", "scale_x", "scale_y", "shear_x", "shear_y", "rotation", "location_x", "location_y", "time", "volume"],
  alpha: ["alpha"],
  scale: ["gravity", "scale_x", "scale_y"],
  shear: ["shear_x", "shear_y"],
  rotation: ["gravity", "rotation"],
  location: ["gravity", "location_x", "location_y"],
  time: ["time"],
  volume: ["volume"],
} as const satisfies Record<string, readonly string[]>;

export type CopyKeyframeGroup = keyof typeof COPY_KEYFRAME_GROUPS;

/** What the Properties panel writes when the last point of a curve is removed. */
const EMPTY_CURVE_DEFAULTS: Readonly<Record<string, number>> = {
  alpha: 1.0,
  scale_x: 1.0,
  scale_y: 1.0,
  time: 1.0,
  volume: 1.0,
  origin_x: 0.5,
  origin_y: 0.5,
  location_x: 0.0,
  location_y: 0.0,
  rotation: 0.0,
  shear_x: 0.0,
  shear_y: 0.0,
  has_audio: -1.0,
  has_video: -1.0,
  channel_filter: -1.0,
  channel_mapping: -1.0,
};
const WAVE_COLOR_DEFAULTS: Readonly<Record<string, number>> = { red: 0.0, green: 123.0, blue: 255.0, alpha: 255.0 };

/**
 * The value a clip property falls back to once its last keyframe is removed
 * (undefined = no default). `channel` names a colour property's curve.
 */
export function defaultKeyframeValue(key: string, channel?: string): number | undefined {
  if (key === "wave_color") return WAVE_COLOR_DEFAULTS[String(channel ?? "")];
  if (channel) return undefined;
  return EMPTY_CURVE_DEFAULTS[key];
}

/**
 * Largest |scale_x|, |scale_y|, |shear_x|, |shear_y| the Properties panel
 * accepts: 50x (15x for SVG titles), tightened for large project sizes so a
 * huge value cannot make the renderer allocate an enormous frame.
 */
export function maxTransformMultiple(projectWidth: unknown, projectHeight: unknown, isSvg = false): number {
  let multiple = isSvg ? 15 : 50;
  const width = Number(projectWidth) || 0;
  const height = Number(projectHeight) || 0;
  if (width > 0 && height > 0) multiple = pyRound((2000 * multiple) / Math.max(width, height));
  return multiple;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The points of a keyframe JSON (objects with a `co`), sorted by X (stable). */
export function curvePoints(curve: unknown): KeyframePoint[] {
  const points = isRecord(curve) && Array.isArray(curve.Points) ? curve.Points : [];
  const valid = points.filter((p): p is KeyframePoint => isRecord(p) && isRecord(p.co));
  return valid
    .map((point, index) => ({ point, index }))
    .sort((a, b) => pointX(a.point) - pointX(b.point) || a.index - b.index)
    .map((entry) => entry.point);
}

/** A point's X as Python's `float(p["co"].get("X", 0))` reads it. */
export function pointX(point: KeyframePoint): number {
  return Number(point.co?.X ?? 0);
}

/** A point's Y (`float(p["co"].get("Y", 0))`). */
export function pointY(point: KeyframePoint): number {
  return Number(point.co?.Y ?? 0);
}

/**
 * The value of a keyframe JSON at a 1-based clip frame, exactly as
 * libopenshot plays it (keyframe_rules.keyframe_value). A plain number is a
 * static value; a curve without points is `fallback`. The frame is not
 * truncated, so a fractional X reads between frames like the desktop's.
 */
export function keyframeValue(curve: unknown, frame: number, fallback = 0): number {
  if (typeof curve === "number") return curve;
  const points = curvePoints(curve);
  if (points.length === 0) return fallback;
  return evaluateAtX({ Points: points }, frame);
}

/**
 * The level a clip otherwise plays a curve at: its highest value across the
 * visible frames (keyframe_rules.curve_plateau). Fades aim for it, so
 * re-applying a fade over an existing one restores the clip's normal level
 * instead of a value read part-way through the old ramp.
 */
export function curvePlateau(curve: unknown, firstFrame: number, lastFrame: number, fallback = 1.0): number {
  const values = [keyframeValue(curve, firstFrame, fallback), keyframeValue(curve, lastFrame, fallback)];
  for (const point of curvePoints(curve)) {
    const x = pointX(point);
    if (firstFrame <= x && x <= lastFrame) values.push(pointY(point));
  }
  return Math.max(...values);
}

/**
 * The point the editor tools write (`_base.keyframe_point`): every
 * interpolation carries the default handles, like the desktop's JSON.
 */
export function editorPoint(frame: number, value: number, interpolation: Interpolation = Interpolation.BEZIER): KeyframePoint {
  return {
    co: { X: frame, Y: value },
    interpolation,
    handle_type: 0,
    handle_left: { X: 0.5, Y: 1.0 },
    handle_right: { X: 0.5, Y: 0.0 },
  };
}
