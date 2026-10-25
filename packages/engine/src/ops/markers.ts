/**
 * Timeline markers.
 *
 * Desktop: zenvi-core src/windows/main_window.py actionAddMarker_trigger
 * (L2496) writes `{position, icon: "blue.png", vector: "blue"}`; the marker
 * menu's Remove deletes it. Names, colours, edits and removal follow
 * develop 1f80cb3d0 src/classes/track_ops.py (marker_color, update_marker,
 * remove_markers, markers_in_time_order). The desktop stores a marker's name
 * as `name`; markers the web's add_marker_tool creates keep it as `label`
 * (what the web editor's ruler shows), so a name is read from either and
 * written where the marker keeps it.
 */

import type { Transaction } from "../history/document.js";
import type { Marker } from "../model/types.js";
import { idFactory } from "../model/ids.js";
import { findMarker } from "../model/query.js";
import { OpError, invalid, requireMarker, requireNonNegative } from "./errors.js";

/** Marker colour tags, stored like the Add Marker action's default (`{icon: "blue.png", vector: "blue"}`). */
export const MARKER_COLORS = ["blue", "red", "green", "yellow", "orange", "purple", "pink", "white"] as const;
export type MarkerColor = (typeof MARKER_COLORS)[number];
export const DEFAULT_MARKER_COLOR: MarkerColor = "blue";

/** A marker's colour tag (track_ops.marker_color): its vector, else its icon's name. */
export function markerColor(marker: Partial<Marker>): string {
  const vector = String(marker.vector ?? "").trim().toLowerCase();
  if (vector) return vector;
  const icon = String(marker.icon ?? "").trim().toLowerCase();
  return icon.endsWith(".png") ? icon.slice(0, -4) : icon || DEFAULT_MARKER_COLOR;
}

/** A marker's name: the desktop's `name`, else the web editor's `label`. */
export function markerName(marker: Partial<Marker>): string {
  const name = (marker as Record<string, unknown>).name;
  return String(name ?? marker.label ?? "");
}

/** Every marker as {id, position, name, color}, earliest first (track_ops.markers_in_time_order). */
export function markersInTimeOrder(markers: readonly Marker[]): { id: string; position: number; name: string; color: string }[] {
  return markers
    .map((m) => ({ id: String(m.id), position: Number(m.position) || 0, name: markerName(m), color: markerColor(m) }))
    .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface MarkerChanges {
  /** New name ("" clears it). */
  name?: string;
  color?: MarkerColor;
  /** New position, seconds. */
  position?: number;
}

/**
 * Rename, recolour or move a marker (track_ops.update_marker). Returns the
 * keys that changed ("name", "color", "position"); none = nothing recorded.
 */
export function updateMarker(tx: Transaction, markerId: string, changes: MarkerChanges): ("name" | "color" | "position")[] {
  const marker = requireMarker(tx.project, markerId);
  const patch: Record<string, unknown> = {};
  const changed: ("name" | "color" | "position")[] = [];
  if (changes.name !== undefined && markerName(marker) !== changes.name) {
    // Write the name where the marker keeps it: `name` (desktop) or `label` (the web's markers).
    const data = marker as Record<string, unknown>;
    const keys = ["name", "label"].filter((k) => k in data);
    for (const key of keys.length > 0 ? keys : ["label"]) patch[key] = changes.name;
    changed.push("name");
  }
  if (changes.color !== undefined) {
    if (!(MARKER_COLORS as readonly string[]).includes(changes.color)) throw invalid(`marker color must be one of ${MARKER_COLORS.join(", ")}`);
    if (markerColor(marker) !== changes.color) {
      patch.icon = `${changes.color}.png`;
      patch.vector = changes.color;
      changed.push("color");
    }
  }
  if (changes.position !== undefined) {
    requireNonNegative(changes.position, "position");
    if (Math.abs((Number(marker.position) || 0) - changes.position) > 1e-9) {
      patch.position = changes.position;
      changed.push("position");
    }
  }
  if (changed.length > 0) tx.update(["markers", { id: markerId }], patch);
  return changed;
}

/** Delete markers by id (Marker menu ▸ Remove Marker). Returns the ids removed. */
export function removeMarkers(tx: Transaction, markerIds: readonly string[]): string[] {
  const removed: string[] = [];
  for (const id of markerIds) {
    if (!findMarker(tx.project, id)) continue;
    tx.delete(["markers", { id }]);
    removed.push(id);
  }
  return removed;
}

export interface AddMarkerOptions {
  /** Desktop marker icon file. Default `"blue.png"`. */
  icon?: string;
  /** Desktop marker color name. Default `"blue"`. */
  vector?: string;
  id?: string;
}

/** Add a marker at `position` seconds. Returns the new marker. */
export function addMarker(tx: Transaction, position: number, label?: string, opts: AddMarkerOptions = {}): Marker {
  requireNonNegative(position, "position");
  if (label !== undefined && typeof label !== "string") {
    throw new OpError("invalid_argument", "label must be a string.");
  }
  if (opts.id !== undefined && findMarker(tx.project, opts.id)) {
    throw new OpError("conflict", `A marker with id ${opts.id} already exists.`, { id: opts.id });
  }
  const id = opts.id ?? idFactory(tx.project)();
  const marker: Marker = {
    id,
    position,
    icon: opts.icon ?? "blue.png",
    vector: opts.vector ?? "blue",
  };
  if (label !== undefined && label !== "") marker.label = label;
  tx.insert(["markers"], marker);
  return findMarker(tx.project, id)!;
}

/** Remove a marker. Returns its id. */
export function removeMarker(tx: Transaction, markerId: string): string {
  requireMarker(tx.project, markerId);
  tx.delete(["markers", { id: markerId }]);
  return markerId;
}

/** Move a marker to `position` seconds. */
export function moveMarker(tx: Transaction, markerId: string, position: number): Marker {
  const marker = requireMarker(tx.project, markerId);
  requireNonNegative(position, "position");
  if (marker.position === position) return marker;
  tx.update(["markers", { id: markerId }], { position });
  return requireMarker(tx.project, markerId);
}
