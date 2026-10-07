/**
 * Keyframe points as libopenshot sees them after `Keyframe::SetJsonValue`.
 *
 * Ported from libopenshot src/KeyFrame.cpp:372-396 (`SetJsonValue`),
 * :131-153 (`AddPoint`), src/Point.cpp:20-50 and :108-120 (defaults and
 * `SetJsonValue`), src/Coordinate.cpp (`SetJsonValue`).
 */

import { HandleType, Interpolation, type Coordinate, type Keyframe, type KeyframePoint } from "../model/types.js";

/** A point with every field resolved (libopenshot `Point` after SetJsonValue). */
export interface ResolvedPoint {
  x: number;
  y: number;
  interpolation: number;
  handleType: number;
  /** Left handle, fractions of the segment from the left point (default 0.5, 1). */
  leftX: number;
  leftY: number;
  /** Right handle (default 0.5, 0). */
  rightX: number;
  rightY: number;
}

/**
 * Anything a keyframed property can hold in project JSON: a keyframe object,
 * a bare number (libopenshot turns it into one CONSTANT point at X=1), or
 * nothing (an empty keyframe, value 0).
 */
export type KeyframeLike = Keyframe | { Points?: unknown } | number | null | undefined;

/** libopenshot `Point()` defaults (Point.cpp:20, :45-50). */
export const DEFAULT_HANDLE_LEFT: Readonly<Coordinate> = Object.freeze({ X: 0.5, Y: 1.0 });
export const DEFAULT_HANDLE_RIGHT: Readonly<Coordinate> = Object.freeze({ X: 0.5, Y: 0.0 });

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolve one JSON point like `Point::SetJsonValue` over a default `Point()`. */
export function resolvePoint(raw: unknown): ResolvedPoint {
  const p = isRecord(raw) ? raw : {};
  const co = isRecord(p.co) ? p.co : {};
  const hl = isRecord(p.handle_left) ? p.handle_left : {};
  const hr = isRecord(p.handle_right) ? p.handle_right : {};
  return {
    x: num(co.X) ?? 1,
    y: num(co.Y) ?? 0,
    // jsoncpp asInt() truncates a double.
    interpolation: Math.trunc(num(p.interpolation) ?? Interpolation.BEZIER),
    handleType: Math.trunc(num(p.handle_type) ?? HandleType.AUTO),
    leftX: num(hl.X) ?? DEFAULT_HANDLE_LEFT.X,
    leftY: num(hl.Y) ?? DEFAULT_HANDLE_LEFT.Y,
    rightX: num(hr.X) ?? DEFAULT_HANDLE_RIGHT.X,
    rightY: num(hr.Y) ?? DEFAULT_HANDLE_RIGHT.Y,
  };
}

/** Index of the first point with `x >= target` (std::lower_bound with IsPointBeforeX). */
export function lowerBound(points: readonly { x: number }[], target: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid]!.x < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Insert `point` keeping points sorted by X; a point with the same X replaces
 * the old one (`Keyframe::AddPoint`). Mutates `points`.
 */
export function addResolvedPoint(points: ResolvedPoint[], point: ResolvedPoint): void {
  const at = lowerBound(points, point.x);
  if (at < points.length && points[at]!.x === point.x) points[at] = point;
  else points.splice(at, 0, point);
}

/**
 * The points libopenshot would hold after loading `kf`: resolved, sorted by
 * X, duplicate X resolved last-one-wins. A bare number becomes one CONSTANT
 * point at X=1 whose Y is narrowed to float (`Point(float y)`).
 */
export function resolvePoints(kf: KeyframeLike): ResolvedPoint[] {
  if (typeof kf === "number") {
    if (!Number.isFinite(kf)) return [];
    return [
      {
        x: 1,
        y: Math.fround(kf),
        interpolation: Interpolation.CONSTANT,
        handleType: HandleType.AUTO,
        leftX: DEFAULT_HANDLE_LEFT.X,
        leftY: DEFAULT_HANDLE_LEFT.Y,
        rightX: DEFAULT_HANDLE_RIGHT.X,
        rightY: DEFAULT_HANDLE_RIGHT.Y,
      },
    ];
  }
  if (!isRecord(kf) || !Array.isArray(kf.Points)) return [];
  const raw = kf.Points as unknown[];
  const out: ResolvedPoint[] = [];
  let sorted = true;
  for (const item of raw) {
    const p = resolvePoint(item);
    const last = out[out.length - 1];
    if (sorted && (last === undefined || last.x < p.x)) out.push(p);
    else {
      sorted = false;
      addResolvedPoint(out, p);
    }
  }
  return out;
}

/** Serialize a resolved point like `Point::JsonValue` (handles only for BEZIER). */
export function pointToJson(p: ResolvedPoint): KeyframePoint {
  const json: KeyframePoint = { co: { X: p.x, Y: p.y }, interpolation: p.interpolation as Interpolation };
  if (p.interpolation === Interpolation.BEZIER) {
    json.handle_left = { X: p.leftX, Y: p.leftY };
    json.handle_right = { X: p.rightX, Y: p.rightY };
    json.handle_type = p.handleType as HandleType;
  }
  return json;
}
