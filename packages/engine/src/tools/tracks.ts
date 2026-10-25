/**
 * How agents name tracks.
 *
 * Port of zenvi-core src/classes/track_display.py (ref b63c39be7). Z-order
 * comes only from the layer `number` (higher covers lower); the label is
 * cosmetic. An agent may pass a layer_number, a track id, the exact label, or
 * a ui_track index counted from the bottom (1 = bottom).
 */

import type { Layer } from "../model/types.js";
import { parsePythonFloat } from "./coerce.js";
import { pyReprString } from "./pyfmt.js";

function layerNumber(layer: Pick<Layer, "number">): number {
  const n = Math.trunc(Number(layer.number));
  return Number.isFinite(n) ? n : 0;
}

/** Ascending by layer number; the bottom of the stack first. */
export function layersSortedByNumber<L extends Pick<Layer, "number">>(layers: readonly L[] | null | undefined): L[] {
  return [...(layers ?? [])].sort((a, b) => layerNumber(a) - layerNumber(b));
}

/** 1-based index from the bottom for a layer number, or null when no track has it. */
export function layerNumberToDisplayIndex(layerNum: number, layers: readonly Layer[] | null | undefined): number | null {
  const asc = layersSortedByNumber(layers);
  const index = asc.findIndex((l) => layerNumber(l) === Math.trunc(layerNum));
  return index < 0 ? null : index + 1;
}

export interface TrackStackEntry {
  layer_number: number;
  ui_track: number;
  z_from_bottom: number;
  label: string;
  track_id: string;
}

/** The live track stack, bottom to top (track_display.build_track_stack). */
export function buildTrackStack(layers: readonly Layer[] | null | undefined): TrackStackEntry[] {
  return layersSortedByNumber(layers).map((layer, i) => ({
    layer_number: layerNumber(layer),
    ui_track: i + 1,
    z_from_bottom: i,
    label: String(layer.label || (layer as { name?: unknown }).name || "").trim(),
    track_id: String(layer.id ?? ""),
  }));
}

/** `json.dumps(build_track_stack(layers), separators=(",", ":"))`. */
export function trackStackJson(layers: readonly Layer[] | null | undefined): string {
  // Python json.dumps escapes non-ASCII by default (ensure_ascii=True).
  return JSON.stringify(buildTrackStack(layers)).replace(/[\u0080-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export type TrackResolution = { layer: number; error?: undefined } | { layer?: undefined; error: string } | { layer?: undefined; error?: undefined };

/**
 * Resolve an agent's track reference against the live layers
 * (track_display.normalize_track_or_layer_arg). Empty input resolves to
 * nothing (no layer, no error).
 */
export function normalizeTrackOrLayerArg(raw: string | number | null | undefined, layers: readonly Layer[] | null | undefined): TrackResolution {
  const text = String(raw ?? "").trim();
  if (!text) return {};
  const all = layers ?? [];
  if (all.length === 0) return { error: "Error: No tracks in project." };

  const stack = buildTrackStack(all);
  const numbers = new Set(stack.map((e) => e.layer_number));
  // Python int(float(raw)).
  const parsed = parsePythonFloat(text);
  const n = parsed === null ? null : Math.trunc(parsed);

  // 1) a real layer_number
  if (n !== null && numbers.has(n)) return { layer: n };

  // 2) a track_id from TRACK_STACK_JSON
  const idHits = stack.filter((e) => e.track_id.trim() && e.track_id.trim().toLowerCase() === text.toLowerCase());
  if (idHits.length === 1) return { layer: idHits[0]!.layer_number };

  // 3) the label (labels may be numeric, e.g. "5")
  const low = text.toLowerCase();
  const m = /^(?:ui\s*)?track\s*[#:]?\s*(.+)$/i.exec(low);
  const labelQuery = (m ? m[1]!.trim() : low).trim();
  // "2", "track 2" and "Track #2" all name UI track 2 unless a label says otherwise (develop 1f80cb3d0).
  let uiNumber = n;
  if (uiNumber === null && m) {
    const q = parsePythonFloat(labelQuery);
    uiNumber = q === null ? null : Math.trunc(q);
  }
  const labelHits = stack.filter((e) => {
    const label = e.label.trim().toLowerCase();
    return label === labelQuery || label === low;
  });
  if (labelHits.length === 1) return { layer: labelHits[0]!.layer_number };
  if (labelHits.length > 1) {
    return {
      error:
        `Error: Ambiguous track label ${pyReprString(text)} matches multiple layers. ` +
        "Pass layer_number from list_layers_tool / TRACK_STACK_JSON.",
    };
  }
  // A number never matches part of a name: "1" is UI track 1, not "Music 1".
  const contains = stack.filter((e) => labelQuery && uiNumber === null && e.label.trim().toLowerCase().includes(labelQuery));
  if (contains.length === 1) return { layer: contains[0]!.layer_number };

  // 4) ui_track counted from the bottom
  if (uiNumber !== null && uiNumber >= 1 && uiNumber <= stack.length) return { layer: stack[uiNumber - 1]!.layer_number };

  return {
    error:
      `Error: Unknown track or layer ${pyReprString(text)}. ` +
      "Call list_layers_tool and use layer_number (preferred), track_id, " +
      "ui_track (1=bottom), or the exact label.",
  };
}

/** e.g. `1000000 (stack_from_bottom=1, z_from_bottom=0, label='Hero')` (track_display.format_track_label_for_llm). */
export function formatTrackLabelForLlm(layerNum: number, layers: readonly Layer[] | null | undefined): string {
  for (const e of buildTrackStack(layers)) {
    if (e.layer_number === Math.trunc(layerNum)) {
      const labelPart = e.label ? `, label=${pyReprString(e.label)}` : "";
      return `${layerNum} (stack_from_bottom=${e.ui_track}, z_from_bottom=${e.z_from_bottom}${labelPart})`;
    }
  }
  return String(layerNum);
}

/** Lowest layer number (clip_placement.default_underlay_layer_number); 1 without tracks. */
export function defaultUnderlayLayerNumber(layers: readonly Layer[] | null | undefined): number {
  const asc = layersSortedByNumber(layers);
  return asc.length > 0 ? layerNumber(asc[0]!) : 1;
}

/** "Error: Track … is locked." when `layerNum` is a locked track, else "" (tool_handlers._locked_track_error). */
export function lockedTrackError(layerNum: number, layers: readonly Layer[] | null | undefined): string {
  for (const layer of layers ?? []) {
    if (layerNumber(layer) === Math.trunc(layerNum) && Boolean(layer.lock)) {
      return `Error: Track ${formatTrackLabelForLlm(layerNum, layers)} is locked.`;
    }
  }
  return "";
}
