/**
 * Clip effect operations (`clips[].effects[]`).
 *
 * Desktop: zenvi-core src/windows/views/timeline.py `_apply_effect_to_clip`
 * (effect JSON from `EffectInfo().CreateEffect(name)` + a project id,
 * appended to the clip's effects), agent_tools/effects.py `add_effect`
 * (dialog-only effects refused), properties_model.py for parameter edits
 * (effect keyframes use the parent clip's frame numbers). Effects are
 * addressed by their own id across all clips (`Effect.get(id=…)`).
 */

import type { Transaction } from "../history/document.js";
import type { ColorKeyframe, Effect, Keyframe } from "../model/types.js";
import { findClipEffect } from "../model/query.js";
import { EffectParamError, createEffect, effectParamJson, getEffect } from "../effects/registry.js";
import type { EffectParam } from "../effects/types.js";
import { OpError, invalid, requireClipEffect, requireUnlocked } from "./errors.js";
import { ids, patchClip, requireEditableClip, resolveClipFrame } from "./internal.js";
import { writeColorKeyframe, writeKeyframeValue } from "./clips.js";
import type { ColorInput, KeyframeAt, PropertyValue } from "./types.js";

export interface AddEffectOptions {
  /** Explicit id. */
  id?: string;
  /** Insert at this index in the clip's effect stack. Default: last (applied last). */
  index?: number;
}

function paramError(error: unknown): never {
  if (error instanceof EffectParamError) throw invalid(error.message);
  throw error;
}

/**
 * Add a libopenshot effect to a clip. `className` is the libopenshot class
 * (`"Blur"`, `"Brightness"`, …; see `effects/registry`), matched
 * case-insensitively. `params` override defaults the way the desktop's
 * presets do: numbers become one-point keyframes for keyframed parameters,
 * colors accept `#rrggbb[aa]` or `[r, g, b, a]`. Unknown classes and
 * parameters are refused with `invalid_argument`; effects that need the
 * desktop's ProcessEffect dialog (Tracker, Stabilizer, ObjectDetection,
 * ObjectMask) with `unsupported`.
 */
export function addEffect(
  tx: Transaction,
  clipId: string,
  className: string,
  params: Readonly<Record<string, PropertyValue>> = {},
  opts: AddEffectOptions = {},
): Effect {
  const project = tx.project;
  const clip = requireEditableClip(project, clipId);
  const def = getEffect(className);
  if (!def) throw invalid(`Unknown effect: ${className}.`);
  if (def.needsDialog) {
    throw new OpError("unsupported", `Effect ${def.className} needs the desktop's processing dialog and cannot be added here.`);
  }
  if (opts.id !== undefined && findClipEffect(project, opts.id)) {
    throw new OpError("conflict", `An effect with id ${opts.id} already exists.`, { id: opts.id });
  }
  const effects = [...(clip.effects ?? [])];
  const index = opts.index ?? effects.length;
  if (!Number.isInteger(index) || index < 0 || index > effects.length) {
    throw invalid(`index must be 0..${effects.length} (got ${index}).`);
  }
  let effect: Effect;
  try {
    effect = createEffect(def.className, params as Record<string, unknown>, { id: opts.id ?? ids(project)() });
  } catch (error) {
    paramError(error);
  }
  effects.splice(index, 0, effect);
  patchClip(tx, clipId, { effects });
  return findClipEffect(tx.project, effect.id)!.effect;
}

export interface RemoveEffectResult {
  clipId: string;
  effectId: string;
}

/** Remove a clip effect by id. */
export function removeEffect(tx: Transaction, effectId: string): RemoveEffectResult {
  const { clip } = requireClipEffect(tx.project, effectId);
  requireUnlocked(tx.project, clip.layer);
  patchClip(tx, clip.id, { effects: clip.effects.filter((e) => e.id !== effectId) });
  return { clipId: clip.id, effectId };
}

function paramFor(effect: Effect, prop: string): EffectParam | undefined {
  return getEffect(effect.class_name)?.params.find((p) => p.key === prop);
}

const IMMUTABLE_EFFECT_KEYS = new Set(["id", "class_name", "type"]);

/**
 * Set one effect parameter (same rules as `setClipProperty`): keyframed and
 * color parameters are constant without `at`, or get a point at `at.frame` /
 * `at.time` (frames in the parent clip's frame space; choice parameters are
 * written CONSTANT); plain parameters are set outright. Parameters are
 * validated against the effect's libopenshot schema.
 */
export function setEffectProperty(
  tx: Transaction,
  effectId: string,
  prop: string,
  value: PropertyValue,
  at: KeyframeAt = {},
): Effect {
  const project = tx.project;
  const { clip, effect, index } = requireClipEffect(project, effectId);
  requireUnlocked(project, clip.layer);
  if (IMMUTABLE_EFFECT_KEYS.has(prop)) throw invalid(`Effect ${prop} cannot be changed.`);
  const param = paramFor(effect, prop);
  if (!param) throw invalid(`Effect ${effect.class_name} has no parameter ${prop}.`);
  if (param.readonly) throw invalid(`${prop} is read-only.`);
  const frame = resolveClipFrame(project, clip, at);
  if (at.interpolation !== undefined && ![0, 1, 2].includes(at.interpolation)) {
    throw invalid("interpolation must be 0 (bezier), 1 (linear) or 2 (constant).");
  }

  let next: unknown;
  if (param.type === "color") {
    next = writeColorKeyframe(effect[prop] as ColorKeyframe | undefined, value as ColorInput, frame, at.interpolation);
  } else if (param.keyframable && (param.type === "keyframe" || param.type === "choice")) {
    const n = typeof value === "boolean" ? (value ? 1 : 0) : Number(value);
    if (typeof value !== "number" && typeof value !== "boolean") throw invalid(`${prop} must be a number.`);
    if (!Number.isFinite(n)) throw invalid(`${prop} must be a finite number.`);
    if (param.choices && !param.choices.some((c) => Number(c.value) === n)) {
      throw invalid(`${prop} must be one of ${param.choices.map((c) => c.value).join(", ")}.`);
    }
    next = writeKeyframeValue(effect[prop] as Keyframe | undefined, n, frame, at.interpolation, param.type === "choice");
  } else {
    if (frame !== undefined) throw invalid(`${prop} is not keyframeable.`);
    try {
      next = effectParamJson(param, value);
    } catch (error) {
      paramError(error);
    }
  }
  const effects = [...clip.effects];
  effects[index] = { ...effect, [prop]: next };
  patchClip(tx, clip.id, { effects });
  return findClipEffect(tx.project, effectId)!.effect;
}

/**
 * Move an effect within its clip's stack: to an absolute index, or one step
 * `up` (earlier, applied first) / `down` (later). libopenshot applies clip
 * effects in list order when their `order` values are equal (the desktop
 * never sets them); if any differ they are renumbered so the new list order
 * is the apply order.
 */
export function moveEffect(tx: Transaction, effectId: string, to: number | "up" | "down"): Effect {
  const project = tx.project;
  const { clip, index } = requireClipEffect(project, effectId);
  requireUnlocked(project, clip.layer);
  const count = clip.effects.length;
  let target: number;
  if (to === "up") target = Math.max(0, index - 1);
  else if (to === "down") target = Math.min(count - 1, index + 1);
  else if (typeof to === "number" && Number.isInteger(to) && to >= 0 && to < count) target = to;
  else throw invalid(`to must be "up", "down" or an index 0..${count - 1}.`);
  if (target === index) return clip.effects[index]!;
  const effects = [...clip.effects];
  const [moved] = effects.splice(index, 1);
  effects.splice(target, 0, moved!);
  const orders = new Set(effects.map((e) => e.order ?? 0));
  const reordered = orders.size > 1 ? effects.map((e, i) => ({ ...e, order: count - 1 - i })) : effects;
  patchClip(tx, clip.id, { effects: reordered });
  return findClipEffect(tx.project, effectId)!.effect;
}
