/**
 * Timeline markers.
 *
 * Desktop: zenvi-core src/windows/main_window.py actionAddMarker_trigger
 * (L2496) writes `{position, icon: "blue.png", vector: "blue"}`; the marker
 * menu's Remove deletes it.
 */

import type { Transaction } from "../history/document.js";
import type { Marker } from "../model/types.js";
import { idFactory } from "../model/ids.js";
import { findMarker } from "../model/query.js";
import { OpError, requireMarker, requireNonNegative } from "./errors.js";

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
