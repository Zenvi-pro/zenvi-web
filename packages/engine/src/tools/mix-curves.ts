/**
 * Gain shapes on a clip's `volume` keyframe for automate_volume_tool and
 * duck_tool: a list of timeline (seconds, dB) points becomes volume Points
 * at 1-based clip-source frames (the frame mapping of ./audio-mix.ts, which
 * is the desktop's Volume_Triggered), relative to the curve the clip already
 * has or replacing it inside the shape's span. The curve outside the span is
 * untouched. libopenshot interpolates volume linearly in amplitude, and the
 * segment into a point follows that point's interpolation
 * (libopenshot/src/KeyFrame.cpp `InterpolateBetween` reads `right.interpolation`).
 */

import { Interpolation, type KeyframePoint } from "../model/types.js";
import { MAX_LEVEL, clipSourceFrameRange, curvePoints, evaluateVolumeCurve, makePoint, timelineToSourceFrame } from "./audio-mix.js";

export type CurveKind = "linear" | "bezier" | "constant";

export interface GainPoint {
  /** Timeline seconds. */
  t: number;
  db: number;
  /** Shape of the segment into this point. */
  curve?: CurveKind;
}

const INTERPOLATION: Record<CurveKind, KeyframePoint["interpolation"]> = { linear: Interpolation.LINEAR, bezier: Interpolation.BEZIER, constant: Interpolation.CONSTANT };

/** Linear segments longer than this many dB get points every STEP_DB, so a long fade is even in dB rather than in amplitude. */
const STEP_DB = 3;

export interface ShapedCurve {
  points: KeyframePoint[];
  /** Points the 0..MAX_LEVEL volume range clipped. */
  clamped: number;
}

const dbToGain = (db: number): number => (db <= -120 ? 0 : 10 ** (db / 20));

/** Subdivide linear segments into steps of at most STEP_DB (at least one frame apart). */
function densify(points: readonly GainPoint[], fps: number): GainPoint[] {
  const out: GainPoint[] = [];
  points.forEach((p, i) => {
    const prev = points[i - 1];
    if (prev && (p.curve ?? "linear") === "linear") {
      const span = Math.abs(p.db - prev.db);
      const steps = Math.min(Math.floor((p.t - prev.t) * fps), Math.ceil(span / STEP_DB));
      for (let k = 1; k < steps; k += 1) {
        const f = k / steps;
        out.push({ t: prev.t + (p.t - prev.t) * f, db: prev.db + (p.db - prev.db) * f, curve: "linear" });
      }
    }
    out.push(p);
  });
  return out;
}

/**
 * The clip's new volume curve with `shape` applied. relative: the shape's dB
 * multiply the existing curve between its first and last point; absolute:
 * the shape's dB (re unity) replace it there.
 */
export function shapeVolume(clip: unknown, fps: number, shape: readonly GainPoint[], mode: "relative" | "absolute" = "relative"): ShapedCurve {
  const sorted = densify([...shape].sort((a, b) => a.t - b.t), fps);
  if (sorted.length === 0) return { points: curvePoints(clip), clamped: 0 };
  const existing = curvePoints(clip);
  const [first, last] = clipSourceFrameRange(clip, fps);
  const frameOf = (t: number): number => timelineToSourceFrame(t, clip, fps);
  const lo = frameOf(sorted[0]!.t);
  const hi = frameOf(sorted[sorted.length - 1]!.t);
  /** The shape's dB at source frame x: linear in dB between its points. */
  const shapeDb = (x: number): number => {
    const frames = sorted.map((p) => frameOf(p.t));
    if (x <= frames[0]!) return sorted[0]!.db;
    for (let i = 1; i < sorted.length; i += 1) {
      if (x <= frames[i]!) {
        if (sorted[i]!.curve === "constant") return sorted[i - 1]!.db;
        const span = frames[i]! - frames[i - 1]!;
        return span <= 0 ? sorted[i]!.db : sorted[i - 1]!.db + ((sorted[i]!.db - sorted[i - 1]!.db) * (x - frames[i - 1]!)) / span;
      }
    }
    return sorted[sorted.length - 1]!.db;
  };
  const base = (x: number): number => evaluateVolumeCurve(existing, x, 1);
  let clamped = 0;
  const value = (x: number): number => {
    const raw = (mode === "relative" ? base(x) : 1) * dbToGain(shapeDb(x));
    if (raw > MAX_LEVEL + 1e-9) clamped += 1;
    return Math.min(MAX_LEVEL, raw);
  };
  const out = new Map<number, KeyframePoint>();
  for (const p of existing) {
    const x = Math.round(p.co.X);
    if (x < lo || x > hi) out.set(x, p);
  }
  // Anchors just outside the span hold the old curve there.
  if (lo > first && !out.has(lo - 1)) out.set(lo - 1, makePoint(lo - 1, base(lo - 1)));
  if (hi < last && !out.has(hi + 1)) out.set(hi + 1, makePoint(hi + 1, base(hi + 1)));
  for (const p of existing) {
    const x = Math.round(p.co.X);
    if (x >= lo && x <= hi) out.set(x, makePoint(x, value(x), p.interpolation));
  }
  for (const p of sorted) {
    const x = frameOf(p.t);
    out.set(x, makePoint(x, value(x), INTERPOLATION[p.curve ?? "linear"]));
  }
  const points = [...out.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
  return { points, clamped };
}

/** Same curve (frames and values to 1e-6)? */
export function sameCurve(a: readonly KeyframePoint[], b: readonly KeyframePoint[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => Math.round(p.co.X) === Math.round(b[i]!.co.X) && Math.abs(p.co.Y - b[i]!.co.Y) < 1e-6 && p.interpolation === b[i]!.interpolation);
}
