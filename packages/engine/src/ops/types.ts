/**
 * Shared argument and result types for editing operations.
 */

import type { Clip, Coordinate, HandleType, Interpolation, Transition } from "../model/types.js";

/** Which edge of a timeline item. */
export type Edge = "left" | "right";

/** Desktop slice modes (MenuSlice KEEP_BOTH / KEEP_LEFT / KEEP_RIGHT). */
export type SliceKeep = "both" | "left" | "right";

/**
 * Where a keyframed value is written. Give at most one of `frame` / `time`;
 * with neither, the property becomes a constant (every point replaced by one).
 */
export interface KeyframeAt {
  /**
   * Keyframe X: 1-based frame at the project frame rate, in the object's own
   * frame space. Clips: frame 1 = source time 0, so a timeline time t maps to
   * `round((t - position + start) * fps) + 1`. Transitions: frame 1 = the
   * transition's start.
   */
  frame?: number;
  /** Timeline seconds; converted to `frame` the way the desktop Properties panel does. */
  time?: number;
  /**
   * Interpolation of a newly created point. Defaults to the desktop Properties
   * panel's choice (zenvi-core src/windows/models/properties_model.py:1000):
   * LINEAR for numeric values, CONSTANT for choice properties. An existing
   * point at the same frame keeps its interpolation unless this is given
   * (choice properties always become CONSTANT).
   */
  interpolation?: Interpolation;
}

/** One point for bulk keyframe writes. Give exactly one of `frame` / `time`. */
export interface KeyframePointInput {
  /** Keyframe X (see `KeyframeAt.frame`). */
  frame?: number;
  /** Timeline seconds (see `KeyframeAt.time`). */
  time?: number;
  value: number;
  /** Default BEZIER (libopenshot `Point` default). */
  interpolation?: Interpolation;
  handleLeft?: Coordinate;
  handleRight?: Coordinate;
  handleType?: HandleType;
}

/**
 * A color: `#rgb`, `#rrggbb`, `#rrggbbaa`, or channels 0..255
 * (libopenshot `Color` keyframes store one keyframe per channel).
 */
export type ColorInput = string | { red: number; green: number; blue: number; alpha?: number };

/**
 * A property value. Keyframed and numeric properties take numbers; color
 * properties take a `ColorInput`; text and file properties take strings;
 * flags take booleans.
 */
export type PropertyValue = number | string | boolean | ColorInput;

/**
 * What a copy holds (desktop Copy menu): whole items, or one property group
 * (Copy ▸ Keyframes ▸ All/Alpha/Scale/Shear/Rotation/Location/Time/Volume,
 * Copy ▸ Effects; transitions: Keyframes ▸ All/Brightness/Contrast).
 */
export type CopyPart =
  | "all"
  | "keyframes"
  | "alpha"
  | "scale"
  | "shear"
  | "rotation"
  | "location"
  | "time"
  | "volume"
  | "effects"
  | "brightness"
  | "contrast";

/** What `copyItems` puts on the clipboard (desktop `application/x-zenvi-generic`). */
export interface ClipboardData {
  kind: "zenvi/clipboard";
  version: 1;
  /** Whole items (`all`, the default when absent) or one property group. */
  part?: CopyPart;
  /** Deep copies of the copied clips, in timeline order. */
  clips: Clip[];
  /** Deep copies of the copied transitions, in timeline order. */
  transitions: Transition[];
  /**
   * Anchor of the copied selection: the earliest position and the highest
   * track among the copied items. Pasting places the anchor at the paste
   * position/track and keeps every item's offset from it.
   */
  origin: { position: number; layer: number };
}
