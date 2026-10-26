/**
 * Match-cut alignment: per-clip scale / location (and rotation) keyframes
 * so the shared subject of consecutive shots (an iris, the moon, a cup rim)
 * sits at the same place and size on every cut frame. The math is in
 * matchcut/fit.ts; this op validates, picks the target, keeps the frame
 * covered and writes the keyframes.
 *
 * Keyframes are written over each clip's visible window (its first and last
 * frame, and every few frames between when the subject drifts or the shot
 * zooms), splicing like zenvi-core clip_props._merge_curve: points inside
 * the window are replaced, points outside it stay.
 */

import type { Transaction } from "../history/document.js";
import { Interpolation, type Clip, type Project } from "../model/types.js";
import {
  boxAt,
  clipGeometry,
  coverScale,
  fitRotation,
  fitScale,
  solveLocation,
  sourceSecondsAt,
  subjectOnCanvas,
  type CanvasSubject,
  type FitMode,
  type SubjectBox,
} from "../matchcut/fit.js";
import { frameWindow, localFrame } from "../timeline/windows.js";
import { setClipKeyframes } from "./clips.js";
import { invalid } from "./errors.js";
import { fpsOf, requireEditableClip } from "./internal.js";

/**
 * How the frame stays covered when the subject is moved or shrunk:
 * `zoom` scales that clip up just enough (its subject ends up larger than the
 * target), `zoom_all` raises the target size so every clip is covered and
 * all subjects still match, `none` allows black edges.
 */
export type CoverMode = "zoom" | "zoom_all" | "none";

export interface AlignClipInput {
  clipId: string;
  /** The subject on the clip's source frame. */
  box: SubjectBox;
  /** Source seconds the box was measured at (default: the clip's first frame). */
  time?: number;
  /** The subject again later in the source, to follow its drift. */
  later?: { box: SubjectBox; time: number };
  /**
   * `none`: this clip may leave the canvas showing around it (footage whose
   * edges are black already, a moon on a night sky); it does not raise the
   * size under `zoom_all`. Default: the call's cover mode.
   */
  cover?: "none";
}

export interface AlignOptions {
  /** Where subjects land (default: where the first clip shows its subject on its first frame). */
  target?: CanvasSubject;
  fit?: FitMode;
  cover?: CoverMode;
  /** Zoom each clip in by this fraction over its length, about the subject (0.04 = 4 %). Default 0. */
  zoomDrift?: number;
}

export interface AlignedClip {
  clipId: string;
  /** Scale on the cut frame. */
  scale: number;
  /** The extra zoom applied to keep the frame covered (1 = none). */
  coverZoom: number;
  rotation: number;
  /** Clip frames that got keyframes. */
  frames: number[];
  /** Where the subject is drawn on the cut frame after the edit. */
  subject: CanvasSubject;
  /** Black edges remain on some frame (cover = none). */
  uncovered: boolean;
}

export interface AlignResult {
  target: CanvasSubject;
  clips: AlignedClip[];
}

/** Frames between keyframes while a subject moves or a shot zooms (linear between them). */
const KEY_STEP = 6;
/** Cover a hair more than the exact bound: the decode size rounds to whole pixels. */
const COVER_SLACK = 1.002;
/** Zoom beyond this needs a sharper source (reported). */
export const SOFT_ZOOM = 3;

interface Planned {
  clip: Clip;
  cover: CoverMode;
  frames: number[];
  boxes: SubjectBox[];
  rotations: number[];
  /** Scale per frame for the size match and the drift, before the cover zoom. */
  fitScales: number[];
  /** Smallest covering scale per frame. */
  covers: number[];
}

function checkBox(box: SubjectBox, label: string): void {
  for (const key of ["x", "y", "w", "h"] as const) {
    if (!Number.isFinite(box[key])) throw invalid(`${label}.${key} must be a number.`);
  }
  if (!(box.w > 0 && box.h > 0)) throw invalid(`${label} must have a width and height above 0.`);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  if (cx < 0 || cx > 1 || cy < 0 || cy > 1) throw invalid(`${label}'s centre must be on the frame (0-1).`);
  if (box.angle !== undefined && !Number.isFinite(box.angle)) throw invalid(`${label}.angle must be a number.`);
}

/** Clip frames to key: first and last visible, and every KEY_STEP between when the values move. */
function keyFrames(first: number, last: number, moving: boolean): number[] {
  if (last <= first) return [first];
  const out = [first];
  if (moving) for (let n = first + KEY_STEP; n < last - 1; n += KEY_STEP) out.push(n);
  out.push(last);
  return out;
}

function plan(project: Project, input: AlignClipInput, target: CanvasSubject, fit: FitMode, drift: number, cover: CoverMode): Planned {
  const clip = requireEditableClip(project, input.clipId);
  if (clip.parentObjectId) throw invalid(`Clip ${input.clipId} follows a parent clip; align the parent instead.`);
  const window = frameWindow(clip, fpsOf(project));
  if (window.endFrame < window.startFrame) throw invalid(`Clip ${input.clipId} is empty.`);
  const first = window.localStartFrame;
  const last = localFrame(window, window.endFrame);
  const t0 = input.time ?? sourceSecondsAt(project, clip, first);
  const frames = keyFrames(first, last, Boolean(input.later) || drift !== 0);
  const plannedRow = frames.map((n) => {
    const box = boxAt(input.box, t0, input.later, sourceSecondsAt(project, clip, n));
    const g = clipGeometry(project, clip, n);
    const rotation = fitRotation(g, box, target, fit);
    const progress = last > first ? (n - first) / (last - first) : 0;
    const scale = fitScale(g, box, target, fit) * (1 + drift * progress);
    return { box, rotation, scale, cover: coverScale(g, box, target, rotation) * COVER_SLACK };
  });
  return {
    clip,
    cover: input.cover ?? cover,
    frames,
    boxes: plannedRow.map((r) => r.box),
    rotations: plannedRow.map((r) => r.rotation),
    fitScales: plannedRow.map((r) => r.scale),
    covers: plannedRow.map((r) => r.cover),
  };
}

const linear = (frames: readonly number[], values: readonly number[]) => frames.map((frame, i) => ({ frame, value: values[i]!, interpolation: Interpolation.LINEAR }));

/** Align `inputs` (timeline clips, in order) so their subjects share the target on every cut frame. One op, one undo step. */
export function alignMatchCut(tx: Transaction, inputs: readonly AlignClipInput[], options: AlignOptions = {}): AlignResult {
  const project = tx.project;
  if (inputs.length === 0) throw invalid("Give at least one clip to align.");
  const seen = new Set<string>();
  inputs.forEach((input, i) => {
    if (seen.has(input.clipId)) throw invalid(`Clip ${input.clipId} is listed twice.`);
    seen.add(input.clipId);
    checkBox(input.box, `clips[${i}].box`);
    if (input.later) checkBox(input.later.box, `clips[${i}].later box`);
    if (input.time !== undefined && !(Number.isFinite(input.time) && input.time >= 0)) throw invalid(`clips[${i}].time must be 0 or more seconds.`);
  });
  const fit = options.fit ?? "position_scale";
  const cover = options.cover ?? "zoom";
  const drift = options.zoomDrift ?? 0;
  if (!(Number.isFinite(drift) && drift >= 0 && drift <= 1)) throw invalid("zoom drift must be between 0 and 1.");

  let target = options.target;
  if (target) {
    if (!(target.cx >= 0 && target.cx <= 1 && target.cy >= 0 && target.cy <= 1)) throw invalid("target centre must be on the canvas (0-1).");
    if (!(target.size > 0 && target.size <= 4)) throw invalid("target size must be above 0 (a fraction of the canvas height).");
    if (!Number.isFinite(target.angle)) throw invalid("target angle must be a number.");
  } else {
    // The first clip's subject where it is drawn now, on its first frame.
    const first = requireEditableClip(project, inputs[0]!.clipId);
    const n = frameWindow(first, fpsOf(project)).localStartFrame;
    const t = inputs[0]!.time ?? sourceSecondsAt(project, first, n);
    target = subjectOnCanvas(project, first, n, boxAt(inputs[0]!.box, t, inputs[0]!.later, sourceSecondsAt(project, first, n)));
  }

  const planAll = (t: CanvasSubject) => inputs.map((input) => plan(project, input, t, fit, drift, cover));
  let plans = planAll(target);
  const stuck = plans.filter((p) => p.cover !== "none" && p.covers.some((c) => !Number.isFinite(c)));
  if (stuck.length > 0) throw invalid(edgeMessage(stuck));
  if (cover === "zoom_all" && fit !== "position") {
    // Every subject grows by the largest zoom any covered clip needs, so they all still match.
    const zoom = Math.max(1, ...plans.filter((p) => p.cover !== "none").flatMap((p) => p.covers.map((c, i) => c / p.fitScales[i]!)));
    if (zoom > 1) {
      target = { ...target, size: target.size * zoom };
      plans = planAll(target);
    }
  }

  const clips = plans.map((p): AlignedClip => {
    const id = String(p.clip.id);
    const scales = p.fitScales.map((s, i) => (p.cover === "none" ? s : Math.max(s, p.covers[i]!)));
    setClipKeyframes(tx, id, "scale_x", linear(p.frames, scales), { mode: "replace_range" });
    setClipKeyframes(tx, id, "scale_y", linear(p.frames, scales), { mode: "replace_range" });
    if (fit === "position_scale_rotation") setClipKeyframes(tx, id, "rotation", linear(p.frames, p.rotations), { mode: "replace_range" });
    // Location after the scale is written: the decode size follows the scale curve (calculate_max_size).
    const scaled = tx.project.clips.find((c) => c.id === p.clip.id)!;
    const values = p.frames.map((n, i) => solveLocation(clipGeometry(tx.project, scaled, n), p.boxes[i]!, target!, scales[i]!, p.rotations[i]!));
    setClipKeyframes(tx, id, "location_x", linear(p.frames, values.map((v) => v.locationX)), { mode: "replace_range" });
    setClipKeyframes(tx, id, "location_y", linear(p.frames, values.map((v) => v.locationY)), { mode: "replace_range" });
    const after = tx.project.clips.find((c) => c.id === p.clip.id)!;
    return {
      clipId: id,
      scale: scales[0]!,
      coverZoom: scales[0]! / p.fitScales[0]!,
      rotation: p.rotations[0]!,
      frames: p.frames,
      subject: subjectOnCanvas(tx.project, after, p.frames[0]!, p.boxes[0]!),
      uncovered: p.cover === "none" && p.covers.some((c, i) => c > scales[i]! * COVER_SLACK),
    };
  });
  return { target: target!, clips };
}

function edgeMessage(plans: readonly Planned[]): string {
  const ids = plans.map((p) => String(p.clip.id)).join(", ");
  return `The subject of ${ids} touches the edge of its frame: no zoom can put it on the target without black edges. Pick another target or pass cover=none.`;
}
