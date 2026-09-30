/**
 * Clip effect operations (`clips[].effects[]`).
 *
 * Desktop: zenvi-core src/windows/views/timeline.py `addEffect` /
 * `_apply_effect_to_clip` (effect JSON from `EffectInfo().CreateEffect(name)`),
 * properties_model.py for parameter edits. Effects are addressed by their own
 * id across all clips (`Effect.get(id=…)`).
 */

import type { Transaction } from "../history/document.js";
import type { Effect } from "../model/types.js";
import { OpError } from "./errors.js";
import type { KeyframeAt, PropertyValue } from "./types.js";

function notImplemented(op: string): never {
  throw new OpError("unsupported", `not implemented: ${op}`);
}

export interface AddEffectOptions {
  /** Explicit id. */
  id?: string;
  /** Insert at this index in the clip's effect stack. Default: on top (last). */
  index?: number;
}

/**
 * Add a libopenshot effect to a clip. `className` is the libopenshot class
 * (`"Blur"`, `"Brightness"`, …; see `effects/registry`). `params` override
 * defaults: numbers become constant keyframes for keyframed parameters, colors
 * accept a `ColorInput`. Unknown classes and parameters are refused;
 * OpenCV-only effects are refused with `unsupported`.
 */
export function addEffect(
  tx: Transaction,
  clipId: string,
  className: string,
  params: Readonly<Record<string, PropertyValue>> = {},
  opts: AddEffectOptions = {},
): Effect {
  void tx;
  void clipId;
  void className;
  void params;
  void opts;
  return notImplemented("addEffect");
}

export interface RemoveEffectResult {
  clipId: string;
  effectId: string;
}

/** Remove a clip effect by id. */
export function removeEffect(tx: Transaction, effectId: string): RemoveEffectResult {
  void tx;
  void effectId;
  return notImplemented("removeEffect");
}

/**
 * Set one effect parameter (keyframe-aware, same rules as `setClipProperty`;
 * `at.frame` is in the parent clip's frame space).
 */
export function setEffectProperty(
  tx: Transaction,
  effectId: string,
  prop: string,
  value: PropertyValue,
  at: KeyframeAt = {},
): Effect {
  void tx;
  void effectId;
  void prop;
  void value;
  void at;
  return notImplemented("setEffectProperty");
}

/**
 * Move an effect within its clip's stack: to an absolute index, or one step
 * `up` (applied later, drawn over) / `down`. Updates every effect's `order`.
 */
export function moveEffect(tx: Transaction, effectId: string, to: number | "up" | "down"): Effect {
  void tx;
  void effectId;
  void to;
  return notImplemented("moveEffect");
}
