/**
 * Snapping targets for timeline drags (zenvi-core
 * src/windows/views/timeline_backend/snap.py): clip and transition edges
 * (except the dragged items), markers, the timeline start and end, the
 * playhead, and optionally keyframes. The desktop tolerance is 12 pixels at
 * the current zoom (`tick_pixels / scale` pixels per second).
 */

import type { Project } from "../model/types.js";
import { itemEnd } from "./windows.js";

/** Desktop snap tolerance, pixels (snap.py `_snap_tolerance_px`). */
export const SNAP_TOLERANCE_PX = 12;

export type SnapKind =
  | "clip-start"
  | "clip-end"
  | "transition-start"
  | "transition-end"
  | "marker"
  | "timeline-start"
  | "timeline-end"
  | "playhead"
  | "keyframe";

export interface SnapTarget {
  seconds: number;
  kind: SnapKind;
  /** Id of the clip / transition / marker the target belongs to. */
  id?: string;
  /** Per-target tolerance in seconds (keyframes use a tighter one). */
  tolerance?: number;
}

export interface SnapTargetOptions {
  /** Items being dragged: their edges are not targets. */
  ignoreIds?: Iterable<string>;
  /** Playhead position, seconds. */
  playhead?: number;
  /** Extra keyframe times (timeline seconds). */
  keyframes?: readonly number[];
  /** Tolerance for keyframe targets, seconds. */
  keyframeTolerance?: number;
}

/** Pixels per second at the project's saved zoom (`tick_pixels / scale`). */
export function pixelsPerSecond(project: Project): number {
  const scale = project.scale > 0 ? project.scale : 15;
  const tick = project.tick_pixels > 0 ? project.tick_pixels : 100;
  return tick / scale;
}

/** The desktop's 12 px tolerance in seconds at a zoom level. */
export function snapToleranceSeconds(pxPerSecond: number): number {
  return pxPerSecond > 0 ? SNAP_TOLERANCE_PX / pxPerSecond : 0;
}

/** Every snap target, deduplicated by (kind, seconds). */
export function snapTargets(project: Project, opts: SnapTargetOptions = {}): SnapTarget[] {
  const ignore = new Set(opts.ignoreIds ?? []);
  const targets: SnapTarget[] = [];
  for (const clip of project.clips) {
    if (ignore.has(clip.id)) continue;
    targets.push({ seconds: clip.position, kind: "clip-start", id: clip.id });
    targets.push({ seconds: itemEnd(clip), kind: "clip-end", id: clip.id });
  }
  for (const transition of project.effects) {
    if (ignore.has(transition.id)) continue;
    targets.push({ seconds: transition.position, kind: "transition-start", id: transition.id });
    targets.push({ seconds: itemEnd(transition), kind: "transition-end", id: transition.id });
  }
  for (const marker of project.markers) {
    targets.push({ seconds: marker.position, kind: "marker", id: marker.id });
  }
  targets.push({ seconds: 0, kind: "timeline-start" });
  if (project.duration > 0) targets.push({ seconds: project.duration, kind: "timeline-end" });
  if (opts.playhead !== undefined && Number.isFinite(opts.playhead)) {
    targets.push({ seconds: opts.playhead, kind: "playhead" });
  }
  for (const seconds of opts.keyframes ?? []) {
    if (!Number.isFinite(seconds)) continue;
    const target: SnapTarget = { seconds: Math.max(0, seconds), kind: "keyframe" };
    if (opts.keyframeTolerance !== undefined) target.tolerance = opts.keyframeTolerance;
    targets.push(target);
  }
  const seen = new Set<string>();
  return targets.filter((t) => {
    const key = `${t.kind}:${t.seconds.toFixed(6)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface SnapResult {
  /** How far to move (seconds, 0 when nothing snapped). */
  delta: number;
  target: SnapTarget | null;
  /** Which of the dragged edges snapped (index into `edges`). */
  edge: number;
}

/**
 * Snap a dragged item: `edges` are its candidate times (e.g. `[start, end]`);
 * the closest target within tolerance wins. Returns the offset to apply.
 */
export function snapEdges(edges: readonly number[], targets: readonly SnapTarget[], tolerance: number): SnapResult {
  let best: SnapResult = { delta: 0, target: null, edge: -1 };
  let bestDistance = Infinity;
  edges.forEach((edge, index) => {
    for (const target of targets) {
      const distance = Math.abs(target.seconds - edge);
      const limit = target.tolerance ?? tolerance;
      if (distance <= limit && distance < bestDistance) {
        bestDistance = distance;
        best = { delta: target.seconds - edge, target, edge: index };
      }
    }
  });
  return best;
}

/** Snap one time. Returns the snapped time (unchanged when nothing is close). */
export function snapTime(seconds: number, targets: readonly SnapTarget[], tolerance: number): number {
  return seconds + snapEdges([seconds], targets, tolerance).delta;
}
