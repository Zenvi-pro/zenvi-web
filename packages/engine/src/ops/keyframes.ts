/**
 * Keyframe editing from the Properties panel's context menu: change the
 * interpolation of the segment at the playhead (Bezier presets / Linear /
 * Constant) and remove a keyframe — on clips, clip effects and transitions.
 *
 * Ported from zenvi-core src/windows/models/properties_model.py
 * (`value_updated` with an interpolation, `remove_keyframe`) and
 * src/windows/views/menu.py `keyframe_bezier_presets`. "Closest" and
 * "previous" points follow libopenshot `Keyframe::GetClosestPoint` /
 * `GetPreviousPoint` as `ClipBase::add_property_json` reports them.
 */

import type { Transaction } from "../history/document.js";
import type { Clip, ColorKeyframe, Effect, Keyframe, KeyframePoint, Transition } from "../model/types.js";
import { Interpolation } from "../model/types.js";
import { clampTimingToMedia } from "../model/timing.js";
import { findClipEffect } from "../model/query.js";
import { clipFrameAtTime } from "../timeline/windows.js";
import { OpError, invalid, requireClip, requireTransition, requireUnlocked } from "./errors.js";
import { fpsOf, isRecord, patchClip, patchTransition, resolveClipFrame } from "./internal.js";
import { pyRound } from "../model/rounding.js";
import { normalizeKeyframe } from "../keyframe/edit.js";
import { requireInterpolation } from "./values.js";
import type { KeyframeAt } from "./types.js";

/** The 28 bezier presets of the desktop's keyframe menu: CSS cubic-bezier (x1, y1, x2, y2). */
export const KEYFRAME_BEZIER_PRESETS: readonly { name: string; handles: readonly [number, number, number, number] }[] = [
  { name: "Ease (Default)", handles: [0.25, 0.1, 0.25, 1.0] },
  { name: "Ease In", handles: [0.42, 0.0, 1.0, 1.0] },
  { name: "Ease Out", handles: [0.0, 0.0, 0.58, 1.0] },
  { name: "Ease In/Out", handles: [0.42, 0.0, 0.58, 1.0] },
  { name: "Ease In (Quad)", handles: [0.55, 0.085, 0.68, 0.53] },
  { name: "Ease In (Cubic)", handles: [0.55, 0.055, 0.675, 0.19] },
  { name: "Ease In (Quart)", handles: [0.895, 0.03, 0.685, 0.22] },
  { name: "Ease In (Quint)", handles: [0.755, 0.05, 0.855, 0.06] },
  { name: "Ease In (Sine)", handles: [0.47, 0.0, 0.745, 0.715] },
  { name: "Ease In (Expo)", handles: [0.95, 0.05, 0.795, 0.035] },
  { name: "Ease In (Circ)", handles: [0.6, 0.04, 0.98, 0.335] },
  { name: "Ease In (Back)", handles: [0.6, -0.28, 0.735, 0.045] },
  { name: "Ease Out (Quad)", handles: [0.25, 0.46, 0.45, 0.94] },
  { name: "Ease Out (Cubic)", handles: [0.215, 0.61, 0.355, 1.0] },
  { name: "Ease Out (Quart)", handles: [0.165, 0.84, 0.44, 1.0] },
  { name: "Ease Out (Quint)", handles: [0.23, 1.0, 0.32, 1.0] },
  { name: "Ease Out (Sine)", handles: [0.39, 0.575, 0.565, 1.0] },
  { name: "Ease Out (Expo)", handles: [0.19, 1.0, 0.22, 1.0] },
  { name: "Ease Out (Circ)", handles: [0.075, 0.82, 0.165, 1.0] },
  { name: "Ease Out (Back)", handles: [0.175, 0.885, 0.32, 1.275] },
  { name: "Ease In/Out (Quad)", handles: [0.455, 0.03, 0.515, 0.955] },
  { name: "Ease In/Out (Cubic)", handles: [0.645, 0.045, 0.355, 1.0] },
  { name: "Ease In/Out (Quart)", handles: [0.77, 0.0, 0.175, 1.0] },
  { name: "Ease In/Out (Quint)", handles: [0.86, 0.0, 0.07, 1.0] },
  { name: "Ease In/Out (Sine)", handles: [0.445, 0.05, 0.55, 0.95] },
  { name: "Ease In/Out (Expo)", handles: [1.0, 0.0, 0.0, 1.0] },
  { name: "Ease In/Out (Circ)", handles: [0.785, 0.135, 0.15, 0.86] },
  { name: "Ease In/Out (Back)", handles: [0.68, -0.55, 0.265, 1.55] },
];

/** Which object a keyframe edit targets. */
export type KeyframeTarget = { clipId: string } | { effectId: string } | { transitionId: string };

interface Resolved {
  frame: number;
  data: Record<string, unknown>;
  save: (tx: Transaction, patch: Record<string, unknown>) => void;
  kind: "clip" | "effect" | "transition";
}

function resolveTarget(tx: Transaction, target: KeyframeTarget, at: KeyframeAt): Resolved {
  const project = tx.project;
  if ("clipId" in target) {
    const clip = requireClip(project, target.clipId);
    requireUnlocked(project, clip.layer);
    const frame = resolveClipFrame(project, clip, at);
    if (frame === undefined) throw invalid("Give the keyframe's frame or time.");
    return { frame, data: clip as Record<string, unknown>, kind: "clip", save: (t, patch) => void patchClip(t, clip.id, patch) };
  }
  if ("effectId" in target) {
    const ref = findClipEffect(project, target.effectId);
    if (!ref) throw new OpError("not_found", `No effect with id ${target.effectId}.`, { id: target.effectId });
    requireUnlocked(project, ref.clip.layer);
    const frame = resolveClipFrame(project, ref.clip, at);
    if (frame === undefined) throw invalid("Give the keyframe's frame or time.");
    const save = (t: Transaction, patch: Record<string, unknown>): void => {
      const clip = requireClip(t.project, ref.clip.id);
      const effects = clip.effects.map((e) => (e.id === target.effectId ? ({ ...e, ...patch } as Effect) : e));
      patchClip(t, clip.id, { effects });
    };
    return { frame, data: ref.effect, kind: "effect", save };
  }
  const transition = requireTransition(project, target.transitionId);
  requireUnlocked(project, transition.layer);
  if (at.frame !== undefined && at.time !== undefined) throw invalid("Give at most one of frame / time.");
  const frame = at.frame ?? (at.time !== undefined ? clipFrameAtTime(transition, at.time, fpsOf(project)) : undefined);
  if (frame === undefined || !Number.isFinite(frame)) throw invalid("Give the keyframe's frame or time.");
  return {
    frame,
    data: transition as Record<string, unknown>,
    kind: "transition",
    save: (t, patch) => void patchTransition(t, (transition as Transition).id, patch),
  };
}

function xOf(p: KeyframePoint): number {
  return typeof p?.co?.X === "number" ? p.co.X : 1;
}

/** `GetClosestPoint(frame)` and `GetPreviousPoint(closest)` X values, or null when empty. */
function closestAndPrevious(points: readonly KeyframePoint[], frame: number): { closest: number; previous: number } | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => xOf(a) - xOf(b));
  let index = sorted.findIndex((p) => xOf(p) >= frame);
  if (index < 0) index = sorted.length - 1;
  return { closest: xOf(sorted[index]!), previous: xOf(sorted[Math.max(0, index - 1)]!) };
}

function keyframesOf(value: unknown, prop: string): { channels: [string | null, Keyframe][]; color: boolean } {
  if (isRecord(value) && Array.isArray(value.Points)) return { channels: [[null, value as Keyframe]], color: false };
  if (isRecord(value) && ["red", "green", "blue"].every((c) => isRecord(value[c]))) {
    const color = value as ColorKeyframe;
    return { channels: [["red", color.red], ["blue", color.blue], ["green", color.green]], color: true };
  }
  throw invalid(`${prop} is not a keyframed property.`);
}

/**
 * Change the interpolation of the segment that ends at the first keyframe at
 * or after the target frame (desktop Properties ▸ right-click ▸ Bezier /
 * Linear / Constant). For BEZIER, `handles` is a CSS cubic-bezier
 * `[x1, y1, x2, y2]` (see `KEYFRAME_BEZIER_PRESETS`): the segment's end
 * point gets `handle_left = (x2, y2)`, its start point
 * `handle_right = (x1, y1)` when that point is itself BEZIER (the desktop's
 * rule).
 */
export function setKeyframeInterpolation(
  tx: Transaction,
  target: KeyframeTarget,
  prop: string,
  at: KeyframeAt,
  interpolation: Interpolation,
  handles?: readonly [number, number, number, number],
): Clip | Effect | Transition {
  const resolved = resolveTarget(tx, target, at);
  const interp = requireInterpolation(interpolation);
  if (interp === undefined) throw invalid("interpolation is required.");
  if (handles && (handles.length !== 4 || handles.some((v) => !Number.isFinite(v)))) {
    throw invalid("handles must be four finite numbers [x1, y1, x2, y2].");
  }
  const { channels, color } = keyframesOf(resolved.data[prop], prop);
  const out: Record<string, unknown> = color ? { ...(resolved.data[prop] as Record<string, unknown>) } : {};
  let result: Keyframe | undefined;
  for (const [channel, kf] of channels) {
    const points = (kf.Points ?? []).map((p) => structuredClone(p));
    const cp = closestAndPrevious(points, resolved.frame);
    if (cp) {
      for (const p of points) {
        if (xOf(p) === cp.previous) {
          if ((p.interpolation ?? Interpolation.CONSTANT) === Interpolation.BEZIER && handles) {
            p.handle_right = { X: handles[0], Y: handles[1] };
          } else {
            delete p.handle_right;
          }
        }
        if (xOf(p) === cp.closest) {
          p.interpolation = interp;
          if (interp === Interpolation.BEZIER && handles) p.handle_left = { X: handles[2], Y: handles[3] };
          else delete p.handle_left;
        }
      }
    }
    const next = { ...kf, Points: points };
    if (channel) out[channel] = next;
    else result = next;
  }
  resolved.save(tx, { [prop]: color ? out : result });
  return current(tx, target);
}

/** Desktop defaults for a keyframe left without points (properties_model.py `remove_keyframe`). */
function emptyDefault(prop: string, channel: string | null): number | null {
  if (["alpha", "scale_x", "scale_y", "time", "volume"].includes(prop)) return 1.0;
  if (["origin_x", "origin_y"].includes(prop)) return 0.5;
  if (["location_x", "location_y", "rotation", "shear_x", "shear_y"].includes(prop)) return 0.0;
  if (["has_audio", "has_video", "channel_filter", "channel_mapping"].includes(prop)) return -1.0;
  if (prop === "wave_color") return channel === "red" ? 0.0 : channel === "blue" ? 255.0 : channel === "green" ? 123.0 : null;
  return null;
}

/**
 * Remove the keyframe at the target frame, or the closest one after it
 * (desktop Properties ▸ Remove Keyframe). When a property is left with no
 * points, the desktop's default value is put back at that frame. A clip's
 * `time` change re-applies the media timing clamp.
 */
export function removeKeyframe(tx: Transaction, target: KeyframeTarget, prop: string, at: KeyframeAt): Clip | Effect | Transition {
  const resolved = resolveTarget(tx, target, at);
  const { channels, color } = keyframesOf(resolved.data[prop], prop);
  const out: Record<string, unknown> = color ? { ...(resolved.data[prop] as Record<string, unknown>) } : {};
  let result: Keyframe | undefined;
  let changed = false;
  for (const [channel, kf] of channels) {
    const points = [...(kf.Points ?? [])];
    const cp = closestAndPrevious(points, resolved.frame);
    let index = points.findIndex((p) => xOf(p) === resolved.frame);
    if (index < 0 && cp) index = points.findIndex((p) => xOf(p) === cp.closest);
    if (index >= 0) {
      points.splice(index, 1);
      changed = true;
      const fallback = points.length === 0 ? emptyDefault(prop, channel) : null;
      if (fallback !== null) points.push({ co: { X: resolved.frame, Y: fallback }, interpolation: Interpolation.LINEAR });
    }
    const next = { ...kf, Points: points };
    if (channel) out[channel] = next;
    else result = next;
  }
  if (!changed) return current(tx, target);
  const patch: Record<string, unknown> = { [prop]: color ? out : result };
  if (resolved.kind === "clip" && prop === "time") {
    const timing = clampTimingToMedia({ ...resolved.data, ...patch }, fpsOf(tx.project));
    Object.assign(patch, { start: timing.start, end: timing.end, duration: timing.duration });
    if (timing.time) patch.time = timing.time;
  }
  resolved.save(tx, patch);
  return current(tx, target);
}

function current(tx: Transaction, target: KeyframeTarget): Clip | Effect | Transition {
  if ("clipId" in target) return requireClip(tx.project, target.clipId);
  if ("effectId" in target) return findClipEffect(tx.project, target.effectId)!.effect;
  return requireTransition(tx.project, target.transitionId);
}

// ---------------------------------------------------------------------------
// Keyframe markers (timeline keyframe panel)
// ---------------------------------------------------------------------------

export interface KeyframeMarkerOptions {
  /** Only these properties (default: every keyframed property of the target, colors included). */
  props?: readonly string[];
}

/** Apply `fn` to every keyframe's points nested in `value` (colors, effects, curves), skipping `ui` and readers. */
function mapPointsDeep(value: unknown, fn: (points: KeyframePoint[]) => KeyframePoint[]): unknown {
  if (Array.isArray(value)) return value.map((v) => mapPointsDeep(v, fn));
  if (!isRecord(value)) return value;
  if (Array.isArray(value.Points)) return { ...value, Points: fn(value.Points as KeyframePoint[]) };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = k === "ui" || k === "reader" ? v : mapPointsDeep(v, fn);
  return out;
}

/** The top-level keys a marker edit touches: every key, or `props` (a clip's effects only without `props`). */
function markerKeys(data: Record<string, unknown>, props: readonly string[] | undefined): string[] {
  const keys = Object.keys(data).filter((k) => k !== "ui" && k !== "reader" && k !== "id");
  return props ? keys.filter((k) => props.includes(k)) : keys;
}

function frameOf(p: KeyframePoint): number | null {
  const x = Number(p?.co?.X);
  return Number.isFinite(x) ? pyRound(x) : null;
}

function itemFrameSpan(tx: Transaction, target: KeyframeTarget): { first: number; last: number } {
  const project = tx.project;
  const rate = fpsOf(project).num / fpsOf(project).den;
  const timed =
    "clipId" in target
      ? requireClip(project, target.clipId)
      : "effectId" in target
        ? findClipEffect(project, target.effectId)?.clip
        : requireTransition(project, target.transitionId);
  if (!timed) throw new OpError("not_found", "No such keyframe owner.");
  const first = pyRound(Number(timed.start) * rate) + 1;
  // _clamp_keyframe_seconds: up to one frame before the end.
  const last = Math.max(first, pyRound(Number(timed.end) * rate));
  return { first, last };
}

/**
 * Drag a keyframe marker (timeline keyframe panel, qwidget/keyframe.py
 * `_move_keyframes_in_object`): every point at `fromFrame` (rounded) moves to
 * `toFrame`, clamped to the owner's frames, across all of the target's
 * keyframed properties (a clip includes its effects) or only `props`.
 */
export function moveKeyframes(
  tx: Transaction,
  target: KeyframeTarget,
  fromFrame: number,
  toFrame: number,
  opts: KeyframeMarkerOptions = {},
): Clip | Effect | Transition {
  if (!Number.isFinite(fromFrame) || !Number.isFinite(toFrame)) throw invalid("Frames must be finite numbers.");
  const resolved = resolveTarget(tx, target, { frame: fromFrame });
  const span = itemFrameSpan(tx, target);
  const from = pyRound(fromFrame);
  const to = Math.min(Math.max(pyRound(toFrame), span.first), span.last);
  if (from === to) return current(tx, target);
  const patch: Record<string, unknown> = {};
  for (const key of markerKeys(resolved.data, opts.props)) {
    // Re-sorted like libopenshot loads it (a point landing on another replaces it).
    patch[key] = mapPointsDeep(resolved.data[key], (points) =>
      normalizeKeyframe({ Points: points.map((p) => (frameOf(p) === from ? { ...p, co: { ...p.co, X: to } } : p)) }).Points,
    );
  }
  resolved.save(tx, patch);
  return current(tx, target);
}

/**
 * Delete a keyframe marker (qwidget/keyframe.py `_remove_keyframes_in_object`):
 * every point at `frame` (rounded), across the target's keyframed properties
 * or only `props`.
 */
export function removeKeyframesAt(
  tx: Transaction,
  target: KeyframeTarget,
  frame: number,
  opts: KeyframeMarkerOptions = {},
): Clip | Effect | Transition {
  if (!Number.isFinite(frame)) throw invalid("frame must be a finite number.");
  const resolved = resolveTarget(tx, target, { frame });
  const at = pyRound(frame);
  const patch: Record<string, unknown> = {};
  for (const key of markerKeys(resolved.data, opts.props)) {
    patch[key] = mapPointsDeep(resolved.data[key], (points) => points.filter((p) => frameOf(p) !== at));
  }
  resolved.save(tx, patch);
  return current(tx, target);
}
