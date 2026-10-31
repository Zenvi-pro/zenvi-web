/**
 * Region tracking: a point, a box or a planar surface followed frame to
 * frame. Corners inside the region are tracked with pyramidal Lucas-Kanade,
 * kept only when tracking them back lands where they started (forward-backward
 * error, Kalal et al., "Forward-Backward Error", ICPR 2010, the core of
 * OpenCV's MedianFlow tracker), and the region moves by
 *
 * - `similarity`: the median shift, scale and turn of the surviving points
 *   (robust to a few points on the background), for points and boxes;
 * - `affine`: a least-squares affine fit with outliers dropped, for a flat
 *   surface (a screen, a card, a floor patch) seen at a slant.
 *
 * Coordinates are pixels of the working frames; `Track` stores them
 * normalised to the source frame (0-1).
 */

import type { GrayImage } from "./gray.js";
import { goodFeatures, prepareFrame, trackPoints, type Point, type PreparedFrame } from "./klt.js";

export type TrackModel = "similarity" | "affine";

/** Four corners: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

export interface TrackSample {
  /** Source seconds. */
  time: number;
  /** The region, 0-1 of the source frame. */
  quad: Quad;
  /** Too few points survived: the region holds where it was last seen. */
  lost: boolean;
  /** Share of the seeded points that survived, 0..1. */
  score: number;
}

export interface Track {
  model: TrackModel;
  /** Source width / height, to measure angles in pixels. */
  aspect: number;
  /** In time order. */
  samples: TrackSample[];
}

const MAX_POINTS = 90;
/** Fewer surviving points than this and the step is lost. */
const MIN_POINTS = 3;
/** Forward-backward error above this (pixels) always rejects a point. */
const MAX_FB = 2;
/** Largest scale change one step may make: a jump beyond is a mistrack. */
const STEP_SCALE = 1.25;

export function boxQuad(x: number, y: number, w: number, h: number): Quad {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

export function quadCenter(q: readonly Point[]): Point {
  return { x: (q[0]!.x + q[1]!.x + q[2]!.x + q[3]!.x) / 4, y: (q[0]!.y + q[1]!.y + q[2]!.y + q[3]!.y) / 4 };
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function scaleQuad(q: Quad, k: number): Quad {
  const c = quadCenter(q);
  return q.map((p) => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k })) as Quad;
}

/** 2×3 affine [a, b, c, d, e, f]: x' = a·x + b·y + c, y' = d·x + e·y + f. */
export type Affine2 = [number, number, number, number, number, number];

export function applyAffine(m: Affine2, p: Point): Point {
  return { x: m[0] * p.x + m[1] * p.y + m[2], y: m[3] * p.x + m[4] * p.y + m[5] };
}

/** Least-squares affine taking `from` to `to` (at least 3 points not on a line), or null. */
export function fitAffine(from: readonly Point[], to: readonly Point[]): Affine2 | null {
  // Normal equations of [x y 1] · [a b c]ᵀ = x' (and likewise for y'), centred for conditioning.
  const n = from.length;
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (const p of from) {
    mx += p.x / n;
    my += p.y / n;
  }
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sx = 0;
  let sy = 0;
  const rx: [number, number, number] = [0, 0, 0];
  const ry: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < n; i += 1) {
    const x = from[i]!.x - mx;
    const y = from[i]!.y - my;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sx += x;
    sy += y;
    rx[0] += x * to[i]!.x;
    rx[1] += y * to[i]!.x;
    rx[2] += to[i]!.x;
    ry[0] += x * to[i]!.y;
    ry[1] += y * to[i]!.y;
    ry[2] += to[i]!.y;
  }
  const m = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const a = solve3(m, rx);
  const d = solve3(m, ry);
  if (!a || !d) return null;
  // Undo the centring: x' = a0·(x − mx) + a1·(y − my) + a2.
  return [a[0], a[1], a[2] - a[0] * mx - a[1] * my, d[0], d[1], d[2] - d[0] * mx - d[1] * my];
}

function solve3(m: number[][], r: number[]): [number, number, number] | null {
  const det = (q: number[][]) =>
    q[0]![0]! * (q[1]![1]! * q[2]![2]! - q[1]![2]! * q[2]![1]!) - q[0]![1]! * (q[1]![0]! * q[2]![2]! - q[1]![2]! * q[2]![0]!) + q[0]![2]! * (q[1]![0]! * q[2]![1]! - q[1]![1]! * q[2]![0]!);
  const d = det(m);
  const scale = Math.abs(m[0]![0]! * m[1]![1]! * m[2]![2]!);
  if (!(Math.abs(d) > 1e-9 * Math.max(1, scale))) return null;
  const col = (j: number) => m.map((row, i) => row.map((v, k) => (k === j ? r[i]! : v)));
  return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
}

/** Median shift, scale and turn of matched points, applied about the region's centre. */
function similarityStep(quad: Quad, from: Point[], to: Point[]): Quad {
  const dx = median(from.map((p, i) => to[i]!.x - p.x));
  const dy = median(from.map((p, i) => to[i]!.y - p.y));
  const ratios: number[] = [];
  const turns: number[] = [];
  const n = from.length;
  // Every pair for small sets, a fixed stride through pairs for large ones.
  const stride = Math.max(1, Math.floor((n * (n - 1)) / 2 / 400));
  let k = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1, k += 1) {
      if (k % stride) continue;
      const d0 = dist(from[i]!, from[j]!);
      if (d0 < 2) continue;
      ratios.push(dist(to[i]!, to[j]!) / d0);
      const a0 = Math.atan2(from[j]!.y - from[i]!.y, from[j]!.x - from[i]!.x);
      const a1 = Math.atan2(to[j]!.y - to[i]!.y, to[j]!.x - to[i]!.x);
      let turn = a1 - a0;
      while (turn > Math.PI) turn -= 2 * Math.PI;
      while (turn < -Math.PI) turn += 2 * Math.PI;
      turns.push(turn);
    }
  }
  const s = ratios.length ? Math.min(STEP_SCALE, Math.max(1 / STEP_SCALE, median(ratios))) : 1;
  const r = turns.length >= 3 ? median(turns) : 0;
  const c = quadCenter(quad);
  const cos = Math.cos(r) * s;
  const sin = Math.sin(r) * s;
  return quad.map((p) => {
    const x = p.x - c.x;
    const y = p.y - c.y;
    return { x: c.x + dx + cos * x - sin * y, y: c.y + dy + sin * x + cos * y };
  }) as Quad;
}

/** Affine fit with the worst points dropped twice; null when it is degenerate or jumps. */
function affineStep(quad: Quad, from: Point[], to: Point[]): Quad | null {
  let idx = from.map((_, i) => i);
  let m: Affine2 | null = null;
  for (let round = 0; round < 3; round += 1) {
    m = fitAffine(
      idx.map((i) => from[i]!),
      idx.map((i) => to[i]!),
    );
    if (!m) return null;
    const res = idx.map((i) => dist(applyAffine(m!, from[i]!), to[i]!));
    const cut = Math.max(0.75, 2.5 * median(res));
    const kept = idx.filter((_, k) => res[k]! <= cut);
    if (kept.length === idx.length || kept.length < 6) break;
    idx = kept;
  }
  if (!m) return null;
  const det = m[0] * m[4] - m[1] * m[3];
  if (!(det > 1 / STEP_SCALE ** 2 && det < STEP_SCALE ** 2)) return null;
  return quad.map((p) => applyAffine(m!, p)) as Quad;
}

export interface StepResult {
  quad: Quad;
  lost: boolean;
  score: number;
}

/** Follows one region through frames given in order (forwards or backwards in time). */
export class RegionTracker {
  private frame: PreparedFrame;
  private region: Quad;

  constructor(
    first: GrayImage,
    /** Pixels of `first`. */
    region: Quad,
    private readonly model: TrackModel,
  ) {
    this.frame = prepareFrame(first);
    this.region = region;
  }

  get quad(): Quad {
    return this.region;
  }

  step(next: GrayImage): StepResult {
    const to = prepareFrame(next);
    const result = this.match(to);
    this.frame = to;
    if (result) this.region = result.quad;
    return result ?? { quad: this.region, lost: true, score: 0 };
  }

  private seeds(): Point[] {
    const q = this.region;
    const size = Math.sqrt(Math.max(1, dist(q[0], q[1]) * dist(q[1], q[2])));
    const spacing = Math.min(12, Math.max(3, size / 9));
    let pts = goodFeatures(this.frame, q, MAX_POINTS, spacing);
    // A small or flat region (a point on a plain shirt): borrow texture from around it.
    if (pts.length < 8) pts = goodFeatures(this.frame, scaleQuad(q, 1.6), MAX_POINTS, spacing);
    return pts;
  }

  private match(to: PreparedFrame): StepResult | null {
    const seeds = this.seeds();
    if (seeds.length < MIN_POINTS) return null;
    const fwd = trackPoints(this.frame, to, seeds);
    const live = seeds.map((_, i) => i).filter((i) => fwd[i] !== null);
    if (live.length < MIN_POINTS) return null;
    const back = trackPoints(
      to,
      this.frame,
      live.map((i) => fwd[i]!),
      live.map((i) => seeds[i]!),
    );
    const errors = live.map((i, k) => (back[k] ? dist(back[k]!, seeds[i]!) : Infinity));
    const cut = Math.min(MAX_FB, Math.max(0.3, median(errors.filter(Number.isFinite))));
    const good = live.filter((_, k) => errors[k]! <= cut);
    if (good.length < MIN_POINTS) return null;
    const from = good.map((i) => seeds[i]!);
    const moved = good.map((i) => fwd[i]!);
    const quad = (this.model === "affine" && good.length >= 6 ? affineStep(this.region, from, moved) : null) ?? similarityStep(this.region, from, moved);
    return { quad, lost: false, score: good.length / seeds.length };
  }
}

/** The track's region at source second `t` (linear between samples, held past the ends). */
export function trackAt(track: Track, t: number): Quad {
  const s = track.samples;
  if (s.length === 0) throw new Error("trackAt: empty track");
  if (t <= s[0]!.time) return s[0]!.quad;
  if (t >= s[s.length - 1]!.time) return s[s.length - 1]!.quad;
  let lo = 0;
  let hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid]!.time <= t) lo = mid;
    else hi = mid;
  }
  const a = s[lo]!;
  const b = s[hi]!;
  const k = b.time > a.time ? (t - a.time) / (b.time - a.time) : 0;
  return a.quad.map((p, i) => ({ x: p.x + (b.quad[i]!.x - p.x) * k, y: p.y + (b.quad[i]!.y - p.y) * k })) as Quad;
}

/**
 * Smooths every corner over time with a Gaussian-weighted local line fit
 * (sigma in seconds): hand-held jitter and tracker noise go, the subject's
 * own motion stays, and a steady drift is not pulled in at the clip's ends
 * the way a plain moving average would. 0 returns the track unchanged.
 */
export function smoothTrack(track: Track, sigmaSeconds: number): Track {
  if (!(sigmaSeconds > 0) || track.samples.length < 3) return track;
  const s = track.samples;
  const samples = s.map((sample) => {
    let sw = 0;
    let st = 0;
    let stt = 0;
    const sv = new Float64Array(8);
    const stv = new Float64Array(8);
    for (const other of s) {
      const d = (other.time - sample.time) / sigmaSeconds;
      if (Math.abs(d) > 3) continue;
      const w = Math.exp(-0.5 * d * d);
      const t = other.time - sample.time;
      sw += w;
      st += w * t;
      stt += w * t * t;
      other.quad.forEach((p, i) => {
        sv[2 * i]! += w * p.x;
        sv[2 * i + 1]! += w * p.y;
        stv[2 * i]! += w * t * p.x;
        stv[2 * i + 1]! += w * t * p.y;
      });
    }
    // Value of the weighted least-squares line at t = 0 (this sample).
    const det = sw * stt - st * st;
    const at = (k: number) => (Math.abs(det) > 1e-12 * sw * sw ? (stt * sv[k]! - st * stv[k]!) / det : sv[k]! / sw);
    return { ...sample, quad: sample.quad.map((_, i) => ({ x: at(2 * i), y: at(2 * i + 1) })) as Quad };
  });
  return { ...track, samples };
}

/** Width and height of a quad (means of opposite edges) in the units of its points. */
export function quadSize(q: readonly Point[], aspect = 1): { w: number; h: number } {
  const len = (a: Point, b: Point) => Math.hypot((b.x - a.x) * aspect, b.y - a.y);
  return { w: (len(q[0]!, q[1]!) + len(q[3]!, q[2]!)) / 2 / aspect, h: (len(q[0]!, q[3]!) + len(q[1]!, q[2]!)) / 2 };
}

/** Clockwise angle of the quad's top edge, degrees, measured in pixels (`aspect` = width / height). */
export function quadAngle(q: readonly Point[], aspect: number): number {
  return (Math.atan2(q[1]!.y - q[0]!.y, (q[1]!.x - q[0]!.x) * aspect) * 180) / Math.PI;
}
