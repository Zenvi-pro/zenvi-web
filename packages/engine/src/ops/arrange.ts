/**
 * Timeline arrangement edits on a selection: nudge, align, remove all gaps,
 * and the clip Crop menu.
 *
 * Ported from zenvi-core src/windows/views/timeline.py (Nudge_Triggered,
 * Align_Triggered, RemoveAllGaps_Triggered, Crop_Triggered).
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

/** Align a selection's left edges to the left-most item, or right edges to the right-most (desktop Align). */
export function alignItems(tx: Transaction, itemIds: readonly string[], edge: "left" | "right"): string[] {
  if (edge !== "left" && edge !== "right") throw invalid('edge must be "left" or "right".');
  const items = selection(tx, itemIds);
  let left = -1;
  let right = -1;
  for (const { item } of items) {
    const position = Number(item.position);
    const end = position + (Number(item.end) - Number(item.start));
    if (position < left || left === -1) left = position;
    if (end > right || right === -1) right = end;
  }
  for (const entry of items) {
    const position = Number(entry.item.position);
    const end = position + (Number(entry.item.end) - Number(entry.item.start));
    move(tx, entry, edge === "left" ? left : position + (right - end));
  }
  return items.map((e) => e.item.id);
}

/**
 * Close every gap on `layer` from `fromSeconds` on (desktop Remove All
 * Gaps): items that overlap travel together as a group. Returns the total
 * time removed (0 records nothing).
 */
export function removeAllGaps(tx: Transaction, layer: number, fromSeconds = 0): number {
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
  for (const group of groups) {
    if (group.end <= fromSeconds) {
      lastEnd = Math.max(lastEnd, group.end);
      continue;
    }
    const shiftedStart = group.start - offset;
    if (shiftedStart > lastEnd) offset += shiftedStart - lastEnd;
    if (offset > 0) {
      for (const item of group.items) {
        tx.update([clipIds.has(item.id) ? "clips" : "effects", { id: item.id }], { position: Number(item.position) - offset });
      }
    }
    lastEnd = group.end - offset;
  }
  return offset;
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
