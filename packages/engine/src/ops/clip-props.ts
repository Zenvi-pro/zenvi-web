/**
 * Clip property edits behind the clip-props tools (set_clip_properties_tool,
 * remove_keyframes_tool, copy_clip_keyframes_tool): a static value or one
 * keyframe on a curve, removing keyframes (a curve that loses its last point
 * falls back to the Properties panel's default), and mapping a curve's
 * keyframes from one clip onto another.
 *
 * Port of zenvi-core develop 1f80cb3d0 src/classes/editor_tools/clip_props.py
 * (`_set_curve_value`, `_without_points`, `_retime_points`,
 * `save_clip_values`). Curves are keyframe JSON; every function returns new
 * objects and leaves its input untouched.
 */

import type { Transaction } from "../history/document.js";
import { COLOR_CHANNELS } from "../keyframe/color.js";
import { curvePoints, defaultKeyframeValue, editorPoint, keyframeValue, pointX, pointY } from "../keyframe/rules.js";
import { pyRound } from "../model/rounding.js";
import { Interpolation, type Clip, type KeyframePoint } from "../model/types.js";
import { patchClip, requireEditableClip, sameJson } from "./internal.js";

export interface CurveEdit {
  /** The curve after the edit (the input itself when nothing changed). */
  curve: unknown;
  /** Points a static value replaced (an animation flattened), else 0. */
  flattened: number;
  changed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON equality (key order ignored, 1 == 1.0), like Python's `==` on project data. */
export function sameValue(a: unknown, b: unknown): boolean {
  return sameJson(a, b);
}

function sortByX(points: KeyframePoint[]): KeyframePoint[] {
  return points
    .map((point, index) => ({ point, index }))
    .sort((a, b) => pointX(a.point) - pointX(b.point) || a.index - b.index)
    .map((entry) => entry.point);
}

/**
 * `_set_curve_value` for a number: with `frame` null the curve becomes one
 * static point at X=1 (a curve with several points is flattened); with a
 * frame, the point there gets the value or a new point is added there.
 * Choice properties write CONSTANT points, the rest BEZIER.
 */
export function setCurveValue(curve: unknown, value: number, frame: number | null, interpolation: Interpolation): CurveEdit {
  const points = curvePoints(curve);
  if (frame === null) {
    const flattened = points.length > 1 ? points.length : 0;
    if (points.length === 1 && pointY(points[0]!) === value) return { curve, flattened: 0, changed: false };
    const next = { Points: [editorPoint(1, value, interpolation)] };
    return { curve: next, flattened, changed: !sameJson(next, curve) };
  }
  const kept = structuredClone(points);
  for (const point of kept) {
    if (pointX(point) === frame) {
      if (pointY(point) === value) return { curve, flattened: 0, changed: false };
      point.co.Y = value;
      const next = { Points: kept };
      return { curve: next, flattened: 0, changed: !sameJson(next, curve) };
    }
  }
  kept.push(editorPoint(frame, value, interpolation));
  const next = { Points: sortByX(kept) };
  return { curve: next, flattened: 0, changed: !sameJson(next, curve) };
}

/** `_set_curve_value` for a colour: every channel gets its value (BEZIER points). */
export function setColorCurveValue(curve: unknown, rgba: readonly number[], frame: number | null): CurveEdit {
  const base = isRecord(curve) ? curve : {};
  const out: Record<string, unknown> = {};
  let flattened = 0;
  COLOR_CHANNELS.forEach((channel, i) => {
    const edit = setCurveValue(base[channel], Number(rgba[i]), frame, Interpolation.BEZIER);
    out[channel] = edit.curve;
    flattened = Math.max(flattened, edit.flattened);
  });
  return { curve: out, flattened, changed: !sameJson(out, curve) };
}

export interface PointRemoval {
  curve: { Points: KeyframePoint[] };
  removed: number;
  /** The value a curve that lost its last point now holds. */
  resetTo?: number;
}

/**
 * `_without_points`: the curve without its points in [lo, hi] (frames;
 * either end open). A curve left empty holds the Properties panel's default
 * for the property (or its first value when it has none). A lone point that
 * already is the default is a static value, not animation: nothing to remove.
 */
export function curveWithoutPoints(curve: unknown, lo: number | null, hi: number | null, key: string, channel?: string): PointRemoval {
  const points = structuredClone(curvePoints(curve));
  const inRange = (p: KeyframePoint): boolean => (lo === null || pointX(p) >= lo) && (hi === null || pointX(p) <= hi);
  let keep = points.filter((p) => !inRange(p));
  const removed = points.length - keep.length;
  if (removed && points.length === 1 && lo === null && hi === null) {
    const fallback = defaultKeyframeValue(key, channel);
    if (fallback !== undefined && pointY(points[0]!) === fallback) return { curve: { Points: points }, removed: 0 };
  }
  let resetTo: number | undefined;
  if (removed && keep.length === 0) {
    resetTo = defaultKeyframeValue(key, channel) ?? pointY(points[0]!);
    keep = [editorPoint(1, resetTo, Interpolation.BEZIER)];
  }
  return resetTo === undefined ? { curve: { Points: keep }, removed } : { curve: { Points: keep }, removed, resetTo };
}

/** A clip's visible frames: X of its first frame and of its end. */
export interface FrameSpan {
  first: number;
  end: number;
}

export type RetimeMode = "stretch" | "offset" | "exact";

/**
 * `_retime_points`: map keyframe X from the source clip's frames onto the
 * target's. `exact` keeps the frames (the editor's paste); `offset` keeps
 * the distance from each clip's first frame; `stretch` also scales to the
 * target's length. Only the source's visible part is mapped: points outside
 * it are replaced by the curve's exact value at the visible edges, so the
 * default point at X=1 of a trimmed clip cannot land on the target's first
 * frame and override the start of a fade.
 */
export function retimeCurvePoints(points: unknown, src: FrameSpan, dst: FrameSpan, timing: RetimeMode): KeyframePoint[] {
  const pts = structuredClone(curvePoints({ Points: Array.isArray(points) ? points : [] }));
  if (timing === "exact" || pts.length <= 1) return pts;
  const { first: s0, end: e0 } = src;
  const { first: s1, end: e1 } = dst;
  const inside = pts.filter((p) => s0 <= pointX(p) && pointX(p) <= e0);
  const curve = { Points: pts };
  const xs = new Set(inside.map(pointX));
  if (!xs.has(s0) && pointX(pts[0]!) < s0) inside.unshift(editorPoint(s0, keyframeValue(curve, s0), Interpolation.BEZIER));
  if (!xs.has(e0) && pointX(pts[pts.length - 1]!) > e0) {
    const last = pts[pts.length - 1]!;
    inside.push(editorPoint(e0, keyframeValue(curve, e0), Math.trunc(Number(last.interpolation ?? Interpolation.BEZIER)) as Interpolation));
  }
  const scale = timing === "stretch" && e0 > s0 ? (e1 - s1) / (e0 - s0) : 1.0;
  const out: KeyframePoint[] = [];
  for (const point of inside) {
    const x = Math.max(1, pyRound(s1 + (pointX(point) - s0) * scale));
    point.co.X = x;
    const previous = out[out.length - 1];
    if (previous && pointX(previous) === x) {
      // The first point at the target's start is the start of the move.
      if (x === s1) continue;
      out[out.length - 1] = point;
      continue;
    }
    out.push(point);
  }
  return out;
}

/** `save_clip_values`: a partial update of one clip (keeps reader, effects and metadata). */
export function updateClipValues(tx: Transaction, clipId: string, values: Record<string, unknown>): Clip {
  requireEditableClip(tx.project, clipId);
  return patchClip(tx, clipId, values);
}
