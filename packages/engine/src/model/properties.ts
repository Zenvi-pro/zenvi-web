/**
 * Property metadata: what the desktop Properties panel knows about each
 * editable property (libopenshot `PropertiesJSON`: display name, type, range,
 * choices), plus which properties are stored as keyframes.
 *
 * Clip and Mask tables are generated from libopenshot 1.0
 * (`libopenshot-defaults.data.ts`); effect tables live in `effects/`.
 */

import { LIBOPENSHOT_CLIP_PROPERTIES, LIBOPENSHOT_MASK_PROPERTIES } from "./libopenshot-defaults.data.js";

export interface PropertyChoice {
  name: string;
  value: number | string | boolean;
}

export interface PropertyMeta {
  /** Display name, e.g. "Scale X". */
  name: string;
  /**
   * libopenshot property type: "float", "int", "string", "color", "reader",
   * "font", "caption", "colorgrade_curve", "colorgrade_wheels", or null.
   */
  type: string | null;
  min: number | null;
  max: number | null;
  /** Stored as a keyframe (or a color keyframe) in the JSON. */
  keyframe: boolean;
  readonly: boolean;
  memo?: string;
  choices?: PropertyChoice[];
}

/** How a property's value is written, which decides how ops accept it. */
export type ValueKind =
  /** Keyframe of numbers. */
  | "keyframe"
  /** Color keyframe (per channel). */
  | "color"
  /** Plain number (int or float) or enum code. */
  | "number"
  | "bool"
  | "string"
  /** A reader object (mask image, displacement map…). */
  | "reader"
  /** Anything nested (color-grade curves/wheels, tracked objects). */
  | "object";

/** Classify a property from its metadata and its current/default value. */
export function valueKind(meta: PropertyMeta | undefined, current: unknown): ValueKind {
  if (meta?.type === "color") return "color";
  if (meta?.type === "reader") return "reader";
  if (meta?.type === "colorgrade_curve" || meta?.type === "colorgrade_wheels") return "object";
  if (meta?.keyframe) return "keyframe";
  if (typeof current === "boolean") return "bool";
  if (typeof current === "string") return "string";
  if (typeof current === "number") return "number";
  if (typeof current === "object" && current !== null) {
    if ("Points" in current) return "keyframe";
    if ("red" in current && "green" in current && "blue" in current) return "color";
    return "object";
  }
  if (meta?.type === "string" || meta?.type === "font" || meta?.type === "caption") return "string";
  if (meta?.type === "float" || meta?.type === "int") return "number";
  return "object";
}

/** True when a property offers named choices (desktop shows a dropdown and writes CONSTANT points). */
export function hasChoices(meta: PropertyMeta | undefined): boolean {
  return (meta?.choices?.length ?? 0) > 0;
}

/** Clip property metadata (libopenshot `Clip::PropertiesJSON`). */
export const CLIP_PROPERTIES: Readonly<Record<string, PropertyMeta>> = LIBOPENSHOT_CLIP_PROPERTIES;

/** Transition property metadata (libopenshot `Mask::PropertiesJSON`). */
export const TRANSITION_PROPERTIES: Readonly<Record<string, PropertyMeta>> = LIBOPENSHOT_MASK_PROPERTIES;

/**
 * Clip keys stored as keyframes. Includes `perspective_c*` (stored, not shown
 * in the Properties panel).
 */
export const CLIP_KEYFRAME_KEYS: readonly string[] = [
  "alpha",
  "channel_filter",
  "channel_mapping",
  "corner_radius",
  "has_audio",
  "has_video",
  "location_x",
  "location_y",
  "margin",
  "origin_x",
  "origin_y",
  "perspective_c1_x",
  "perspective_c1_y",
  "perspective_c2_x",
  "perspective_c2_y",
  "perspective_c3_x",
  "perspective_c3_y",
  "perspective_c4_x",
  "perspective_c4_y",
  "rotation",
  "scale_x",
  "scale_y",
  "shear_x",
  "shear_y",
  "time",
  "volume",
];

/** Clip keys stored as color keyframes. */
export const CLIP_COLOR_KEYS: readonly string[] = ["wave_color"];
