/**
 * Timeline arrangement edits on a selection: nudge, align, remove all gaps,
 * and the clip Crop menu.
 *
 * Ported from zenvi-core src/windows/views/timeline.py (Nudge_Triggered,
 * Align_Triggered, RemoveAllGaps_Triggered, Crop_Triggered); the align and
 * gap rules are develop 1f80cb3d0's timeline_ops.aligned_positions and
 * close_all_gaps, which the menus and the timeline-edit tools share.
 */

import type { Transaction } from "../history/document.js";
import type { Clip, Effect, Transition } from "../model/types.js";
import { findClip, findLayer, findTransition } from "../model/query.js";
import { createEffect } from "../effects/registry.js";
import { itemsOnLayer } from "../timeline/queries.js";
import { OpError, invalid, requireFinite, requireUnlocked } from "./errors.js";
import { ids, patchClip, patchTransition, rateOf, requireEditableClip } from "./internal.js";

type Item = { kind: "clip"; item: Clip } | { kind: "transition"; item: Transition };

function selection(tx: Transaction, itemIds: readonly string[]): Item[] {
  if (!Array.isArray(itemIds) || itemIds.length === 0) throw invalid("Give the clips or transitions to move.");
  const items: Item[] = [];
  for (const id of new Set(itemIds)) {
    const clip = findClip(tx.project, id);
    const transition = clip ? undefined : findTransition(tx.project, id);
    if (!clip && !transition) throw new OpError("not_found", `No clip or transition with id ${id}.`, { id });
    requireUnlocked(tx.project, (clip ?? transition)!.layer);
    items.push(clip ? { kind: "clip", item: clip } : { kind: "transition", item: transition! });
  }
  return items;
}

function move(tx: Transaction, entry: Item, position: number): void {
  if (entry.kind === "clip") patchClip(tx, entry.item.id, { position });
  else patchTransition(tx, entry.item.id, { position });
}

/** Move clips/transitions by whole frames (desktop Ctrl+←/→), never before 0. */
export function nudgeItems(tx: Transaction, itemIds: readonly string[], frames: number): string[] {
  const n = requireFinite(frames, "frames");
  if (!Number.isInteger(n)) throw invalid("frames must be an integer.");
  const items = selection(tx, itemIds);
  const delta = n / rateOf(tx.project);
  for (const entry of items) move(tx, entry, Math.max(Number(entry.item.position) + delta, 0));
  return items.map((e) => e.item.id);
}

interface Spanned {
  id: string;
  position: number;
  start: number;
  end: number;
}

/**
 * New positions that line up the starts (or, with `alignRight`, the ends) of
 * clips/transitions: at the earliest start / latest end among them, or at
 * `toSeconds` (zenvi-core develop timeline_ops.aligned_positions, behind Clip
 * menu ▸ Align Left / Right and align_clips_tool). Pure.
 */
export function alignedPositions(items: readonly Spanned[], alignRight: boolean, toSeconds?: number): Map<string, number> {
  const spans = items.map((item) => {
    const start = Number(item.position) || 0;
    return { id: item.id, start, end: start + Math.max(0, (Number(item.end) || 0) - (Number(item.start) || 0)) };
  });
  const out = new Map<string, number>();
  if (spans.length === 0) return out;
  const target =
    toSeconds !== undefined
      ? requireFinite(toSeconds, "toSeconds")
      : alignRight
        ? Math.max(...spans.map((s) => s.end))
        : Math.min(...spans.map((s) => s.start));
  for (const span of spans) out.set(span.id, alignRight ? span.start + (target - span.end) : target);
  return out;
}

/** Align a selection's left edges to the left-most item, or right edges to the right-most (desktop Align). */
export function alignItems(tx: Transaction, itemIds: readonly string[], edge: "left" | "right"): string[] {
  if (edge !== "left" && edge !== "right") throw invalid('edge must be "left" or "right".');
  const items = selection(tx, itemIds);
  const positions = alignedPositions(
    items.map((e) => e.item),
    edge === "right",
  );
  for (const entry of items) move(tx, entry, positions.get(entry.item.id)!);
  return items.map((e) => e.item.id);
}

/** Positions closer than this are the same instant (timeline_ops.EPSILON). */
const EPSILON = 1e-6;

/**
 * zenvi-core develop timeline_ops.close_all_gaps: pack `layer` from
 * `fromSeconds` on, moving overlapping items (crossfades) together as a
 * group. Returns the time removed and the moved item ids.
 */
function packTrack(tx: Transaction, layer: number, fromSeconds: number): { removed: number; moved: string[] } {
  const project = tx.project;
  requireFinite(fromSeconds, "fromSeconds");
  if (!findLayer(project, layer)) throw new OpError("not_found", `No track with number ${layer}.`, { layer });
  requireUnlocked(project, layer);
  const items = itemsOnLayer(project, layer);
  const clipIds = new Set(project.clips.map((c) => c.id));
  const groups: { start: number; end: number; items: (Clip | Transition)[] }[] = [];
  for (const item of items) {
    const leftEdge = Number(item.position);
    const rightEdge = leftEdge + (Number(item.end) - Number(item.start));
    const current = groups[groups.length - 1];
    if (current && leftEdge <= current.end) {
      current.items.push(item);
      current.end = Math.max(current.end, rightEdge);
    } else {
      groups.push({ start: leftEdge, end: rightEdge, items: [item] });
    }
  }
  let lastEnd = fromSeconds;
  let offset = 0;
  const moved: string[] = [];
  for (const group of groups) {
    if (group.end <= fromSeconds) {
      lastEnd = Math.max(lastEnd, group.end);
      continue;
    }
    const shiftedStart = group.start - offset;
    if (shiftedStart > lastEnd) offset += shiftedStart - lastEnd;
    if (offset > EPSILON) {
      for (const item of group.items) {
        tx.update([clipIds.has(item.id) ? "clips" : "effects", { id: item.id }], { position: Number(item.position) - offset });
        moved.push(item.id);
      }
    }
    lastEnd = group.end - offset;
  }
  return { removed: offset > EPSILON ? offset : 0, moved };
}

/**
 * Close every gap on `layer` from `fromSeconds` on (desktop Remove All
 * Gaps): items that overlap travel together as a group. Returns the total
 * time removed (0 records nothing).
 */
export function removeAllGaps(tx: Transaction, layer: number, fromSeconds = 0): number {
  return packTrack(tx, layer, fromSeconds).removed;
}

/** `removeAllGaps`, returning the ids of the clips and transitions it moved (remove_gaps_tool). */
export function closeAllGaps(tx: Transaction, layer: number, fromSeconds = 0): string[] {
  return packTrack(tx, layer, fromSeconds).moved;
}

/**
 * The clip Crop menu (desktop Crop_Triggered): `none` removes the clip's Crop
 * effect; `crop` / `resize` add one if needed and set its `resize` flag.
 * Returns the Crop effect, or null after `none`.
 */
export function setClipCrop(tx: Transaction, clipId: string, mode: "none" | "crop" | "resize"): Effect | null {
  const clip = requireEditableClip(tx.project, clipId);
  if (mode !== "none" && mode !== "crop" && mode !== "resize") throw invalid("mode must be none, crop or resize.");
  const effects = [...(clip.effects ?? [])];
  const index = effects.findIndex((e) => e.class_name === "Crop");
  if (mode === "none") {
    if (index >= 0) {
      effects.splice(index, 1);
      patchClip(tx, clipId, { effects });
    }
    return null;
  }
  const resize = mode === "resize";
  if (index >= 0) {
    effects[index] = { ...effects[index]!, resize };
  } else {
    effects.push({ ...createEffect("Crop", {}, { id: ids(tx.project)() }), resize });
  }
  const next = patchClip(tx, clipId, { effects });
  return next.effects.find((e) => e.class_name === "Crop")!;
}
