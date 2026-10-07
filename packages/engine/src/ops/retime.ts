/**
 * Clip retiming (speed changes), ported from zenvi-core
 * src/windows/views/retime.py `retime_clip`: the clip's source span is
 * stretched to a new end, every keyframe X (including the `time` curve) is
 * rescaled into the new frame domain, and the `time` curve maps the new
 * timeline frames back onto the original source frames (mirrored for
 * reverse playback). Pure: returns a new clip object.
 */

import type { Clip, Fraction, Keyframe, KeyframePoint } from "../model/types.js";
import { Interpolation } from "../model/types.js";
import { pyRound } from "../model/rounding.js";
import { openshotPoint } from "../keyframe/edit.js";
import { mapKeyframesDeep } from "./internal.js";

interface RetimeMetrics {
  oldEndS: number;
  newDurS: number;
  newEndS: number;
  startX: number;
  newEndX: number;
  scale: number;
}

function metrics(clip: Clip, newEnd: number, rate: number): RetimeMetrics | null {
  const startS = Number(clip.start);
  const oldEndS = Number(clip.end);
  let newDurS = newEnd - startS;
  if (!(newDurS > 0)) return null;
  const newDurFrames = Math.max(1, Math.trunc(pyRound(newDurS * rate)));
  newDurS = newDurFrames / rate;
  const newEndS = startS + newDurS;
  const startX = Math.trunc(pyRound(startS * rate)) + 1;
  const oldEndX = Math.trunc(pyRound(oldEndS * rate));
  const newEndX = startX + newDurFrames;
  const oldLen = Math.max(1, oldEndX - startX);
  const scale = (newEndX - startX) / oldLen;
  return { oldEndS, newDurS, newEndS, startX, newEndX, scale };
}

function scalePoints(kf: Keyframe, m: RetimeMetrics): Keyframe {
  if (!Array.isArray(kf.Points)) return kf;
  return {
    ...kf,
    Points: kf.Points.map((point) => {
      const x = point?.co?.X;
      if (typeof x !== "number" || x < m.startX) return point;
      let nx = Math.trunc(pyRound(m.startX + (x - m.startX) * m.scale));
      if (nx < m.startX) nx = m.startX;
      else if (nx > m.newEndX) nx = m.newEndX;
      return { ...point, co: { ...point.co, X: nx } };
    }),
  };
}

function xOf(p: KeyframePoint): number {
  return typeof p?.co?.X === "number" ? p.co.X : 0;
}

/** retime.py `_reverse_time_points`: mirror X, swap handles, move interpolation with its segment. */
function reverseTimePoints(points: KeyframePoint[]): KeyframePoint[] {
  const xs = points.filter((p) => typeof p?.co?.X === "number").map(xOf);
  if (xs.length === 0) return points;
  const pivot = Math.min(...xs) + Math.max(...xs);
  const orig = [...points].sort((a, b) => xOf(a) - xOf(b));
  const mirrored = orig.map((point) => {
    const copy: KeyframePoint = structuredClone(point);
    if (typeof point?.co?.X === "number") {
      copy.co.X = pivot - point.co.X;
      const hl = copy.handle_left;
      const hr = copy.handle_right;
      delete copy.handle_left;
      delete copy.handle_right;
      if (hr !== undefined) copy.handle_left = hr;
      if (hl !== undefined) copy.handle_right = hl;
    }
    return copy;
  });
  for (let i = 0; i < mirrored.length - 1; i += 1) {
    mirrored[i]!.interpolation = (orig[i + 1]!.interpolation ?? Interpolation.LINEAR) as Interpolation;
  }
  if (mirrored.length > 0) {
    mirrored[mirrored.length - 1]!.interpolation = (orig[orig.length - 1]!.interpolation ?? Interpolation.LINEAR) as Interpolation;
  }
  return mirrored.sort((a, b) => xOf(a) - xOf(b));
}

/** retime.py `_finalize_time_points`: integer, strictly increasing X spanning [startX, newEndX]. */
function finalizeTimePoints(points: KeyframePoint[], startX: number, newEndX: number): KeyframePoint[] {
  if (points.length === 0) return points;
  const sorted = [...points].sort((a, b) => Number(a?.co?.X ?? 0) - Number(b?.co?.X ?? 0));
  const count = sorted.length;
  const lo = Math.trunc(startX);
  const hi = Math.trunc(newEndX);
  const xs = sorted.map((p) => {
    const raw = typeof p?.co?.X === "number" ? p.co.X : lo;
    let x = Math.trunc(pyRound(raw));
    if (x < lo) x = lo;
    else if (x > hi) x = hi;
    return x;
  });
  xs[0] = lo;
  xs[count - 1] = hi;
  for (let i = 1; i < count; i += 1) if (xs[i]! <= xs[i - 1]!) xs[i] = Math.min(hi, xs[i - 1]! + 1);
  for (let i = count - 2; i >= 0; i -= 1) {
    const maxAllowed = hi - (count - i - 1);
    if (xs[i]! > maxAllowed) xs[i] = maxAllowed;
    if (xs[i]! < lo) xs[i] = lo;
    if (i > 0 && xs[i]! <= xs[i - 1]!) xs[i] = Math.min(maxAllowed, xs[i - 1]! + 1);
  }
  xs[0] = lo;
  xs[count - 1] = hi;
  for (let i = 1; i < count; i += 1) if (xs[i]! <= xs[i - 1]!) xs[i] = Math.min(hi, xs[i - 1]! + 1);
  xs[0] = lo;
  xs[count - 1] = hi;
  return sorted.map((p, i) => ({ ...p, co: { ...p.co, X: xs[i]! } }));
}

/**
 * `retime_clip(clip, new_end, new_position, direction)`. Returns the retimed
 * clip, or null when `newEnd` does not leave a positive length.
 */
export function retimeClip(clip: Clip, newEnd: number, fps: Fraction, direction: 1 | -1 = 1, newPosition?: number): Clip | null {
  const rate = fps.num / fps.den;
  const m = metrics(clip, newEnd, rate);
  if (!m) return null;
  const next = mapKeyframesDeep(clip, (kf) => scalePoints(kf, m)) as Clip;

  const timePoints = Array.isArray(next.time?.Points) ? next.time.Points : [];
  let points: KeyframePoint[];
  if (timePoints.length < 2) {
    const y1 = Math.trunc(pyRound(m.oldEndS * rate));
    points = [
      openshotPoint(m.startX, m.startX, Interpolation.LINEAR),
      openshotPoint(m.newEndX, y1, Interpolation.LINEAR),
    ];
  } else {
    points = timePoints.map((p) => structuredClone(p));
  }
  if (direction === -1) points = reverseTimePoints(points);
  points = finalizeTimePoints(points, m.startX, m.newEndX);
  const time: Keyframe = timePoints.length < 2 ? { Points: points } : { ...next.time, Points: points };

  const out: Clip = { ...next, time, duration: m.newDurS, end: m.newEndS };
  if (newPosition !== undefined) out.position = Math.trunc(pyRound(newPosition * rate)) / rate;
  return out;
}
