/**
 * Tracks turned into native transform keyframes, so every surface (and the
 * desktop, with no OpenCV data) plays the result:
 *
 * - `pinToTrack`: another clip (a callout, a title, a motion block, a guide)
 *   follows a tracked region of a footage clip, through the footage clip's
 *   own transform; `surface` fits the overlay's frame onto a tracked quad
 *   with scale, rotation and shear (the affine part of a corner pin:
 *   libopenshot 1.0 renders no perspective corners, clip-props-model.ts).
 * - `holdOnTrack`: the footage clip itself counter-moves so the tracked
 *   point stays at one place on the canvas while it zooms (a punch-in, an
 *   anchored slow motion, a vertical reframe), keeping the frame covered.
 *
 * Keyframes are written over the moving clip's visible window, splicing like
 * ops/match-cut.ts (points inside the window are replaced).
 */

import type { Transaction } from "../history/document.js";
import { editorPoint } from "../keyframe/rules.js";
import { clipGeometry, coverScale, scaleAspect, solveLocation, sourceSecondsAt, sourceToCanvas, subjectOnCanvas, type CanvasSubject, type SubjectBox } from "../matchcut/fit.js";
import { Interpolation, type Clip, type Project } from "../model/types.js";
import { clipTransform } from "../render/plan/transform.js";
import type { Point } from "../tracking/klt.js";
import { applyAffine, fitAffine, quadCenter, quadSize, trackAt, type Affine2, type Quad, type Track } from "../tracking/track.js";
import { frameWindow, localFrame, timelineFrameOf } from "../timeline/windows.js";
import { setClipKeyframes } from "./clips.js";
import { invalid } from "./errors.js";
import { fpsOf, requireEditableClip } from "./internal.js";

export type PinFollow = "position" | "position_scale" | "position_scale_rotation" | "surface";

/** Cover a hair more than the exact bound: the decode size rounds to whole pixels. */
const COVER_SLACK = 1.002;

export interface PinInput {
  /** The clip that moves. */
  clipId: string;
  /** The clip whose picture was tracked. */
  footageId: string;
  track: Track;
  follow: PinFollow;
  /** The point of the moving clip's own frame that sits on the track (0-1, default its centre). Not used by `surface`. */
  anchor?: Point;
  /** Added to the tracked point, fractions of the canvas (a label beside the subject). Not used by `surface`. */
  offset?: Point;
  /** Clip frames between keyframes (default 2). */
  step?: number;
}

export interface PinResult {
  clipId: string;
  /** Clip frames that got keyframes. */
  frames: number[];
  /** Where the anchor sits on the canvas at the first and last keyframe, 0-1. */
  first: Point;
  last: Point;
  /** Keyframes whose source time the tracker had lost (held). */
  lostFrames: number;
  /** Keyframes outside the footage clip's window (the track holds its end). */
  outside: number;
}

export interface HoldInput {
  clipId: string;
  track: Track;
  /** Where the tracked point stays, 0-1 of the canvas. Default: where it is drawn on the clip's first frame. */
  target?: Point;
  /**
   * The clip's scale at clip frame `n` (`progress` 0..1 across its window),
   * before the cover zoom. Default: its scale on its first frame.
   */
  scaleAt?: (n: number, progress: number, base: number) => number;
  /** Scale against the subject's size so it stays the same size on screen. */
  keepSize?: boolean;
  /** `zoom` (default): scale up where moving would show the canvas; `none` allows edges. */
  cover?: "zoom" | "none";
  /** The scale is at least the smallest covering scale times this at frame `n` (a reframe's close-up), default 1. */
  coverZoom?: (n: number) => number;
  /** Clip frames between keyframes (default 2). Frames in `extraFrames` are keyed too. */
  step?: number;
  extraFrames?: readonly number[];
}

export interface HoldResult {
  clipId: string;
  frames: number[];
  /** Smallest and largest scale written. */
  scaleRange: [number, number];
  /** Keyframes that needed a cover zoom. */
  coverZoomed: number;
  lostFrames: number;
  target: Point;
}

const linear = (frames: readonly number[], values: readonly number[]) => frames.map((frame, i) => ({ frame, value: values[i]!, interpolation: Interpolation.LINEAR }));

function checkTrack(track: Track): void {
  if (track.samples.length === 0) throw invalid("The track is empty.");
}

function windowFrames(project: Project, clip: Clip, step: number, extra: readonly number[] = []): number[] {
  const w = frameWindow(clip, fpsOf(project));
  if (w.endFrame < w.startFrame) throw invalid(`Clip ${String(clip.id)} is empty.`);
  const first = w.localStartFrame;
  const last = localFrame(w, w.endFrame);
  const set = new Set<number>([first, last]);
  for (let n = first + step; n < last; n += step) set.add(n);
  for (const n of extra) if (n >= first && n <= last) set.add(n);
  return [...set].sort((a, b) => a - b);
}

/** A copy of `clip` whose keyframes `values` are constants (to evaluate a transform at trial values). */
function withConstants(clip: Clip, values: Record<string, number>): Clip {
  const out: Clip = { ...clip };
  for (const [key, value] of Object.entries(values)) (out as Record<string, unknown>)[key] = { Points: [editorPoint(1, value, Interpolation.LINEAR)] };
  return out;
}

/**
 * location_x / location_y that put source point `src` (0-1) of `clip` on
 * canvas pixel `target` at frame `n`, with every other value as keyed.
 * Location is applied first (outermost) in Clip::get_transform and is linear
 * on each side of 0 (SCALE_CROP measures it against the free space on that
 * side), so one trial per axis on the right side solves it.
 */
function locationTo(project: Project, clip: Clip, n: number, src: Point, target: Point): { x: number; y: number } {
  const g = clipGeometry(project, clip, n);
  const fps = fpsOf(project);
  const at = (lx: number, ly: number) => clipTransform(withConstants(clip, { location_x: lx, location_y: ly }), n, g.srcW, g.srcH, g.width, g.height, fps).map(src.x * g.srcW, src.y * g.srcH);
  const [x0, y0] = at(0, 0);
  const dx = target.x - x0;
  const dy = target.y - y0;
  const sx = dx >= 0 ? 1 : -1;
  const sy = dy >= 0 ? 1 : -1;
  const slopeX = Math.abs(at(sx, 0)[0] - x0);
  const slopeY = Math.abs(at(0, sy)[1] - y0);
  return { x: slopeX > 1e-9 ? dx / slopeX : 0, y: slopeY > 1e-9 ? dy / slopeY : 0 };
}

/** The footage clip frame shown at the moving clip's frame `n`, clamped to the footage's window. */
function footageFrameAt(project: Project, mover: Clip, footage: Clip, n: number): { frame: number; outside: boolean } {
  const fps = fpsOf(project);
  const mw = frameWindow(mover, fps);
  const fw = frameWindow(footage, fps);
  const timeline = timelineFrameOf(mw, n);
  const clamped = Math.min(Math.max(timeline, fw.startFrame), fw.endFrame);
  return { frame: localFrame(fw, clamped), outside: clamped !== timeline };
}

const area = (q: readonly [number, number][]) => Math.abs(q.reduce((sum, p, i) => sum + p[0] * q[(i + 1) % q.length]![1] - q[(i + 1) % q.length]![0] * p[1], 0)) / 2;
const angleOf = (q: readonly [number, number][]) => (Math.atan2(q[1]![1] - q[0]![1], q[1]![0] - q[0]![0]) * 180) / Math.PI;

function lostAt(track: Track, t: number): boolean {
  const s = track.samples;
  let best = s[0]!;
  for (const sample of s) if (Math.abs(sample.time - t) < Math.abs(best.time - t)) best = sample;
  return best.lost;
}

/**
 * Scale, rotation and shear of a clip whose source frame (0-1) maps to the
 * canvas by `m`: the linear part of Clip::get_transform is
 * R(r) · Sh(shear_x, 0) · diag(base.w · sx, base.h · sy) (column vectors;
 * QTransform::shear puts shear_x on y in x' = x + shear_x · y), so a QR
 * split of m's linear part gives r from its first column and the rest from
 * the triangle.
 */
export function decomposeAffine(m: Affine2, baseW: number, baseH: number): { scaleX: number; scaleY: number; rotation: number; shearX: number } {
  const [a, b, , c, d] = m;
  const r = Math.atan2(c, a);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const u00 = cos * a + sin * c;
  const u01 = cos * b + sin * d;
  const u11 = -sin * b + cos * d;
  return { scaleX: u00 / baseW, scaleY: u11 / baseH, rotation: (r * 180) / Math.PI, shearX: Math.abs(u11) > 1e-9 ? u01 / u11 : 0 };
}

/** Keyframes on `clipId` so it follows `track` on `footageId`. One op of the caller's transaction. */
export function pinToTrack(tx: Transaction, input: PinInput): PinResult {
  checkTrack(input.track);
  const project = tx.project;
  const mover = requireEditableClip(project, input.clipId);
  const footage = project.clips.find((c) => String(c.id) === input.footageId);
  if (!footage) throw invalid(`Unknown footage clip ${input.footageId}.`);
  if (input.clipId === input.footageId) throw invalid("A clip cannot follow its own track: use the hold reframe instead.");
  if (mover.parentObjectId) throw invalid(`Clip ${input.clipId} follows a parent clip; clear parentObjectId first.`);
  const step = Math.max(1, Math.round(input.step ?? 2));
  const frames = windowFrames(project, mover, step);
  const anchor = input.anchor ?? { x: 0.5, y: 0.5 };
  const offset = input.offset ?? { x: 0, y: 0 };
  const W = Number(project.width) || 1920;
  const H = Number(project.height) || 1080;

  let lostFrames = 0;
  let outside = 0;
  const canvasQuads = frames.map((n) => {
    const at = footageFrameAt(project, mover, footage, n);
    if (at.outside) outside += 1;
    const t = sourceSecondsAt(project, footage, at.frame);
    if (lostAt(input.track, t)) lostFrames += 1;
    const map = sourceToCanvas(project, footage, at.frame);
    return trackAt(input.track, t).map((p) => map(p.x, p.y));
  });
  const ref = canvasQuads[0]!;
  const n0 = frames[0]!;
  const g0 = clipGeometry(project, mover, n0);
  const base = { scale: g0.current.scale, scaleY: g0.current.scaleY, rotation: g0.current.rotation };
  const id = String(mover.id);

  let src: Point = anchor;
  let targets: Point[];
  if (input.follow === "surface") {
    const fits = canvasQuads.map((q) => {
      const m = fitAffine(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
        q.map(([x, y]) => ({ x, y })),
      );
      if (!m) throw invalid("The tracked surface collapsed to a line; track a larger region.");
      return m;
    });
    const parts = fits.map((m) => decomposeAffine(m, g0.baseW, g0.baseH));
    setClipKeyframes(tx, id, "scale_x", linear(frames, parts.map((p) => p.scaleX)), { mode: "replace_range" });
    setClipKeyframes(tx, id, "scale_y", linear(frames, parts.map((p) => p.scaleY)), { mode: "replace_range" });
    setClipKeyframes(tx, id, "rotation", linear(frames, parts.map((p) => p.rotation)), { mode: "replace_range" });
    setClipKeyframes(tx, id, "shear_x", linear(frames, parts.map((p) => p.shearX)), { mode: "replace_range" });
    setClipKeyframes(tx, id, "shear_y", linear(frames, frames.map(() => 0)), { mode: "replace_range" });
    src = { x: 0.5, y: 0.5 };
    targets = fits.map((m) => applyAffine(m, src));
  } else {
    const refArea = Math.max(1e-9, area(ref));
    const refAngle = angleOf(ref);
    if (input.follow !== "position") {
      const ratios = canvasQuads.map((q) => Math.sqrt(area(q) / refArea));
      setClipKeyframes(tx, id, "scale_x", linear(frames, ratios.map((k) => base.scale * k)), { mode: "replace_range" });
      setClipKeyframes(tx, id, "scale_y", linear(frames, ratios.map((k) => base.scaleY * k)), { mode: "replace_range" });
    }
    if (input.follow === "position_scale_rotation") {
      setClipKeyframes(tx, id, "rotation", linear(frames, canvasQuads.map((q) => base.rotation + unwrap(angleOf(q) - refAngle))), { mode: "replace_range" });
    }
    targets = canvasQuads.map((q) => {
      const c = quadCenter(q.map(([x, y]) => ({ x, y })));
      return { x: c.x + offset.x * W, y: c.y + offset.y * H };
    });
  }
  // Location last: the decode size follows the scale curve just written.
  const scaled = tx.project.clips.find((c) => c.id === mover.id)!;
  const locations = frames.map((n, i) => locationTo(tx.project, scaled, n, src, targets[i]!));
  setClipKeyframes(tx, id, "location_x", linear(frames, locations.map((l) => l.x)), { mode: "replace_range" });
  setClipKeyframes(tx, id, "location_y", linear(frames, locations.map((l) => l.y)), { mode: "replace_range" });
  const norm = (p: Point) => ({ x: p.x / W, y: p.y / H });
  return { clipId: id, frames, first: norm(targets[0]!), last: norm(targets[targets.length - 1]!), lostFrames, outside };
}

function unwrap(deg: number): number {
  let d = deg;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/** The track's region at source second `t` as a box (centre and size kept; angle dropped). */
function boxOf(track: Track, t: number): SubjectBox {
  const q: Quad = trackAt(track, t);
  const c = quadCenter(q);
  const s = quadSize(q, track.aspect);
  return { x: c.x - s.w / 2, y: c.y - s.h / 2, w: Math.max(1e-4, s.w), h: Math.max(1e-4, s.h) };
}

/** Keyframes on the tracked clip itself so its tracked point holds still on the canvas. One op of the caller's transaction. */
export function holdOnTrack(tx: Transaction, input: HoldInput): HoldResult {
  checkTrack(input.track);
  const project = tx.project;
  const clip = requireEditableClip(project, input.clipId);
  if (clip.parentObjectId) throw invalid(`Clip ${input.clipId} follows a parent clip; reframe the parent instead.`);
  const step = Math.max(1, Math.round(input.step ?? 2));
  const frames = windowFrames(project, clip, step, input.extraFrames);
  const first = frames[0]!;
  const last = frames[frames.length - 1]!;
  const boxes = frames.map((n) => boxOf(input.track, sourceSecondsAt(project, clip, n)));
  const lostFrames = frames.filter((n) => lostAt(input.track, sourceSecondsAt(project, clip, n))).length;
  const g0 = clipGeometry(project, clip, first);
  const drawn = subjectOnCanvas(project, clip, first, boxes[0]!);
  const target: CanvasSubject = { cx: input.target?.x ?? drawn.cx, cy: input.target?.y ?? drawn.cy, size: drawn.size, angle: 0 };
  if (!(target.cx >= 0 && target.cx <= 1 && target.cy >= 0 && target.cy <= 1)) throw invalid("target must be on the canvas (0-1).");
  const size0 = Math.sqrt(boxes[0]!.w * boxes[0]!.h);
  const cover = input.cover ?? "zoom";
  let coverZoomed = 0;
  const rows = frames.map((n, i) => {
    const g = clipGeometry(project, clip, n);
    const progress = last > first ? (n - first) / (last - first) : 0;
    let scale = input.scaleAt ? input.scaleAt(n, progress, g0.current.scale) : g0.current.scale;
    if (input.keepSize) scale *= size0 / Math.sqrt(boxes[i]!.w * boxes[i]!.h);
    const rotation = g.current.rotation;
    if (cover === "zoom") {
      const need = coverScale(g, boxes[i]!, target, rotation) * COVER_SLACK * (input.coverZoom?.(n) ?? 1);
      if (!Number.isFinite(need)) throw invalid(`The tracked point of ${input.clipId} reaches the edge of its frame: no zoom keeps the frame covered there. Pass cover=none or another target.`);
      if (need > scale) {
        scale = need;
        coverZoomed += 1;
      }
    }
    return { scale, rotation, aspect: scaleAspect(g) };
  });
  const id = String(clip.id);
  const scales = rows.map((r) => r.scale);
  setClipKeyframes(tx, id, "scale_x", linear(frames, scales), { mode: "replace_range" });
  setClipKeyframes(tx, id, "scale_y", linear(frames, rows.map((r) => r.scale * r.aspect)), { mode: "replace_range" });
  const scaled = tx.project.clips.find((c) => c.id === clip.id)!;
  const values = frames.map((n, i) => solveLocation(clipGeometry(tx.project, scaled, n), boxes[i]!, target, scales[i]!, rows[i]!.rotation));
  setClipKeyframes(tx, id, "location_x", linear(frames, values.map((v) => v.locationX)), { mode: "replace_range" });
  setClipKeyframes(tx, id, "location_y", linear(frames, values.map((v) => v.locationY)), { mode: "replace_range" });
  return { clipId: id, frames, scaleRange: [Math.min(...scales), Math.max(...scales)], coverZoomed, lostFrames, target: { x: target.cx, y: target.cy } };
}
