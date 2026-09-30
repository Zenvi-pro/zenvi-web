/**
 * Track (layer) operations.
 *
 * Ported from zenvi-core src/windows/main_window.py: actionAddTrack_trigger
 * (L2345), actionAddTrackAbove_trigger (L2358), actionAddTrackBelow_trigger
 * (L2405), renumber_all_layers (L2109), actionRemoveTrack_trigger (L3295),
 * actionLock/UnlockTrack_trigger (L3344), actionRenameTrack_trigger (L3368).
 *
 * Track numbers are spaced 1,000,000 apart; higher numbers draw on top. A new
 * track between two others takes the midpoint; when the gap is too small the
 * desktop renumbers every track (and moves their clips and transitions) first.
 * The desktop records that renumbering outside undo; here it is part of the
 * same transaction, so one undo restores the exact previous numbering.
 */

import type { Transaction } from "../history/document.js";
import type { Layer, Project } from "../model/types.js";
import { idFactory } from "../model/ids.js";
import { findLayerById } from "../model/query.js";
import { OpError, invalid, requireLayer } from "./errors.js";

/** Track number spacing (main_window.py `renumber_all_layers` stride). */
export const TRACK_STRIDE = 1_000_000;

export interface AddTrackOptions {
  /** Insert directly above this track number. */
  above?: number;
  /** Insert directly below this track number. */
  below?: number;
  label?: string;
  id?: string;
}

function sortedLayers(project: Project): Layer[] {
  return [...project.layers].sort((a, b) => a.number - b.number);
}

/**
 * Renumber every track to `(index + 1) * stride` bottom to top, leaving a
 * gap at `insertAt` (index into the ascending list). Clips and transitions
 * follow their track. Returns the number reserved for the gap.
 */
function renumberWithGap(tx: Transaction, insertAt: number): number {
  const tracks = sortedLayers(tx.project);
  const slots: (Layer | null)[] = [...tracks];
  slots.splice(Math.min(Math.max(insertAt, 0), slots.length), 0, null);

  const moves: { layer: Layer; from: number; to: number }[] = [];
  let reserved = TRACK_STRIDE;
  slots.forEach((layer, index) => {
    const number = (index + 1) * TRACK_STRIDE;
    if (layer === null) reserved = number;
    else if (layer.number !== number) moves.push({ layer, from: layer.number, to: number });
  });

  // Snapshot item membership before renumbering so a track that moves onto a
  // number another track just vacated does not pick up that track's items.
  const project = tx.project;
  const membership = moves.map(({ from }) => ({
    clips: project.clips.filter((c) => c.layer === from).map((c) => c.id),
    transitions: project.effects.filter((t) => t.layer === from).map((t) => t.id),
  }));
  moves.forEach(({ layer, to }, i) => {
    tx.update(["layers", { id: layer.id }], { number: to });
    for (const id of membership[i]!.clips) tx.update(["clips", { id }], { layer: to });
    for (const id of membership[i]!.transitions) tx.update(["effects", { id }], { layer: to });
  });
  return reserved;
}

/**
 * Add a track. With no reference track it goes on top (highest number +
 * 1,000,000). `above`/`below` insert next to an existing track, taking the
 * midpoint of the gap or renumbering when the gap is too small. Returns the
 * new track.
 */
export function addTrack(tx: Transaction, opts: AddTrackOptions = {}): Layer {
  if (opts.above !== undefined && opts.below !== undefined) {
    throw invalid("Give at most one of above / below.");
  }
  const project = tx.project;
  if (opts.id !== undefined && project.layers.some((l) => l.id === opts.id)) {
    throw new OpError("conflict", `A track with id ${opts.id} already exists.`, { id: opts.id });
  }
  const tracks = sortedLayers(project);
  let number: number;

  if (opts.above !== undefined || opts.below !== undefined) {
    const reference = requireLayer(project, (opts.above ?? opts.below)!);
    const index = tracks.findIndex((l) => l.id === reference.id);
    if (opts.above !== undefined) {
      const next = tracks[index + 1];
      const delta = next ? Math.abs(reference.number - next.number) : 2 * TRACK_STRIDE;
      number = delta > 2 ? reference.number + Math.round(delta / 2) : renumberWithGap(tx, index + 1);
    } else {
      const previous = index > 0 ? tracks[index - 1] : undefined;
      const delta = previous ? Math.abs(reference.number - previous.number) : reference.number;
      number = delta > 2 ? reference.number - Math.round(delta / 2) : renumberWithGap(tx, index);
    }
  } else {
    const top = tracks[tracks.length - 1];
    number = top ? top.number + TRACK_STRIDE : TRACK_STRIDE;
  }

  const id = opts.id ?? idFactory(tx.project)();
  const layer: Layer = {
    id,
    number,
    y: 0,
    label: opts.label ?? "",
    lock: false,
  };
  tx.insert(["layers"], layer);
  return findLayerById(tx.project, id)!;
}

export interface RemoveTrackResult {
  layer: Layer;
  removedClipIds: string[];
  removedTransitionIds: string[];
}

/**
 * Remove a track and every clip and transition on it (desktop Remove Track).
 * The last remaining track cannot be removed.
 */
export function removeTrack(tx: Transaction, layerNumber: number): RemoveTrackResult {
  const project = tx.project;
  const layer = requireLayer(project, layerNumber);
  if (project.layers.length <= 1) {
    throw new OpError("conflict", "You must keep at least 1 track.");
  }
  const clips = project.clips.filter((c) => c.layer === layerNumber).map((c) => c.id);
  const transitions = project.effects.filter((t) => t.layer === layerNumber).map((t) => t.id);
  for (const id of clips) tx.delete(["clips", { id }]);
  for (const id of transitions) tx.delete(["effects", { id }]);
  tx.delete(["layers", { id: layer.id }]);
  return { layer, removedClipIds: clips, removedTransitionIds: transitions };
}

/** Rename a track. An empty label shows the desktop default "Track N". */
export function renameTrack(tx: Transaction, layerNumber: number, label: string): Layer {
  const layer = requireLayer(tx.project, layerNumber);
  if (typeof label !== "string") throw invalid("label must be a string.");
  if (layer.label === label) return layer;
  tx.update(["layers", { id: layer.id }], { label });
  return requireLayer(tx.project, layerNumber);
}

/** Lock or unlock a track. Locked tracks refuse edits to their clips and transitions. */
export function setTrackLocked(tx: Transaction, layerNumber: number, locked: boolean): Layer {
  const layer = requireLayer(tx.project, layerNumber);
  if (typeof locked !== "boolean") throw invalid("locked must be a boolean.");
  if (layer.lock === locked) return layer;
  tx.update(["layers", { id: layer.id }], { lock: locked });
  return requireLayer(tx.project, layerNumber);
}

/**
 * The name the desktop shows for a track: its label, or "Track N" where N
 * counts from the bottom (main_window.py actionRenameTrack_trigger).
 */
export function trackDisplayName(project: Project, layerNumber: number): string {
  const tracks = sortedLayers(project);
  const index = tracks.findIndex((l) => l.number === layerNumber);
  const layer = tracks[index];
  if (layer?.label) return layer.label;
  return `Track ${index >= 0 ? index + 1 : layerNumber}`;
}
