/**
 * Placing several files back to back on one track: the desktop's Project
 * Files ▸ Add to Timeline dialog, which add_clips_to_timeline_tool shares.
 *
 * Ported from zenvi-core develop 1f80cb3d0 src/classes/timeline_ops.py
 * (`plan_placement`, `place_files`, `insert_placement_step`) and
 * src/classes/editor_tools/timeline_edit.py (`_fit_lengths`). Clips are built
 * like every other add (`addClip`: the default clip JSON, the file as reader,
 * audio-only overrides, a stored caption), then get the dialog's fades and
 * zoom; each transition is a desktop drop-in transition (`addTransition`).
 */

import type { Transaction } from "../history/document.js";
import type { Keyframe } from "../model/types.js";
import { Gravity, Interpolation } from "../model/types.js";
import { isStillImage } from "../model/defaults.js";
import { openshotPoint, setKeyframePoint } from "../keyframe/edit.js";
import { addClip } from "./clips.js";
import { invalid, requireFile, requireFinite, requireNonNegative } from "./errors.js";
import { fpsOf, patchClip } from "./internal.js";
import { addTransition } from "./transitions.js";

export type PlacementFade = "in" | "out" | "in_out";
export type PlacementZoom = "in" | "out" | "random";

export interface PlaceFileEntry {
  fileId: string;
  /** Source in point, seconds. Default the file's own in point (sub-clips), else 0. */
  start?: number;
  /**
   * Source out point, seconds. Default the file's own out point, else its
   * duration. For a still image: how long it stays on screen.
   */
  end?: number;
}

export interface PlaceFilesOptions {
  /** Opacity fades on every clip, used without a transition; clips overlap by `fadeLength` so the fades cross. */
  fade?: PlacementFade;
  /** Fade length, seconds. Default 2. */
  fadeLength?: number;
  /** Transition (catalog id, name or mask path) between consecutive clips; clips overlap by `transitionLength`. */
  transition?: string;
  /** Pick a random transition from these for every join instead of `transition`. */
  randomTransitions?: readonly string[];
  /** Transition length, seconds. Default 2. */
  transitionLength?: number;
  /** Seconds a still image stays on screen when its entry has no `end`. Default 10. */
  imageLength?: number;
  /** Slow zoom on every clip: in = 100% → 125%, out = 125% → 100%, random = random zoom and pan. */
  zoom?: PlacementZoom;
  /** Also wipe the first clip in over what is below it (the dialog does). Default true. */
  transitionFirstClip?: boolean;
  /** Random source for random transitions and zoom. Default Math.random. */
  random?: () => number;
}

export interface PlaceFilesResult {
  clipIds: string[];
  transitionIds: string[];
}

/** frame_time.to_frame: seconds to a 0-based frame, halves away from zero. */
function toFrame(seconds: number, rate: number): number {
  const v = seconds * rate;
  return v >= 0 ? Math.floor(v + 0.5) : Math.ceil(v - 0.5);
}

/** frame_time.keyframe_x: the 1-based keyframe X of a time. */
function keyframeX(seconds: number, rate: number): number {
  return toFrame(seconds, rate) + 1;
}

function uniform(random: () => number, a: number, b: number): number {
  return a + (b - a) * random();
}

function addPoints(kf: Keyframe | undefined, points: [number, number][]): Keyframe {
  let next: Keyframe = kf ?? { Points: [] };
  for (const [x, y] of points) next = setKeyframePoint(next, openshotPoint(x, y, Interpolation.BEZIER));
  return next;
}

/**
 * Place files back to back on track `layer` from `startPosition`, in one
 * transaction step (timeline_ops.place_files). Positions follow the dialog:
 * with fades or a transition each clip starts that much before the previous
 * one ends (never before `startPosition`). Returns the new ids in order.
 */
export function placeFiles(
  tx: Transaction,
  entries: readonly PlaceFileEntry[],
  startPosition: number,
  layer: number,
  opts: PlaceFilesOptions = {},
): PlaceFilesResult {
  const project = tx.project;
  if (!Array.isArray(entries) || entries.length === 0) throw invalid("Give at least one file to place.");
  const start = requireNonNegative(startPosition, "startPosition");
  const fadeLength = requireNonNegative(opts.fadeLength ?? 2.0, "fadeLength");
  const transitionLength = requireNonNegative(opts.transitionLength ?? 2.0, "transitionLength");
  const imageLength = requireNonNegative(opts.imageLength ?? 10.0, "imageLength");
  const random = opts.random ?? Math.random;
  const pool = opts.randomTransitions && opts.randomTransitions.length > 0 ? opts.randomTransitions : null;
  const withTransition = Boolean(pool || opts.transition);
  const files = entries.map((entry) => requireFile(project, entry.fileId));
  const fps = fpsOf(project);
  const rate = fps.num / fps.den;
  const result: PlaceFilesResult = { clipIds: [], transitionIds: [] };

  let position = start;
  entries.forEach((entry, index) => {
    const file = files[index]!;
    const own = file as unknown as Record<string, unknown>;
    let startTime = typeof own.start === "number" ? own.start : 0;
    let endTime = typeof own.end === "number" ? own.end : Number(file.duration ?? 0);
    if (entry.start !== undefined) startTime = requireFinite(entry.start, "start");
    if (entry.end !== undefined) endTime = requireFinite(entry.end, "end");
    if (isStillImage(file)) endTime = entry.end ?? imageLength;
    let clipPosition = (toFrame(position, rate) * fps.den) / fps.num;
    let transition: { position: number; duration: number; mask: string } | null = null;

    if (!withTransition && opts.fade) {
      // Overlap this clip with the previous one so the fades cross.
      position = Math.max(start, clipPosition - fadeLength);
      clipPosition = position;
    }
    if (withTransition && (index > 0 || (opts.transitionFirstClip ?? true))) {
      const mask = pool ? pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]! : opts.transition!;
      position = Math.max(start, position - transitionLength);
      clipPosition = position;
      transition = { position, duration: Math.min(transitionLength, endTime - startTime), mask };
    }

    if (transition) {
      result.transitionIds.push(
        addTransition(tx, {
          layer,
          position: transition.position,
          duration: transition.duration,
          maskId: transition.mask,
          direction: "in",
          title: "Transition",
        }).id,
      );
    }
    const clip = addClip(tx, { fileId: file.id, position: clipPosition, layer, start: startTime, end: endTime });
    result.clipIds.push(clip.id);

    const patch: Record<string, unknown> = {};
    if (!withTransition && opts.fade) {
      const points: [number, number][] = [];
      if (opts.fade === "in" || opts.fade === "in_out") {
        points.push([keyframeX(startTime, rate), 0.0]);
        points.push([Math.min(keyframeX(startTime + fadeLength, rate), keyframeX(endTime, rate)), 1.0]);
      }
      if (opts.fade === "out" || opts.fade === "in_out") {
        points.push([Math.max(keyframeX(endTime - fadeLength, rate), keyframeX(startTime, rate)), 1.0]);
        points.push([keyframeX(endTime, rate), 0.0]);
      }
      patch.alpha = addPoints(clip.alpha, points);
    }
    if (opts.zoom) {
      let x: [number, number] = [0, 0];
      let y: [number, number] = [0, 0];
      let scale: [number, number] = opts.zoom === "in" ? [1.0, 1.25] : [1.25, 1.0];
      if (opts.zoom === "random") {
        x = [uniform(random, -0.5, 0.5), uniform(random, -0.15, 0.15)];
        y = [uniform(random, -0.5, 0.5), uniform(random, -0.15, 0.15)];
        scale = [uniform(random, 0.5, 1.5), uniform(random, 0.85, 1.15)];
      }
      const first = keyframeX(startTime, rate);
      const last = keyframeX(endTime, rate);
      patch.gravity = Gravity.CENTER;
      patch.scale_x = addPoints(clip.scale_x, [[first, scale[0]], [last, scale[1]]]);
      patch.scale_y = addPoints(clip.scale_y, [[first, scale[0]], [last, scale[1]]]);
      patch.location_x = addPoints(clip.location_x, [[first, x[0]], [last, x[1]]]);
      patch.location_y = addPoints(clip.location_y, [[first, y[0]], [last, y[1]]]);
    }
    if (Object.keys(patch).length > 0) patchClip(tx, clip.id, patch);
    position += endTime - startTime;
  });
  return result;
}

/**
 * Lengths that make clips add up to `budget` seconds by trimming the longest
 * flexible ones to one common cap (water-fill; timeline_edit._fit_lengths).
 * Clips shorter than the cap keep their length, none goes below its `keep`
 * floor, fixed ones never change; lengths are whole frames, with the frames
 * lost to rounding handed back to the longest trimmed clips. Null when
 * `budget` is out of reach. Pure.
 */
export function fitLengths(
  durations: readonly number[],
  fixed: readonly boolean[],
  keep: readonly number[],
  budget: number,
  frame: number,
  tolerance: number,
): number[] | null {
  const flex = durations.map((_, i) => i).filter((i) => !fixed[i]);
  const fixedSum = durations.reduce((sum, d, i) => (fixed[i] ? sum + d : sum), 0);
  const totalAt = (cap: number): number => flex.reduce((sum, i) => sum + Math.min(durations[i]!, Math.max(cap, keep[i]!)), fixedSum);
  if (totalAt(0) > budget + tolerance) return null;
  let lo = 0;
  let hi = Math.max(...durations);
  for (let n = 0; n < 80; n += 1) {
    const mid = (lo + hi) / 2;
    if (totalAt(mid) > budget) hi = mid;
    else lo = mid;
  }
  const out = [...durations];
  for (const i of flex) {
    const target = Math.min(durations[i]!, Math.max(lo, keep[i]!));
    out[i] = target >= durations[i]! - 1e-9 ? durations[i]! : Math.max(frame, Math.trunc(target / frame) * frame);
  }
  const sum = (): number => out.reduce((a, b) => a + b, 0);
  const trimmed = flex.filter((i) => out[i]! < durations[i]! - 1e-9).sort((a, b) => out[b]! - out[a]!);
  while (sum() < budget - frame / 2) {
    let grew = false;
    for (const i of trimmed) {
      if (sum() >= budget - frame / 2) break;
      if (out[i]! + frame <= durations[i]! + 1e-9) {
        out[i] = out[i]! + frame;
        grew = true;
      }
    }
    if (!grew) break;
  }
  return out;
}
