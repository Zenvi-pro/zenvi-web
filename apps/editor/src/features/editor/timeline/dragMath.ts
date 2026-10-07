/**
 * What the timeline shows while a drag is in progress. The committed result
 * is always computed by the engine op (`moveClip`, `trimClipEdge`, …); these
 * functions only decide the preview and the values handed to the op, using
 * the engine's snapping (`snapEdges`, desktop snap.py tolerance).
 */
import { snapEdges, type SnapTarget } from "@zenvi/engine";

export interface SnapSettings {
  targets: readonly SnapTarget[];
  /** Seconds (the desktop's 12 px at the current zoom). */
  tolerance: number;
}

export interface DragItem {
  id: string;
  kind: "clip" | "transition";
  position: number;
  /** Length on the timeline, seconds. */
  duration: number;
  /** Row from the top. */
  trackIndex: number;
}

export interface MoveResult {
  /** Seconds to add to every dragged item's position. */
  dx: number;
  /** Rows to add to every dragged item's track index. */
  dTracks: number;
  /** Where the snap line goes (seconds), or null. */
  snapAt: number | null;
}

export function computeMove(
  items: readonly DragItem[],
  rawDx: number,
  rawDTracks: number,
  trackCount: number,
  snap: SnapSettings | null,
): MoveResult {
  if (items.length === 0) return { dx: 0, dTracks: 0, snapAt: null };
  let minIndex = Infinity;
  let maxIndex = -Infinity;
  let minPos = Infinity;
  for (const item of items) {
    minIndex = Math.min(minIndex, item.trackIndex);
    maxIndex = Math.max(maxIndex, item.trackIndex);
    minPos = Math.min(minPos, item.position);
  }
  const dTracks = Math.max(-minIndex, Math.min(trackCount - 1 - maxIndex, Math.round(rawDTracks)));
  let dx = Math.max(-minPos, rawDx);
  let snapAt: number | null = null;
  if (snap && snap.targets.length) {
    const edges: number[] = [];
    for (const item of items) edges.push(item.position + dx, item.position + item.duration + dx);
    const result = snapEdges(edges, snap.targets, snap.tolerance);
    if (result.target && minPos + dx + result.delta >= -1e-9) {
      dx += result.delta;
      snapAt = result.target.seconds;
    }
  }
  return { dx, dTracks, snapAt };
}

export interface TrimSubject {
  position: number;
  start: number;
  end: number;
  /** Source media length in seconds; null when unbounded (still images, titles). */
  mediaDuration: number | null;
}

export interface TrimResult {
  /** The dragged edge's timeline time, as passed to `trimClipEdge`. */
  time: number;
  position: number;
  start: number;
  end: number;
  snapAt: number | null;
}

/**
 * Preview of dragging one edge to `pointerTime`. Left keeps the content in
 * place on screen (position and start move together); right moves `end`.
 */
export function computeTrim(
  subject: TrimSubject,
  edge: "left" | "right",
  pointerTime: number,
  minDuration: number,
  snap: SnapSettings | null,
): TrimResult {
  let time = pointerTime;
  let snapAt: number | null = null;
  if (snap && snap.targets.length) {
    const result = snapEdges([pointerTime], snap.targets, snap.tolerance);
    if (result.target) {
      time = pointerTime + result.delta;
      snapAt = result.target.seconds;
    }
  }
  const { position, start, end, mediaDuration } = subject;
  const timelineEnd = position + (end - start);
  if (edge === "left") {
    const earliest = Math.max(0, position - start);
    const latest = timelineEnd - minDuration;
    const clamped = Math.min(latest, Math.max(earliest, time));
    if (clamped !== time) snapAt = null;
    return { time: clamped, position: clamped, start: start + (clamped - position), end, snapAt };
  }
  const earliest = position + minDuration;
  const latest = mediaDuration !== null ? position + (mediaDuration - start) : Infinity;
  const clamped = Math.min(latest, Math.max(earliest, time));
  if (clamped !== time) snapAt = null;
  return { time: clamped, position, start, end: start + (clamped - position), snapAt };
}

export interface Box {
  id: string;
  kind: "clip" | "transition";
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function normalizeRect(r: Rect): Rect {
  return { x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1) };
}

/** Items whose box intersects the marquee. */
export function marqueeHits(rect: Rect, boxes: readonly Box[]): { clips: string[]; transitions: string[] } {
  const r = normalizeRect(rect);
  const clips: string[] = [];
  const transitions: string[] = [];
  for (const b of boxes) {
    if (b.right < r.x0 || b.left > r.x1 || b.bottom < r.y0 || b.top > r.y1) continue;
    (b.kind === "clip" ? clips : transitions).push(b.id);
  }
  return { clips, transitions };
}

/** Which edge of an item a pointer is on, given the item's pixel box. */
export function edgeAt(x: number, left: number, right: number): "left" | "right" | null {
  const width = right - left;
  const zone = width < 18 ? Math.max(2, width / 4) : 7;
  if (x - left <= zone) return "left";
  if (right - x <= zone) return "right";
  return null;
}
