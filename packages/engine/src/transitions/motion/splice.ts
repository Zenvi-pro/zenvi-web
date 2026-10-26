/**
 * Splicing a transition's frames into an existing keyframe curve, and taking
 * them out again.
 *
 * The curve outside the transition window must play exactly as before (a Ken
 * Burns drift keeps drifting up to the whip), so the segment that crosses the
 * window's rest frame is split there: a bezier segment by de Casteljau, so
 * both halves trace the original curve (libopenshot src/KeyFrame.cpp
 * InterpolateBezierCurve uses P1 = P0 + handle_right·Δ, P2 = P0 +
 * handle_left·Δ over the segment's Δx, Δy).
 */

import { makeKeyframePoint } from "../../keyframe/edit.js";
import { evaluate } from "../../keyframe/evaluate.js";
import { HandleType, Interpolation, type Keyframe, type KeyframePoint } from "../../model/types.js";

const xOf = (p: KeyframePoint): number => Number(p.co.X);
const yOf = (p: KeyframePoint): number => Number(p.co.Y);

function pointsOf(kf: Keyframe | undefined | null): KeyframePoint[] {
  const points = Array.isArray(kf?.Points) ? kf.Points : [];
  return points.map((p) => structuredClone(p)).sort((a, b) => xOf(a) - xOf(b));
}

function withPoints(kf: Keyframe | undefined | null, points: KeyframePoint[]): Keyframe {
  return { ...(kf ?? {}), Points: points };
}

/** libopenshot's handle defaults when a BEZIER point has none (Point.cpp). */
function handles(p: KeyframePoint): { lx: number; ly: number; rx: number; ry: number } {
  return {
    lx: Number(p.handle_left?.X ?? 0.5),
    ly: Number(p.handle_left?.Y ?? 1),
    rx: Number(p.handle_right?.X ?? 0.5),
    ry: Number(p.handle_right?.Y ?? 0),
  };
}

/** Normalized handle of a control point inside a segment box; a flat segment keeps any Y (Δy = 0 ignores it). */
function norm(v: number, origin: number, span: number, fallback: number): number {
  return span === 0 ? fallback : (v - origin) / span;
}

/**
 * The curve with a point at frame `x` that keeps every frame's value: inside
 * a segment the segment is split, outside the points the end value is held.
 */
export function splitKeyframeAt(kf: Keyframe | undefined | null, x: number, fallback: number): Keyframe {
  const points = pointsOf(kf);
  if (points.length === 0) return withPoints(kf, [makeKeyframePoint(x, fallback, Interpolation.LINEAR)]);
  if (points.some((p) => xOf(p) === x)) return withPoints(kf, points);
  const right = points.findIndex((p) => xOf(p) > x);
  if (right === 0) return withPoints(kf, [makeKeyframePoint(x, yOf(points[0]!), Interpolation.LINEAR), ...points]);
  if (right === -1) return withPoints(kf, [...points, makeKeyframePoint(x, yOf(points[points.length - 1]!), Interpolation.LINEAR)]);
  const L = points[right - 1]!;
  const R = points[right]!;
  const interpolation = Number(R.interpolation);
  let inserted: KeyframePoint;
  if (interpolation === Interpolation.CONSTANT) {
    inserted = makeKeyframePoint(x, yOf(L), Interpolation.CONSTANT);
  } else if (interpolation !== Interpolation.BEZIER) {
    inserted = makeKeyframePoint(x, yOf(L) + ((yOf(R) - yOf(L)) * (x - xOf(L))) / (xOf(R) - xOf(L)), Interpolation.LINEAR);
  } else {
    const dx = xOf(R) - xOf(L);
    const dy = yOf(R) - yOf(L);
    const h0 = handles(L);
    const h1 = handles(R);
    const P0 = [xOf(L), yOf(L)] as const;
    const P1 = [xOf(L) + h0.rx * dx, yOf(L) + h0.ry * dy] as const;
    const P2 = [xOf(L) + h1.lx * dx, yOf(L) + h1.ly * dy] as const;
    const P3 = [xOf(R), yOf(R)] as const;
    const at = (t: number, i: 0 | 1): number => {
      const u = 1 - t;
      return u * u * u * P0[i] + 3 * u * u * t * P1[i] + 3 * u * t * t * P2[i] + t * t * t * P3[i];
    };
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 80; i += 1) {
      const mid = (lo + hi) / 2;
      if (at(mid, 0) < x) lo = mid;
      else hi = mid;
    }
    const t = (lo + hi) / 2;
    const lerp = (a: readonly number[], b: readonly number[]): [number, number] => [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t];
    const Q0 = lerp(P0, P1);
    const Q1 = lerp(P1, P2);
    const Q2 = lerp(P2, P3);
    const R0 = lerp(Q0, Q1);
    const R1 = lerp(Q1, Q2);
    const S = lerp(R0, R1);
    const y = S[1];
    const leftDx = x - P0[0];
    const leftDy = y - P0[1];
    const rightDx = P3[0] - x;
    const rightDy = P3[1] - y;
    // Hand-set handles: MANUAL so an editor that re-derives AUTO handles leaves the split alone.
    L.handle_right = { X: norm(Q0[0], P0[0], leftDx, 0.5), Y: norm(Q0[1], P0[1], leftDy, 0) };
    L.handle_type = HandleType.MANUAL;
    inserted = makeKeyframePoint(x, y, Interpolation.BEZIER, {
      handleLeft: { X: norm(R0[0], P0[0], leftDx, 0.5), Y: norm(R0[1], P0[1], leftDy, 1) },
      handleRight: { X: norm(R1[0], x, rightDx, 0.5), Y: norm(R1[1], y, rightDy, 0) },
      handleType: HandleType.MANUAL,
    });
    R.handle_left = { X: norm(Q2[0], x, rightDx, 0.5), Y: norm(Q2[1], y, rightDy, 1) };
    R.handle_type = HandleType.MANUAL;
  }
  points.splice(right, 0, inserted);
  return withPoints(kf, points);
}

/**
 * Write `values` at the whole frames `frames` (ascending, consecutive),
 * replacing any points there, after splitting the curve at `rest` (the frame
 * just outside the window where the transition hands back to the curve).
 * LINEAR points: libopenshot reads clip keyframes at whole frames only, so
 * every frame of the window gets exactly its value.
 */
export function spliceFrames(kf: Keyframe | undefined | null, rest: number, frames: readonly number[], values: readonly number[], fallback: number): Keyframe {
  const first = frames[0]!;
  const last = frames[frames.length - 1]!;
  const split = splitKeyframeAt(kf, rest, fallback);
  const kept = split.Points.filter((p) => xOf(p) < first || xOf(p) > last);
  const added = frames.map((x, i) => makeKeyframePoint(x, values[i]!, Interpolation.LINEAR));
  return withPoints(split, [...kept, ...added].sort((a, b) => xOf(a) - xOf(b)));
}

/** The curve's value at whole frame `frame` (`fallback` when there is no curve). */
export function curveValueAt(kf: Keyframe | undefined | null, frame: number, fallback: number): number {
  return pointsOf(kf).length === 0 ? fallback : evaluate(kf as Keyframe, frame);
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Take a transition out of `current`: a three-way merge per point X. Inside
 * the window [lo, hi] the original points come back; outside it a point the
 * transition wrote (still as it wrote it, or deleted since) reverts to the
 * original, and every other point stays as it is now. Unchanged since the transition, this is exactly
 * `before`.
 */
export function unspliceKeyframe(current: Keyframe | undefined | null, before: Keyframe | null, after: Keyframe, lo: number, hi: number): Keyframe | null {
  if (sameJson(current ?? null, after)) return before;
  const at = (points: KeyframePoint[]): Map<number, KeyframePoint> => new Map(points.map((p) => [xOf(p), p]));
  const cur = at(pointsOf(current));
  const aft = at(pointsOf(after));
  const bef = at(pointsOf(before));
  const xs = [...new Set([...cur.keys(), ...aft.keys(), ...bef.keys()])].sort((a, b) => a - b);
  const out: KeyframePoint[] = [];
  for (const x of xs) {
    const c = cur.get(x);
    // Outside the window the transition only owns points it wrote or changed (the split's neighbours, its rest point).
    const owned = !sameJson(aft.get(x) ?? null, bef.get(x) ?? null);
    const reverts = (lo <= x && x <= hi) || (owned && (!c || sameJson(c, aft.get(x))));
    const pick = reverts ? bef.get(x) : c;
    if (pick) out.push(pick);
  }
  if (out.length === 0 && before === null) return null;
  return withPoints(current ?? before, out);
}
