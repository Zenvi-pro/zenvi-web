/**
 * Screen-recording smart zoom: eased scale / location keyframes that push in
 * on each zoom stop (tracking/activity.ts), pan straight to the next stop
 * when it follows closely, and pull back to the full frame between. Bezier
 * keys (the desktop's default ease) so the moves start and land softly.
 */

import type { Transaction } from "../history/document.js";
import { clipGeometry, scaleAspect, solveLocation, sourceSecondsAt, subjectOnCanvas } from "../matchcut/fit.js";
import { Interpolation } from "../model/types.js";
import type { ZoomStop } from "../tracking/activity.js";
import { frameWindow, localFrame } from "../timeline/windows.js";
import { setClipKeyframes } from "./clips.js";
import { invalid } from "./errors.js";
import { fpsOf, requireEditableClip } from "./internal.js";

export interface ZoomFollowInput {
  clipId: string;
  /** Source seconds and source-frame points (0-1). */
  stops: readonly ZoomStop[];
  /** Scale on a stop, relative to the clip's own (1.3 = 130 %). */
  zoom: number;
  /** Length of each push, pan and pull, seconds. */
  ease: number;
}

export interface ZoomFollowResult {
  clipId: string;
  /** Stops inside the clip's window that got a zoom. */
  stops: ZoomStop[];
  /** Clip frames that got keyframes. */
  frames: number[];
}

/** If the next stop lands within this many seconds of leaving one, pan to it without pulling back. */
const PAN_GAP = 0.6;

export function zoomFollow(tx: Transaction, input: ZoomFollowInput): ZoomFollowResult {
  const project = tx.project;
  const clip = requireEditableClip(project, input.clipId);
  if (clip.parentObjectId) throw invalid(`Clip ${input.clipId} follows a parent clip; zoom the parent instead.`);
  if (!(input.zoom >= 1 && input.zoom <= 4)) throw invalid("zoom must be between 1 and 4.");
  if (!(input.ease > 0 && input.ease <= 3)) throw invalid("ease must be between 0 and 3 seconds.");
  const w = frameWindow(clip, fpsOf(project));
  if (w.endFrame < w.startFrame) throw invalid(`Clip ${input.clipId} is empty.`);
  const first = w.localStartFrame;
  const last = localFrame(w, w.endFrame);
  // Source seconds of every clip frame, to find frames by source time through any time curve.
  const seconds: number[] = [];
  for (let n = first; n <= last; n += 1) seconds.push(sourceSecondsAt(project, clip, n));
  const lo = Math.min(seconds[0]!, seconds[seconds.length - 1]!);
  const hi = Math.max(seconds[0]!, seconds[seconds.length - 1]!);
  const frameAt = (t: number): number => {
    let best = 0;
    for (let i = 1; i < seconds.length; i += 1) if (Math.abs(seconds[i]! - t) < Math.abs(seconds[best]! - t)) best = i;
    return first + best;
  };
  const stops = input.stops.filter((s) => s.end > lo && s.start < hi).sort((a, b) => a.start - b.start);
  if (stops.length === 0) return { clipId: String(clip.id), stops: [], frames: [] };

  const g0 = clipGeometry(project, clip, first);
  const wide = { scale: g0.current.scale, x: g0.current.locationX, y: g0.current.locationY };
  const centre = subjectOnCanvas(project, clip, first, { x: 0.5, y: 0.5, w: 1e-3, h: 1e-3 });
  const aspect = scaleAspect(g0);
  const zoomed = (s: ZoomStop, n: number) => {
    const scale = wide.scale * input.zoom;
    // Keep the zoomed window on the source: its centre moves at most to 1/(2·zoom) from each edge.
    const half = 1 / (2 * input.zoom);
    const cx = Math.min(1 - half, Math.max(half, s.x));
    const cy = Math.min(1 - half, Math.max(half, s.y));
    const loc = solveLocation(clipGeometry(project, clip, n), { x: cx - 1e-4, y: cy - 1e-4, w: 2e-4, h: 2e-4 }, { cx: centre.cx, cy: centre.cy, size: 1, angle: 0 }, scale, g0.current.rotation);
    return { scale, x: loc.locationX, y: loc.locationY };
  };

  const keys = new Map<number, { scale: number; x: number; y: number }>();
  const put = (n: number, v: { scale: number; x: number; y: number }) => {
    if (n >= first && n <= last && !keys.has(n)) keys.set(n, v);
  };
  put(first, stops[0]!.start - input.ease <= lo ? zoomed(stops[0]!, first) : wide);
  stops.forEach((s, i) => {
    const land = frameAt(Math.max(lo, s.start));
    const leave = Math.max(land, frameAt(Math.min(hi, s.end)));
    const prev = stops[i - 1];
    const panned = prev && s.start - prev.end <= PAN_GAP + input.ease;
    if (!panned) put(Math.max(first, frameAt(s.start - input.ease)), wide);
    put(land, zoomed(s, land));
    put(leave, zoomed(s, leave));
    const next = stops[i + 1];
    if (!next || next.start - s.end > PAN_GAP + input.ease) put(frameAt(s.end + input.ease), wide);
  });
  put(last, keys.get([...keys.keys()].sort((a, b) => b - a)[0]!) ?? wide);
  const frames = [...keys.keys()].sort((a, b) => a - b);
  const id = String(clip.id);
  const points = (pick: (v: { scale: number; x: number; y: number }) => number) => frames.map((frame) => ({ frame, value: pick(keys.get(frame)!), interpolation: Interpolation.BEZIER }));
  setClipKeyframes(tx, id, "scale_x", points((v) => v.scale), { mode: "replace_range" });
  setClipKeyframes(tx, id, "scale_y", points((v) => v.scale * aspect), { mode: "replace_range" });
  setClipKeyframes(tx, id, "location_x", points((v) => v.x), { mode: "replace_range" });
  setClipKeyframes(tx, id, "location_y", points((v) => v.y), { mode: "replace_range" });
  return { clipId: id, stops, frames };
}
