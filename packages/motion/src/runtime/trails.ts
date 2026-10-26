/**
 * Line-trail art: parametric curves (spirals, orbits, Lissajous figures,
 * roses) as polylines, points along them by arc length (path following),
 * and strokes drawn on with a fading tail behind the head.
 */

import type { Point } from "./morph.js";

/** A polyline with its cumulative lengths, for lookups by distance. */
export interface PathLine {
  points: Point[];
  /** lengths[i] = distance from points[0] to points[i]. */
  lengths: number[];
  total: number;
}

export function measure(points: readonly Point[]): PathLine {
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) lengths.push(lengths[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  return { points: [...points], lengths, total: lengths[lengths.length - 1] ?? 0 };
}

function indexAt(path: PathLine, d: number): number {
  let lo = 0;
  let hi = path.lengths.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (path.lengths[mid]! <= d) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The point `u` (0..1) of the way along `path` by length, and the heading there (radians). */
export function pointAlong(path: PathLine, u: number): Point & { angle: number } {
  const n = path.points.length;
  if (n === 0) return { x: 0, y: 0, angle: 0 };
  if (n === 1) return { ...path.points[0]!, angle: 0 };
  const d = Math.min(1, Math.max(0, u)) * path.total;
  const i = Math.min(n - 2, indexAt(path, d));
  const a = path.points[i]!;
  const b = path.points[i + 1]!;
  const seg = path.lengths[i + 1]! - path.lengths[i]!;
  const k = seg > 0 ? (d - path.lengths[i]!) / seg : 0;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

/** The polyline between fractions u0 and u1 of `path` (endpoints interpolated). */
export function slice(path: PathLine, u0: number, u1: number): Point[] {
  const a = Math.min(1, Math.max(0, u0));
  const b = Math.min(1, Math.max(0, u1));
  if (b <= a || path.points.length < 2) return [];
  const out: Point[] = [pointAlong(path, a)];
  const i0 = indexAt(path, a * path.total) + 1;
  const i1 = indexAt(path, b * path.total);
  for (let i = i0; i <= i1; i += 1) out.push(path.points[i]!);
  const end = pointAlong(path, b);
  out.push({ x: end.x, y: end.y });
  return out;
}

export type Curve =
  /** An Archimedean spiral from radius `inner` (fraction) out to 1 over `turns`. */
  | { kind: "spiral"; turns: number; inner: number; rotate: number }
  /** An ellipse (ry = squash) that precesses `precession` turns while circling `turns` times: a rosette. */
  | { kind: "orbit"; turns: number; squash: number; precession: number; rotate: number }
  /** x = sin(a·s + phase), y = sin(b·s). */
  | { kind: "lissajous"; a: number; b: number; phase: number }
  /** A rose r = cos(k·θ). */
  | { kind: "rose"; k: number; turns: number; rotate: number };

/** `samples` + 1 points of `curve`, centred at (cx, cy), radius rx × ry. */
export function sampleCurve(curve: Curve, cx: number, cy: number, rx: number, ry: number, samples = 600): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const s = i / samples;
    let x: number;
    let y: number;
    switch (curve.kind) {
      case "spiral": {
        const a = s * curve.turns * Math.PI * 2 + curve.rotate;
        const r = curve.inner + (1 - curve.inner) * s;
        x = Math.cos(a) * r;
        y = Math.sin(a) * r;
        break;
      }
      case "orbit": {
        const a = s * curve.turns * Math.PI * 2;
        const p = s * curve.precession * Math.PI * 2 + curve.rotate;
        const ex = Math.cos(a);
        const ey = Math.sin(a) * curve.squash;
        x = ex * Math.cos(p) - ey * Math.sin(p);
        y = ex * Math.sin(p) + ey * Math.cos(p);
        break;
      }
      case "lissajous": {
        const a = s * Math.PI * 2;
        x = Math.sin(curve.a * a + curve.phase);
        y = Math.sin(curve.b * a);
        break;
      }
      case "rose": {
        const a = s * curve.turns * Math.PI * 2 + curve.rotate;
        const r = Math.cos(curve.k * (a - curve.rotate));
        x = Math.cos(a) * r;
        y = Math.sin(a) * r;
        break;
      }
    }
    out.push({ x: cx + x * rx, y: cy + y * ry });
  }
  return out;
}

export interface TrailStyle {
  color: string;
  /** Line width at the head, px. */
  width: number;
  /** Tail length as a fraction of the path; Infinity draws everything behind the head (a plain draw-on). */
  tail: number;
  /** Width at the end of the tail, as a fraction of `width` (default 0.2). */
  taper?: number;
  /** Opacity at the head (default 1). */
  opacity?: number;
}

/** Bands a tail is split into: each is one stroke at one opacity and width. */
const BANDS = 24;

/**
 * Stroke `path` up to `head` (0..1) with a tail that fades and thins away
 * from the head. Draws nothing before the head starts (head ≤ 0).
 */
export function drawTrail(g: CanvasRenderingContext2D, path: PathLine, head: number, style: TrailStyle): void {
  if (head <= 0) return;
  const start = Number.isFinite(style.tail) ? head - style.tail : 0;
  const span = head - start;
  const taper = style.taper ?? 0.2;
  const opacity = style.opacity ?? 1;
  g.save();
  g.strokeStyle = style.color;
  g.lineJoin = "round";
  for (let b = 0; b < BANDS; b += 1) {
    const u0 = start + (span * b) / BANDS;
    const u1 = start + (span * (b + 1)) / BANDS;
    if (u1 <= 0) continue;
    const pts = slice(path, u0, u1);
    if (pts.length < 2) continue;
    // k: 0 at the tail's end, 1 at the head.
    const k = (b + 1) / BANDS;
    g.globalAlpha = opacity * (Number.isFinite(style.tail) ? k * k : 1);
    g.lineWidth = style.width * (Number.isFinite(style.tail) ? taper + (1 - taper) * k : 1);
    // Butt ends where bands meet (round caps would bead where translucent bands overlap); round at the head.
    g.lineCap = b === BANDS - 1 ? "round" : "butt";
    g.beginPath();
    g.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i += 1) g.lineTo(pts[i]!.x, pts[i]!.y);
    g.stroke();
  }
  g.restore();
}
