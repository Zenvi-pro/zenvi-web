/**
 * Edits on a run of clips that the timeline-edit tools share with the Track
 * and Clip menus: where a track ends, closing one gap, shifting everything
 * after a time (ripple), the overlaps an edit would create, the crossfades
 * inside a selection, mapping a selection's tracks onto another track, and
 * placing copies.
 *
 * Ported from zenvi-core develop 1f80cb3d0 src/classes/timeline_ops.py
 * (track_end, shift_after) and
 * src/classes/editor_tools/timeline_edit_common.py (new_overlaps,
 * transitions_between, remap_layers) plus the copy step of
 * timeline_edit.py `duplicate_clips`. The other gap and align rules live in
 * clips.ts (`closeGap`), arrange.ts (`closeAllGaps`, `alignedPositions`)
 * and timeline/queries.ts (`listGaps`).
 */

import type { Transaction } from "../history/document.js";
import type { Clip, Project, Transition } from "../model/types.js";
import { findLayer, findTransition } from "../model/query.js";
import { itemsOnLayer, sortedLayers } from "../timeline/queries.js";
import { duplicateClip } from "./clips.js";
import { TRACK_STRIDE } from "./tracks.js";
import { OpError, invalid, requireClip, requireFinite, requireUnlocked } from "./errors.js";
import { ids, patchClip, patchTransition, snapSeconds } from "./internal.js";

/** Positions closer than this are the same instant (timeline_ops.EPSILON). */
export const SEQUENCE_EPSILON = 1e-6;

interface Timed {
  position: number;
  start: number;
  end: number;
}

/** timeline_ops.item_span: [position, position + max(0, end - start)). */
function span(item: Timed): [number, number] {
  const position = Number(item.position) || 0;
  return [position, position + Math.max(0, (Number(item.end) || 0) - (Number(item.start) || 0))];
}

function requireTrack(project: Project, layer: number): void {
  if (!findLayer(project, layer)) throw new OpError("not_found", `No track with number ${layer}.`, { layer });
  requireUnlocked(project, layer);
}

function moveItem(tx: Transaction, item: Clip | Transition, position: number): void {
  if (tx.project.clips.some((c) => c.id === item.id)) patchClip(tx, item.id, { position });
  else patchTransition(tx, item.id, { position });
}

/** timeline_ops.track_end: where the last clip on `layer` ends (0 when it has none). */
export function trackEnd(project: Project, layer: number, excludeIds: ReadonlySet<string> = new Set()): number {
  let end = 0;
  for (const clip of project.clips) {
    if (clip.layer === layer && !excludeIds.has(clip.id)) end = Math.max(end, span(clip)[1]);
  }
  return end;
}

/**
 * timeline_ops.shift_after: every clip and transition on `layer` starting
 * at or after `fromSeconds` moves by `amount` seconds (positive opens room,
 * negative closes it; never before 0). Returns the moved ids.
 */
export function shiftAfter(
  tx: Transaction,
  layer: number,
  fromSeconds: number,
  amount: number,
  excludeIds: ReadonlySet<string> = new Set(),
): string[] {
  requireFinite(fromSeconds, "fromSeconds");
  requireFinite(amount, "amount");
  if (Math.abs(amount) <= SEQUENCE_EPSILON) return [];
  requireTrack(tx.project, layer);
  const moved: string[] = [];
  for (const item of itemsOnLayer(tx.project, layer)) {
    if (excludeIds.has(item.id) || !(item.position >= fromSeconds - SEQUENCE_EPSILON)) continue;
    moveItem(tx, item, Math.max(0, item.position + amount));
    moved.push(item.id);
  }
  return moved;
}

/** Where a clip would be after a planned edit. */
export interface PlannedSpan {
  layer: number;
  start: number;
  end: number;
}

/** A clip about to be created (`label` names it in the overlap report). */
export interface PlannedItem extends PlannedSpan {
  label: string;
}

/** One overlap a planned edit would create or grow. */
export interface OverlapHit {
  /** The changed clip's id, or a planned item's label. */
  clipId: string;
  title: string;
  /** The clip it would cover. */
  overlapsId: string;
  overlapsTitle: string;
  /** Track number of both. */
  layer: number;
  /** How much they would overlap, seconds. */
  seconds: number;
}

function clipTitle(clip: Clip): string {
  return String(clip.title || clip.id);
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/**
 * The clip overlaps a planned edit would create or grow on a track
 * (timeline_edit_common.new_overlaps). `changes` holds where existing clips
 * would go, `newItems` clips about to be created. Overlaps that already
 * existed (a crossfade pair) are fine unless they grow; transitions never
 * count. Pure.
 */
export function plannedOverlaps(
  project: Project,
  changes: ReadonlyMap<string, PlannedSpan>,
  newItems: readonly PlannedItem[],
  tolerance: number,
): OverlapHit[] {
  type Row = { layer: number; start: number; end: number; title: string };
  const before = new Map<string, Row>();
  for (const clip of project.clips) {
    const [start, end] = span(clip);
    before.set(clip.id, { layer: clip.layer, start, end, title: clipTitle(clip) });
  }
  const after = new Map(before);
  for (const [id, planned] of changes) {
    after.set(id, { layer: planned.layer, start: planned.start, end: planned.end, title: before.get(id)?.title ?? id });
  }
  const hits: OverlapHit[] = [];
  const checked = new Set<string>();
  for (const id of changes.keys()) {
    const row = after.get(id)!;
    for (const [otherId, other] of after) {
      if (otherId === id || other.layer !== row.layer || checked.has(`${otherId}\u0000${id}`)) continue;
      checked.add(`${id}\u0000${otherId}`);
      const amount = overlap(row.start, row.end, other.start, other.end);
      if (amount <= tolerance) continue;
      const was0 = before.get(id);
      const was1 = before.get(otherId);
      const was = was0 && was1 && was0.layer === was1.layer ? overlap(was0.start, was0.end, was1.start, was1.end) : 0;
      if (amount > was + tolerance) {
        hits.push({ clipId: id, title: row.title, overlapsId: otherId, overlapsTitle: other.title, layer: row.layer, seconds: amount });
      }
    }
  }
  for (const item of newItems) {
    for (const [otherId, other] of after) {
      if (other.layer !== item.layer) continue;
      const amount = overlap(item.start, item.end, other.start, other.end);
      if (amount > tolerance) {
        hits.push({ clipId: item.label, title: item.label, overlapsId: otherId, overlapsTitle: other.title, layer: item.layer, seconds: amount });
      }
    }
  }
  return hits;
}

/**
 * Transitions lying where two of the given clips overlap on one track: the
 * crossfades inside a selection (timeline_edit_common.transitions_between).
 * A clip's incoming or outgoing crossfade overlaps only that clip among the
 * selected ones, so it belongs to the neighbour and is left out. Pure.
 */
export function transitionsBetween(project: Project, clipIds: readonly string[], tolerance: number): Transition[] {
  const spans = clipIds.map((id) => {
    const clip = requireClip(project, id);
    const [start, end] = span(clip);
    return { id, layer: clip.layer, start, end };
  });
  const layers = new Set(spans.map((s) => s.layer));
  return project.effects.filter((transition) => {
    if (!layers.has(transition.layer)) return false;
    const [t0, t1] = span(transition);
    const under = spans.filter((s) => s.layer === transition.layer && s.start < t1 - tolerance && s.end > t0 + tolerance);
    return under.length >= 2;
  });
}

/**
 * Map a selection's tracks onto `destLayer`, keeping their stacking: the
 * top-most source track lands on the destination and the others keep their
 * offsets below/above it, like paste (timeline_edit_common.remap_layers).
 * `newOnTop` counts tracks the caller will add above the stack (each one
 * TRACK_STRIDE above the last), so a destination past the top maps too.
 * Null when a mapped track does not exist. Pure.
 */
export function remapLayers(project: Project, sourceLayers: Iterable<number>, destLayer: number, newOnTop = 0): Map<number, number> | null {
  const order = sortedLayers(project).map((l) => l.number);
  const top = order.length > 0 ? order[order.length - 1]! : 0;
  for (let k = 1; k <= newOnTop; k += 1) order.push(top + k * TRACK_STRIDE);
  const sources = [...new Set(sourceLayers)].sort((a, b) => a - b);
  const destIndex = order.indexOf(destLayer);
  if (sources.length === 0 || destIndex < 0) return null;
  const highest = sources.reduce((best, n) => (order.indexOf(n) > order.indexOf(best) ? n : best), sources[0]!);
  const offset = destIndex - order.indexOf(highest);
  const out = new Map<number, number>();
  for (const n of sources) {
    const at = order.indexOf(n);
    const index = at + offset;
    if (at < 0 || index < 0 || index >= order.length) return null;
    out.set(n, order[index]!);
  }
  return out;
}

/** Where the copy of one clip or transition goes. */
export interface CopyPlacement {
  id: string;
  /** Timeline start of the copy, seconds (snapped to the frame grid). */
  position: number;
  /** Track of the copy. Default: the original's track. */
  layer?: number;
}

export interface DuplicateItemsInput {
  /** Clips to copy, in the order the copies are made. */
  clips: readonly CopyPlacement[];
  /** Transitions to copy with them (the crossfades between them). */
  transitions?: readonly CopyPlacement[];
}

export interface DuplicateItemsResult {
  /** The copies, in `clips` order, with the id each copies. */
  clips: { copy: Clip; of: string }[];
  transitionIds: string[];
}

/**
 * Copy clips and transitions to new places, with new clip, effect and
 * transition ids (desktop Copy + Paste; one pass of duplicate_clips_tool).
 * The destination tracks must exist and be unlocked; the sources may be
 * locked.
 */
export function duplicateItems(tx: Transaction, input: DuplicateItemsInput): DuplicateItemsResult {
  const project = tx.project;
  const clips = input.clips.map((p) => ({ item: requireClip(project, p.id), p }));
  const transitions = (input.transitions ?? []).map((p) => {
    const item = findTransition(project, p.id);
    if (!item) throw new OpError("not_found", `No transition with id ${p.id}.`, { id: p.id });
    return { item, p };
  });
  for (const { item, p } of [...clips, ...transitions]) {
    if (requireFinite(p.position, "position") < -SEQUENCE_EPSILON) throw invalid(`A copy of ${item.id} would start before 0 s.`);
    requireTrack(project, p.layer ?? item.layer);
  }
  const result: DuplicateItemsResult = { clips: [], transitionIds: [] };
  for (const { item, p } of clips) {
    result.clips.push({ copy: duplicateClip(tx, item.id, { position: Math.max(0, p.position), layer: p.layer ?? item.layer }), of: item.id });
  }
  for (const { item, p } of transitions) {
    const copy = structuredClone(item) as Transition;
    copy.id = ids(tx.project)();
    copy.position = snapSeconds(Math.max(0, p.position), tx.project);
    copy.layer = p.layer ?? item.layer;
    tx.insert(["effects"], copy);
    result.transitionIds.push(copy.id);
  }
  return result;
}
