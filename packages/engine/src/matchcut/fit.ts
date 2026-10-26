/**
 * Match-cut alignment math: where a subject seen in a clip's source frame
 * lands on the canvas, and the scale / location / rotation that put it on a
 * target. Pure functions over one clip and one clip frame.
 *
 * A subject box is normalised to the source frame (0-1, origin top-left).
 * libopenshot draws source pixel (u, v) at (Clip::get_transform,
 * render/plan/transform.ts):
 *
 *   P = (x, y) + o + R(r) · (S·(u, v) − o)
 *
 *   S        = diag(ssw / srcW, ssh / srcH), ssw = base.w · s (base: the
 *              scale-mode size of the source in the layout box at scale 1)
 *   o        = (origin_x · ssw, origin_y · ssh), the rotation pivot
 *   R(r)     = Qt rotate(r): x' = x cos r − y sin r, y' = x sin r + y cos r
 *   (x, y)   = gravity anchor + location offset (see `locationFor`)
 *
 * With the subject centre c = (cx · ssw, cy · ssh) the subject lands on the
 * target T when (x, y) = T − o − R(r)·(c − o), and its size (geometric mean
 * of the box's drawn width and height) is s · √(w·base.w · h·base.h·k), so
 * s = target size / that root. k = scale_y / scale_x is the clip's own
 * aspect, kept as it is (scale_y is written as k·s). Location is then read back from (x, y) by
 * inverting the gravity + location step, which is linear on each side of 0
 * (scale mode CROP measures location against the free space on that side).
 */

import type { Clip, Fraction, Project } from "../model/types.js";
import { Gravity, ScaleMode } from "../model/types.js";
import { remappedClipFrame } from "../render/plan/frame-plan.js";
import { deliveredSource, scaleSize } from "../render/plan/reader.js";
import { clipKeyframe, clipTransform } from "../render/plan/transform.js";

/** A subject on a clip's source frame: top-left x, y and size w, h, all 0-1; angle in degrees clockwise. */
export interface SubjectBox {
  x: number;
  y: number;
  w: number;
  h: number;
  angle?: number;
}

/** A subject on the canvas: centre (0-1 of the canvas), size (fraction of the canvas height), angle (degrees clockwise). */
export interface CanvasSubject {
  cx: number;
  cy: number;
  size: number;
  angle: number;
}

export type FitMode = "position" | "position_scale" | "position_scale_rotation";

/** Transform values of one clip frame. */
export interface FitValues {
  scale: number;
  locationX: number;
  locationY: number;
  rotation: number;
}

/** The parts of a clip's transform the solver needs, at clip frame `n`. */
export interface ClipGeometry {
  /** Canvas (project) size, pixels. */
  width: number;
  height: number;
  /** The source image the transform is built for, pixels. */
  srcW: number;
  srcH: number;
  /** Drawn size at scale 1, pixels. */
  baseW: number;
  baseH: number;
  layoutX: number;
  layoutY: number;
  layoutW: number;
  layoutH: number;
  scaleMode: number;
  /** Gravity as fractions of the free space: 0 left/top, 0.5 centre, 1 right/bottom. */
  gravityX: number;
  gravityY: number;
  originX: number;
  originY: number;
  /** The clip's current values at `n`. */
  current: FitValues & { scaleY: number };
}

const GRAVITY_FRACTIONS: Record<number, [number, number]> = {
  [Gravity.TOP_LEFT]: [0, 0],
  [Gravity.TOP]: [0.5, 0],
  [Gravity.TOP_RIGHT]: [1, 0],
  [Gravity.LEFT]: [0, 0.5],
  [Gravity.CENTER]: [0.5, 0.5],
  [Gravity.RIGHT]: [1, 0.5],
  [Gravity.BOTTOM_LEFT]: [0, 1],
  [Gravity.BOTTOM]: [0.5, 1],
  [Gravity.BOTTOM_RIGHT]: [1, 1],
};

const DEG = Math.PI / 180;

function fpsOf(project: Project): Fraction {
  const num = Number(project.fps?.num);
  const den = Number(project.fps?.den);
  return num > 0 && den > 0 ? { num, den } : { num: 30, den: 1 };
}

/** The source image size the frame planner builds this clip's transform for (full-size export). */
export function clipSourceSize(project: Project, clip: Clip): { width: number; height: number } {
  const width = Math.max(1, Math.trunc(Number(project.width) || 1920));
  const height = Math.max(1, Math.trunc(Number(project.height) || 1080));
  const delivered = deliveredSource(clip, { previewWidth: width, previewHeight: height, timelineWidth: width });
  return { width: Math.max(1, delivered.width || width), height: Math.max(1, delivered.height || height) };
}

export function clipGeometry(project: Project, clip: Clip, n: number): ClipGeometry {
  const width = Math.max(1, Math.trunc(Number(project.width) || 1920));
  const height = Math.max(1, Math.trunc(Number(project.height) || 1080));
  const src = clipSourceSize(project, clip);
  // Margin and layout box as in clipTransform.
  const margin = Math.max(0, Math.min(0.5, clipKeyframe(clip, "margin", n)));
  const marginPx = margin * Math.min(width, height);
  const layoutW = Math.max(1, width - marginPx * 2);
  const layoutH = Math.max(1, height - marginPx * 2);
  const scaleMode = Number(clip.scale ?? ScaleMode.FIT);
  const base = scaleSize(src.width, src.height, scaleMode, Math.trunc(layoutW), Math.trunc(layoutH));
  const [gravityX, gravityY] = GRAVITY_FRACTIONS[Number(clip.gravity ?? Gravity.CENTER)] ?? [0.5, 0.5];
  return {
    width,
    height,
    srcW: src.width,
    srcH: src.height,
    baseW: base.width,
    baseH: base.height,
    layoutX: marginPx,
    layoutY: marginPx,
    layoutW,
    layoutH,
    scaleMode,
    gravityX,
    gravityY,
    originX: clipKeyframe(clip, "origin_x", n),
    originY: clipKeyframe(clip, "origin_y", n),
    current: {
      scale: clipKeyframe(clip, "scale_x", n),
      scaleY: clipKeyframe(clip, "scale_y", n),
      locationX: clipKeyframe(clip, "location_x", n),
      locationY: clipKeyframe(clip, "location_y", n),
      rotation: clipKeyframe(clip, "rotation", n),
    },
  };
}

/** Source seconds shown at clip frame `n` (after the `time` curve). */
export function sourceSecondsAt(project: Project, clip: Clip, n: number): number {
  const fps = fpsOf(project);
  return (remappedClipFrame(clip, n) - 1) / (fps.num / fps.den);
}

/** Where `box` is drawn at clip frame `n` with the clip's current keyframes (through clipTransform itself). */
export function subjectOnCanvas(project: Project, clip: Clip, n: number, box: SubjectBox): CanvasSubject {
  const g = clipGeometry(project, clip, n);
  const t = clipTransform(clip, n, g.srcW, g.srcH, g.width, g.height, fpsOf(project));
  const at = (u: number, v: number) => t.map(u * g.srcW, v * g.srcH);
  const [cx, cy] = at(box.x + box.w / 2, box.y + box.h / 2);
  const [lx, ly] = at(box.x, box.y + box.h / 2);
  const [rx, ry] = at(box.x + box.w, box.y + box.h / 2);
  const [tx, ty] = at(box.x + box.w / 2, box.y);
  const [bx, by] = at(box.x + box.w / 2, box.y + box.h);
  const drawnW = Math.hypot(rx - lx, ry - ly);
  const drawnH = Math.hypot(bx - tx, by - ty);
  return { cx: cx / g.width, cy: cy / g.height, size: Math.sqrt(drawnW * drawnH) / g.height, angle: (box.angle ?? 0) + g.current.rotation };
}

function rotate(x: number, y: number, degrees: number): [number, number] {
  const c = Math.cos(degrees * DEG);
  const s = Math.sin(degrees * DEG);
  return [x * c - y * s, x * s + y * c];
}

/**
 * Canvas x of the clip's left edge for location `l` (Clip::get_transform):
 * the gravity anchor `a = layoutX + g · (layoutW − ssw)`, then SCALE_CROP
 * adds `l · (layoutW − (a − layoutX))` for l ≥ 0 and `l · (a − layoutX + ssw)`
 * for l < 0 (the free space on that side), other modes add `l · width`.
 * This inverts it: the location that puts the edge at `left`.
 */
function locationFor(left: number, drawn: number, layoutStart: number, layoutSize: number, canvas: number, gravity: number, crop: boolean): number {
  const anchor = layoutStart + gravity * (layoutSize - drawn);
  const d = left - anchor;
  if (!crop) return d / canvas;
  const anchored = anchor - layoutStart;
  return d >= 0 ? d / Math.max(1e-9, layoutSize - anchored) : d / Math.max(1e-9, anchored + drawn);
}

/** The clip's scale_y / scale_x at this frame: a stretched clip stays stretched. */
export function scaleAspect(g: ClipGeometry): number {
  const k = g.current.scaleY / g.current.scale;
  return Number.isFinite(k) && k > 0 ? k : 1;
}

/** Size of `box` drawn at scale 1, pixels (geometric mean of width and height). */
export function baseSubjectSize(g: ClipGeometry, box: SubjectBox): number {
  return Math.sqrt(Math.max(1e-12, box.w * g.baseW * box.h * g.baseH * scaleAspect(g)));
}

/**
 * The smallest scale at which the clip still covers the canvas with the
 * subject centred on `target`, rotated by `rotation`. A canvas corner Q maps
 * back to source u = cx + [R(−r)·(Q − T)].x / (base.w · s) (v likewise over
 * base.h · k · s), which must stay in 0..1, so each corner bounds s from below. Infinity when no scale covers
 * (the subject centre on the very edge of the source).
 */
export function coverScale(g: ClipGeometry, box: SubjectBox, target: CanvasSubject, rotation: number): number {
  const ccx = box.x + box.w / 2;
  const ccy = box.y + box.h / 2;
  const tx = target.cx * g.width;
  const ty = target.cy * g.height;
  const k = scaleAspect(g);
  let need = 0;
  const bound = (d: number, centre: number, base: number) => {
    if (d > 1e-9) need = Math.max(need, centre >= 1 ? Infinity : d / (base * (1 - centre)));
    else if (d < -1e-9) need = Math.max(need, centre <= 0 ? Infinity : -d / (base * centre));
  };
  for (const [qx, qy] of [
    [0, 0],
    [g.width, 0],
    [0, g.height],
    [g.width, g.height],
  ] as const) {
    const [dx, dy] = rotate(qx - tx, qy - ty, -rotation);
    bound(dx, ccx, g.baseW);
    bound(dy, ccy, g.baseH * k);
  }
  return need;
}

/** The rotation a fit gives: the target's angle minus the subject's, or the clip's own. */
export function fitRotation(g: ClipGeometry, box: SubjectBox, target: CanvasSubject, fit: FitMode): number {
  return fit === "position_scale_rotation" ? target.angle - (box.angle ?? 0) : g.current.rotation;
}

/** The scale a fit gives before any cover zoom: the target size, or the clip's own scale (`position`). */
export function fitScale(g: ClipGeometry, box: SubjectBox, target: CanvasSubject, fit: FitMode): number {
  return fit === "position" ? g.current.scale : (target.size * g.height) / baseSubjectSize(g, box);
}

/** Location that puts the subject centre on the target at scale `scale` and rotation `rotation`. */
export function solveLocation(g: ClipGeometry, box: SubjectBox, target: CanvasSubject, scale: number, rotation: number): FitValues {
  const ssw = g.baseW * scale;
  const ssh = g.baseH * scale * scaleAspect(g);
  const ox = g.originX * ssw;
  const oy = g.originY * ssh;
  const cx = (box.x + box.w / 2) * ssw;
  const cy = (box.y + box.h / 2) * ssh;
  const [rx, ry] = rotate(cx - ox, cy - oy, rotation);
  const left = target.cx * g.width - ox - rx;
  const top = target.cy * g.height - oy - ry;
  const crop = g.scaleMode === ScaleMode.CROP;
  return {
    scale,
    rotation,
    locationX: locationFor(left, ssw, g.layoutX, g.layoutW, g.width, g.gravityX, crop),
    locationY: locationFor(top, ssh, g.layoutY, g.layoutH, g.height, g.gravityY, crop),
  };
}

/** Linear interpolation (and extrapolation) between two boxes measured at `t0` and `t1` source seconds. */
export function boxAt(box: SubjectBox, t0: number, later: { box: SubjectBox; time: number } | undefined, t: number): SubjectBox {
  if (!later || Math.abs(later.time - t0) < 1e-6) return box;
  const k = (t - t0) / (later.time - t0);
  const mix = (a: number, b: number) => a + (b - a) * k;
  const angle = box.angle === undefined && later.box.angle === undefined ? undefined : mix(box.angle ?? 0, later.box.angle ?? 0);
  return {
    x: mix(box.x, later.box.x),
    y: mix(box.y, later.box.y),
    w: Math.max(1e-4, mix(box.w, later.box.w)),
    h: Math.max(1e-4, mix(box.h, later.box.h)),
    ...(angle === undefined ? {} : { angle }),
  };
}
