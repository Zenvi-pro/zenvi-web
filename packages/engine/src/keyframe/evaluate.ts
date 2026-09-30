/**
 * Keyframe evaluation, exactly like libopenshot 1.0 `Keyframe`.
 *
 * Ported from libopenshot src/KeyFrame.cpp:36-95 (linear/bezier/constant
 * interpolation), :258-289 (GetValue/GetInt/GetLong), :292-329
 * (IsIncreasing), :399-421 (GetDelta/GetLength), :245-255 (GetMaxPoint).
 * Spec: docs/specs/libopenshot-semantics.md §1.
 */

import { Interpolation } from "../model/types.js";
import { fma } from "../model/fma.js";
import { roundHalfAway, truncInt } from "../model/rounding.js";
import { lowerBound, resolvePoints, type KeyframeLike, type ResolvedPoint } from "./points.js";

/** Bezier X tolerance libopenshot passes to InterpolateBetween (KeyFrame.cpp:278). */
export const BEZIER_ALLOWED_ERROR = 0.01;

/**
 * The C++ bisection has no iteration cap and can spin forever on handles
 * that make X non-monotonic. After ~55 halvings `t` can no longer change, so
 * 100 iterations never cut short a solve the C++ would finish.
 */
export const BEZIER_MAX_ITERATIONS = 100;

// The reference build fuses `a * b + c` into fmadd (disassembly of
// InterpolateLinearCurve / InterpolateBezierCurve); `fma` reproduces it.

function linear(left: ResolvedPoint, right: ResolvedPoint, target: number): number {
  const diffY = right.y - left.y;
  const diffX = right.x - left.x;
  const slope = diffY / diffX;
  return fma(slope, target - left.x, left.y);
}

function bezier(left: ResolvedPoint, right: ResolvedPoint, target: number, allowedError: number): number {
  const xDiff = right.x - left.x;
  const yDiff = right.y - left.y;
  const p0x = left.x;
  const p0y = left.y;
  const p1x = fma(left.rightX, xDiff, p0x);
  const p1y = fma(left.rightY, yDiff, p0y);
  const p2x = fma(right.leftX, xDiff, p0x);
  const p2y = fma(right.leftY, yDiff, p0y);
  const p3x = right.x;
  const p3y = right.y;

  let t = 0.5;
  let tStep = 0.25;
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0;
  for (let iteration = 0; iteration < BEZIER_MAX_ITERATIONS; iteration += 1) {
    // Bernstein weights {(1-t)^3, 3t(1-t)^2, 3t^2(1-t), t^3}, multiplied in
    // the same order as the C++ loops so every product rounds the same way.
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    b1 = t * 3 * uu;
    b2 = tt * 3 * u;
    b3 = tt * t;
    b0 = uu * u;
    const x = fma(p3x, b3, fma(p2x, b2, fma(p0x, b0, p1x * b1)));
    if (Math.abs(target - x) < allowedError) break;
    if (x > target) t -= tStep;
    else t += tStep;
    tStep /= 2;
  }
  return fma(p3y, b3, fma(p2y, b2, fma(p0y, b0, p1y * b1)));
}

/**
 * Interpolate between two points using the right point's interpolation
 * (`InterpolateBetween`). Targets outside the pair clamp to the nearer point.
 */
export function interpolateBetween(
  left: ResolvedPoint,
  right: ResolvedPoint,
  target: number,
  allowedError: number = BEZIER_ALLOWED_ERROR,
): number {
  if (left.x > target) return left.y;
  if (target > right.x) return right.y;
  switch (right.interpolation) {
    case Interpolation.CONSTANT:
      return left.y;
    case Interpolation.LINEAR:
      return linear(left, right, target);
    case Interpolation.BEZIER:
      return bezier(left, right, target, allowedError);
    default:
      return linear(left, right, target);
  }
}

/** Value at a (possibly fractional) X over already-resolved points. */
export function valueAtResolved(points: readonly ResolvedPoint[], x: number): number {
  if (points.length === 0) return 0;
  const at = lowerBound(points, x);
  if (at === points.length) return points[points.length - 1]!.y;
  if (at === 0) return points[0]!.y;
  const candidate = points[at]!;
  if (candidate.x === x) return candidate.y;
  return interpolateBetween(points[at - 1]!, candidate, x);
}

function lengthOf(points: readonly ResolvedPoint[]): number {
  if (points.length === 0) return 0;
  if (points.length === 1) return 1;
  return roundHalfAway(points[points.length - 1]!.x);
}

/**
 * A keyframe prepared for many evaluations (sorting and defaults resolved
 * once). Frame arguments are integers; fractional frames are truncated like
 * the C++ `int64_t` parameters.
 */
export class CompiledKeyframe {
  readonly points: readonly ResolvedPoint[];

  constructor(kf: KeyframeLike) {
    this.points = resolvePoints(kf);
  }

  /** `GetValue(frame)`. */
  value(frame: number): number {
    return valueAtResolved(this.points, truncInt(frame));
  }

  /** `GetInt(frame)`: `int(round(GetValue(frame)))`, halves away from zero. */
  int(frame: number): number {
    return truncInt(roundHalfAway(this.value(frame)));
  }

  /** `GetLong(frame)`. */
  long(frame: number): number {
    return truncInt(roundHalfAway(this.value(frame)));
  }

  /** `GetLength()`: 0, 1, or round(last X). */
  get length(): number {
    return lengthOf(this.points);
  }

  /** `GetCount()`. */
  get count(): number {
    return this.points.length;
  }

  /**
   * `GetDelta(frame)`: 0 before frame 1, the first point's Y at frame 1,
   * 1.0 past the end, otherwise value(frame) - value(frame - 1).
   */
  delta(frame: number): number {
    const index = truncInt(frame);
    if (index < 1) return 0.0;
    if (index === 1 && this.points.length > 0) return this.points[0]!.y;
    if (index > this.length) return 1.0;
    return this.value(index) - this.value(index - 1);
  }

  /** `IsIncreasing(frame)`: direction of the next significant change (within 599 frames). */
  isIncreasing(frame: number): boolean {
    let index = truncInt(frame);
    const length = this.length;
    if (index <= 1) index = 1;
    else if (index >= length) index = length - 1;
    const current = this.value(index);
    for (let attempts = 1; attempts < 600 && index + attempts <= length; attempts += 1) {
      const diff = this.value(index + attempts) - current;
      if (Math.abs(diff) > 0.0001) return diff >= 0.0;
    }
    return true;
  }

  /** `GetMaxPoint()`: the last point with the largest Y, or null when empty. */
  maxPoint(): ResolvedPoint | null {
    // libopenshot starts from Point(-1, -1), so points with Y < -1 never win.
    let best: ResolvedPoint | null = null;
    let bestY = -1;
    for (const p of this.points) {
      if (p.y >= bestY) {
        best = p;
        bestY = p.y;
      }
    }
    return best;
  }
}

/** Prepare a keyframe for repeated evaluation. */
export function compileKeyframe(kf: KeyframeLike): CompiledKeyframe {
  return new CompiledKeyframe(kf);
}

/**
 * libopenshot `Keyframe::GetValue(frame)`. `kf` may be a keyframe object, a
 * bare number, or absent: an absent property returns `fallback` (the owning
 * object's default, e.g. 1 for a clip's `alpha`), an empty keyframe returns 0.
 */
export function evaluate(kf: KeyframeLike, frame: number, fallback?: number): number {
  if ((kf === undefined || kf === null) && fallback !== undefined) return fallback;
  return valueAtResolved(resolvePoints(kf), truncInt(frame));
}

/** Evaluate at a fractional X (curve drawing). Same math as `evaluate`, no truncation. */
export function evaluateAtX(kf: KeyframeLike, x: number): number {
  return valueAtResolved(resolvePoints(kf), x);
}

/** libopenshot `GetInt(frame)`. */
export function getInt(kf: KeyframeLike, frame: number, fallback?: number): number {
  return truncInt(roundHalfAway(evaluate(kf, frame, fallback)));
}

/** libopenshot `GetLong(frame)`. */
export function getLong(kf: KeyframeLike, frame: number, fallback?: number): number {
  return truncInt(roundHalfAway(evaluate(kf, frame, fallback)));
}

/** libopenshot `GetDelta(frame)`. */
export function getDelta(kf: KeyframeLike, frame: number): number {
  return new CompiledKeyframe(kf).delta(frame);
}

/** libopenshot `GetLength()`. */
export function getLength(kf: KeyframeLike): number {
  return lengthOf(resolvePoints(kf));
}

/** libopenshot `GetCount()`. */
export function getCount(kf: KeyframeLike): number {
  return resolvePoints(kf).length;
}

/** libopenshot `IsIncreasing(frame)`. */
export function isIncreasing(kf: KeyframeLike, frame: number): boolean {
  return new CompiledKeyframe(kf).isIncreasing(frame);
}

/** libopenshot `GetMaxPoint()`. */
export function getMaxPoint(kf: KeyframeLike): ResolvedPoint | null {
  return new CompiledKeyframe(kf).maxPoint();
}
