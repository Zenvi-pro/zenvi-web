/**
 * Immutable keyframe edits. Every function returns a new `Keyframe` and
 * leaves its input untouched; points stay sorted by X with unique X values
 * (the invariant libopenshot's `AddPoint` keeps), so the JSON evaluates the
 * same on the desktop and here.
 *
 * Sources: libopenshot src/KeyFrame.cpp (AddPoint :131-153, ScalePoints
 * :522-533, FlipPoints :536-545, Keyframe(double) :110-113), src/Point.cpp
 * (JsonValue writes handles only for BEZIER); zenvi-core
 * src/windows/views/timeline.py (AddPoint :3608, _remove_keypoints_in_range
 * :3622, _scale_keyframes :1105, _reverse_keyframes :1207),
 * src/windows/models/properties_model.py:960-1003 (edit at a frame),
 * src/classes/keyframe_scaler.py (fps rescale).
 */

import {
  HandleType,
  Interpolation,
  type Coordinate,
  type Keyframe,
  type KeyframePoint,
} from "../model/types.js";
import { pyRound, roundHalfAway } from "../model/rounding.js";
import { DEFAULT_HANDLE_LEFT, DEFAULT_HANDLE_RIGHT, resolvePoints, type KeyframeLike } from "./points.js";

export interface PointOptions {
  handleLeft?: Coordinate;
  handleRight?: Coordinate;
  handleType?: HandleType;
}

/**
 * A point in JSON form, like `Point(x, y, interpolation).JsonValue()`:
 * BEZIER points carry handles (defaults 0.5,1 / 0.5,0) and `handle_type`,
 * other points only `co` and `interpolation`. Values are kept as given
 * (JSON doubles, what the desktop's Python writes).
 */
export function makeKeyframePoint(
  x: number,
  y: number,
  interpolation: Interpolation = Interpolation.BEZIER,
  opts: PointOptions = {},
): KeyframePoint {
  const point: KeyframePoint = { co: { X: x, Y: y }, interpolation };
  if (interpolation === Interpolation.BEZIER) {
    point.handle_left = { ...(opts.handleLeft ?? DEFAULT_HANDLE_LEFT) };
    point.handle_right = { ...(opts.handleRight ?? DEFAULT_HANDLE_RIGHT) };
    point.handle_type = opts.handleType ?? HandleType.AUTO;
  }
  return point;
}

/**
 * `json.loads(openshot.Point(x, y, interpolation).Json())`: like `makeKeyframePoint`
 * but with X and Y narrowed to float, because the Point constructor takes
 * floats. Use it where ported desktop code builds points through openshot.
 */
export function openshotPoint(x: number, y: number, interpolation: Interpolation = Interpolation.BEZIER): KeyframePoint {
  return makeKeyframePoint(Math.fround(x), Math.fround(y), interpolation);
}

/** A keyframe holding one point at X=1 (JSON doubles). Default BEZIER, like libopenshot. */
export function constantKeyframe(value: number, interpolation: Interpolation = Interpolation.BEZIER): Keyframe {
  return { Points: [makeKeyframePoint(1, value, interpolation)] };
}

/**
 * `json.loads(openshot.Keyframe(value).Json())`: one BEZIER point at X=1 with
 * Y narrowed to float. Default clip/effect JSON from libopenshot looks like this.
 */
export function openshotKeyframe(value: number): Keyframe {
  return { Points: [openshotPoint(1, value, Interpolation.BEZIER)] };
}

function pointsOf(kf: KeyframeLike): KeyframePoint[] {
  if (typeof kf === "number") return constantKeyframe(kf, Interpolation.CONSTANT).Points;
  if (typeof kf !== "object" || kf === null || !Array.isArray(kf.Points)) return [];
  return kf.Points as KeyframePoint[];
}

function xOf(point: KeyframePoint): number {
  const x = point?.co?.X;
  return typeof x === "number" && Number.isFinite(x) ? x : 1;
}

function withPoints(kf: KeyframeLike, points: KeyframePoint[]): Keyframe {
  const base = typeof kf === "object" && kf !== null && !Array.isArray(kf) ? (kf as Keyframe) : {};
  return { ...base, Points: points };
}

/** Deep copy of one JSON point. */
function copyPoint(point: KeyframePoint): KeyframePoint {
  return structuredClone(point);
}

/**
 * Normalize a keyframe's JSON the way libopenshot loads it: points sorted by
 * X and duplicate X resolved last-one-wins. Point objects are copied as-is
 * (no defaults are added).
 */
export function normalizeKeyframe(kf: KeyframeLike): Keyframe {
  const out: KeyframePoint[] = [];
  for (const point of pointsOf(kf)) insertSorted(out, copyPoint(point));
  return withPoints(kf, out);
}

function insertSorted(points: KeyframePoint[], point: KeyframePoint): void {
  const x = xOf(point);
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (xOf(points[mid]!) < x) lo = mid + 1;
    else hi = mid;
  }
  if (lo < points.length && xOf(points[lo]!) === x) points[lo] = point;
  else points.splice(lo, 0, point);
}

/** Add `point`, replacing any point at the same X (`Keyframe::AddPoint`). */
export function setKeyframePoint(kf: KeyframeLike, point: KeyframePoint): Keyframe {
  const next = normalizeKeyframe(kf);
  insertSorted(next.Points, copyPoint(point));
  return next;
}

/** Add several points (each replaces a point at its X). */
export function setKeyframePoints(kf: KeyframeLike, points: readonly KeyframePoint[]): Keyframe {
  const next = normalizeKeyframe(kf);
  for (const point of points) insertSorted(next.Points, copyPoint(point));
  return next;
}

/**
 * Set the value at `frame` the way the desktop Properties panel does: update
 * the Y of the point at exactly that X (keeping its interpolation unless
 * `interpolation` is given), or insert a new point with `interpolation`
 * (default LINEAR, properties_model.py:1000).
 */
export function setKeyframeValue(
  kf: KeyframeLike,
  frame: number,
  value: number,
  interpolation?: Interpolation,
): Keyframe {
  const next = normalizeKeyframe(kf);
  const existing = next.Points.find((p) => xOf(p) === frame);
  if (existing) {
    const updated: KeyframePoint = { ...existing, co: { ...existing.co, X: frame, Y: value } };
    if (interpolation !== undefined && interpolation !== existing.interpolation) {
      updated.interpolation = interpolation;
      if (interpolation === Interpolation.BEZIER) {
        updated.handle_left ??= { ...DEFAULT_HANDLE_LEFT };
        updated.handle_right ??= { ...DEFAULT_HANDLE_RIGHT };
        updated.handle_type ??= HandleType.AUTO;
      }
    }
    insertSorted(next.Points, updated);
    return next;
  }
  insertSorted(next.Points, makeKeyframePoint(frame, value, interpolation ?? Interpolation.LINEAR));
  return next;
}

/** Remove the point(s) at exactly X = `frame`. */
export function removeKeyframePoint(kf: KeyframeLike, frame: number): Keyframe {
  return withPoints(kf, normalizeKeyframe(kf).Points.filter((p) => xOf(p) !== frame));
}

/** Remove every point with `from <= X <= to` (timeline.py `_remove_keypoints_in_range`). */
export function removeKeyframePointsInRange(kf: KeyframeLike, from: number, to: number): Keyframe {
  return withPoints(
    kf,
    normalizeKeyframe(kf).Points.filter((p) => {
      const x = xOf(p);
      return !(from <= x && x <= to);
    }),
  );
}

/** Keep only points with `from <= X <= to`. */
export function keepKeyframePointsInRange(kf: KeyframeLike, from: number, to: number): Keyframe {
  return withPoints(
    kf,
    normalizeKeyframe(kf).Points.filter((p) => {
      const x = xOf(p);
      return from <= x && x <= to;
    }),
  );
}

/** Move every point by `deltaFrames` along X. */
export function shiftKeyframe(kf: KeyframeLike, deltaFrames: number): Keyframe {
  return withPoints(
    kf,
    normalizeKeyframe(kf).Points.map((p) => ({ ...p, co: { ...p.co, X: xOf(p) + deltaFrames } })),
  );
}

export type ScaleRule =
  /** libopenshot `ScalePoints`: X = round(X·factor) half away from zero, first point unchanged. */
  | "libopenshot"
  /** zenvi-core `_scale_keyframes`: X = round((X-1)·factor)+1 (Python rounding), X=1 unchanged. */
  | "desktop"
  /** zenvi-core `KeyframeScaler` (fps change): X = round(X·factor) (Python rounding), X=1 unchanged. */
  | "fps";

/**
 * Stretch a keyframe in time by `factor` (2 = twice as long). `rule` picks
 * which desktop formula to reproduce; default `desktop`. Points that land on
 * the same X collapse (last one wins), as libopenshot would load them.
 */
export function scaleKeyframe(kf: KeyframeLike, factor: number, rule: ScaleRule =
  "desktop"): Keyframe {
  const points = normalizeKeyframe(kf).Points;
  const scaled = points.map((p, index) => {
    const x = xOf(p);
    let nx: number;
    if (rule === "libopenshot") nx = index === 0 ? x : roundHalfAway(x * factor);
    else if (rule === "fps") nx = x === 1 ? x : pyRound(x * factor);
    else nx = x === 1 ? x : pyRound((x - 1) * factor) + 1;
    return { ...p, co: { ...p.co, X: nx } };
  });
  const out: KeyframePoint[] = [];
  for (const p of scaled) insertSorted(out, p);
  return withPoints(kf, out);
}

/** Transform every Y (e.g. scale a volume curve). */
export function mapKeyframeValues(kf: KeyframeLike, fn: (y: number, x: number) => number): Keyframe {
  return withPoints(
    kf,
    normalizeKeyframe(kf).Points.map((p) => ({ ...p, co: { ...p.co, Y: fn(p.co.Y, xOf(p)) } })),
  );
}

/** Swap Y values end to end, keeping X (`Keyframe::FlipPoints`). */
export function flipKeyframe(kf: KeyframeLike): Keyframe {
  const points = normalizeKeyframe(kf).Points.map(copyPoint);
  for (let i = 0, j = points.length - 1; i < j; i += 1, j -= 1) {
    const yi = points[i]!.co.Y;
    points[i]!.co.Y = points[j]!.co.Y;
    points[j]!.co.Y = yi;
  }
  return withPoints(kf, points);
}

/**
 * Mirror points in time around `min X + max X`, swapping each point's
 * handles (timeline.py `_reverse_keyframes`, used by Reverse Transition).
 */
export function reverseKeyframe(kf: KeyframeLike): Keyframe {
  const points = normalizeKeyframe(kf).Points;
  if (points.length === 0) return withPoints(kf, []);
  const xs = points.map(xOf);
  const pivot = Math.min(...xs) + Math.max(...xs);
  const out: KeyframePoint[] = [];
  for (const p of points) {
    const copy = copyPoint(p);
    copy.co.X = pivot - xOf(p);
    const hl = copy.handle_left;
    const hr = copy.handle_right;
    delete copy.handle_left;
    delete copy.handle_right;
    if (hr !== undefined) copy.handle_left = hr;
    if (hl !== undefined) copy.handle_right = hl;
    insertSorted(out, copy);
  }
  return withPoints(kf, out);
}

/** True when the keyframe has at most one distinct value (it never animates). */
export function isConstantKeyframe(kf: KeyframeLike): boolean {
  const points = resolvePoints(kf);
  return points.every((p) => p.y === points[0]!.y);
}

/** The single value of a constant keyframe, or null when it animates or is empty. */
export function keyframeConstantValue(kf: KeyframeLike): number | null {
  const points = resolvePoints(kf);
  if (points.length === 0) return null;
  return points.every((p) => p.y === points[0]!.y) ? points[0]!.y : null;
}

/** X of every point in libopenshot order (sorted, duplicates resolved). */
export function keyframeFrames(kf: KeyframeLike): number[] {
  return resolvePoints(kf).map((p) => p.x);
}
