/**
 * Transition operations (`project.effects[]`, libopenshot `Mask`).
 *
 * Desktop: zenvi-core src/windows/views/timeline.py `addTransition`,
 * `_auto_orient_transition_keyframes`, `update_transition_data` (static-mask
 * keyframe rescale on trim), `Reverse_Transition_Triggered`,
 * `_set_transition_mask_defaults`; tool_handlers.py `add_transition_between_clips`
 * and `add_transition_to_clip`; main_window.py `actionRemoveTransition_trigger`;
 * develop 1f80cb3d0 src/classes/transition_ops.py (the rules the timeline and
 * the transition editor tools share: `direction_of`, `rescale_curves`,
 * `reverse_transition_data`, `set_mask_defaults`, `new_mask_transition`).
 */

import type { Transaction } from "../history/document.js";
import type { Clip, Fraction, Keyframe, ReaderInfo, Transition } from "../model/types.js";
import { createTransition, transitionKeyframes } from "../model/defaults.js";
import { findLayer, findTransition } from "../model/query.js";
import { isSingleImageMedia } from "../model/media.js";
import { pyRound } from "../model/rounding.js";
import { TRANSITION_PROPERTIES } from "../model/properties.js";
import { reverseKeyframe, scaleKeyframe } from "../keyframe/edit.js";
import { clipFrameAtTime } from "../timeline/windows.js";
import { OpError, invalid, requireClip, requireFinite, requireNonNegative, requireTransition, requireUnlocked } from "./errors.js";
import { changedFields, ensureLayer, fpsOf, frameSeconds, ids, isRecord, patchClip, patchTransition, rateOf, snapSeconds } from "./internal.js";
import { writeKeyframeValue } from "./values.js";
import { maskReader, resolveTransitionMask, type TransitionMask } from "./transition-masks.js";
import type { Edge, KeyframeAt, PropertyValue } from "./types.js";

export { maskReader, resolveTransitionMask, type TransitionMask } from "./transition-masks.js";

/**
 * `in`: the top clip appears (mask brightness animates 1 → -1, the desktop
 * default for a transition at a clip's start). `out`: the top clip disappears
 * (-1 → 1, desktop "Reverse").
 */
export type TransitionDirection = "in" | "out";

export interface AddTransitionInput {
  /** Track number the transition applies to (created when missing, like the desktop). */
  layer: number;
  /** Timeline start, seconds (snapped to the frame grid). */
  position: number;
  /** Length, seconds (> 0, snapped). */
  duration: number;
  /** Catalog id (`"common/fade"`), stored path or name. Give this or `path`. */
  maskId?: string;
  /** Explicit mask image path (user transitions). */
  path?: string;
  /** Reader JSON for the mask when the host has probed it; synthesized otherwise. */
  reader?: ReaderInfo;
  /**
   * Default: oriented like the desktop's drop (`_auto_orient_transition_keyframes`):
   * `in` at a clip's left edge, `out` at its right edge, `in` when it overlaps no clip.
   */
  direction?: TransitionDirection;
  /** Display title. Default "Transition" (desktop drop). */
  title?: string;
  /** Mark as an automatic overlap transition (`fade_audio_hint`: libopenshot also fades audio). */
  fadeAudio?: boolean;
  id?: string;
}

function requireDuration(duration: unknown): number {
  const d = requireFinite(duration, "duration");
  if (!(d > 0)) throw invalid(`duration must be > 0 (got ${d}).`);
  return d;
}

function resolveMask(maskId: string | undefined, path: string | undefined): TransitionMask {
  if (maskId !== undefined && path !== undefined) throw invalid("Give maskId or path, not both.");
  if (path !== undefined) {
    if (typeof path !== "string" || path === "") throw invalid("path must be a non-empty string.");
    const known = resolveTransitionMask(path);
    const stem = (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, "");
    return known ?? { path, title: stem, width: 720, height: 576 };
  }
  if (maskId === undefined) throw invalid("Give maskId or path.");
  const found = resolveTransitionMask(maskId);
  if (!found) throw new OpError("not_found", `Transition '${maskId}' not found.`, { maskId });
  return found;
}

/** timeline.py `_infer_transition_drop_side`: which edge of an overlapped clip the transition sits on. */
export function inferDropSide(clips: readonly Clip[], layer: number, position: number, duration: number): "left" | "right" | null {
  if (!(duration > 0)) return null;
  const left = position;
  const right = position + duration;
  const mid = (left + right) / 2;
  let best: { score: [number, number]; side: "left" | "right" } | null = null;
  for (const clip of clips) {
    if (clip.layer !== layer) continue;
    const clipDuration = Math.max(0, clip.end - clip.start);
    if (clipDuration <= 0) continue;
    const clipLeft = clip.position;
    const clipRight = clipLeft + clipDuration;
    const overlap = Math.min(right, clipRight) - Math.max(left, clipLeft);
    if (overlap <= 0) continue;
    const side = mid <= (clipLeft + clipRight) / 2 ? "left" : "right";
    const edgeDist = Math.abs(mid - (side === "left" ? clipLeft : clipRight));
    const score: [number, number] = [-overlap, edgeDist];
    if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) {
      best = { score, side };
    }
  }
  return best?.side ?? null;
}

/**
 * Add a transition with the desktop's default brightness (1 → -1) and
 * contrast (3) keyframes over its length, oriented like a desktop drop.
 */
export function addTransition(tx: Transaction, input: AddTransitionInput): Transition {
  const project = tx.project;
  if (typeof input !== "object" || input === null) throw invalid("addTransition needs an input object.");
  if (!Number.isInteger(input.layer) || input.layer <= 0) throw invalid(`layer must be a positive track number.`);
  requireUnlocked(project, input.layer);
  const position = snapSeconds(requireNonNegative(input.position, "position"), project);
  const duration = snapSeconds(requireDuration(input.duration), project);
  if (!(duration > 0)) throw invalid("duration is shorter than one frame.");
  const mask = resolveMask(input.maskId, input.path);
  if (input.direction !== undefined && input.direction !== "in" && input.direction !== "out") {
    throw invalid(`direction must be in or out.`);
  }
  if (input.id !== undefined && findTransition(project, input.id)) {
    throw new OpError("conflict", `A transition with id ${input.id} already exists.`, { id: input.id });
  }
  const side = inferDropSide(project.clips, input.layer, position, duration);
  const direction = input.direction ?? (side === "right" ? "out" : "in");
  const transition = createTransition({
    id: input.id ?? ids(project)(),
    layer: input.layer,
    position,
    duration,
    reader: input.reader ?? maskReader(mask.path, mask.width, mask.height),
    fps: fpsOf(project),
    direction,
    title: input.title ?? "Transition",
    resource: mask.path,
    fadeAudio: input.fadeAudio ?? false,
  });
  ensureLayer(tx, input.layer);
  tx.insert(["effects"], transition);
  return requireTransition(tx.project, transition.id);
}

export interface ApplyTransitionResult {
  transition: Transition;
  /** The clip that was moved to create the overlap, when one had to move. */
  movedClip?: Clip;
}

/** Tool-style transition dict (tool_handlers.py): no `resource`, file-stem title. */
function toolTransition(
  tx: Transaction,
  mask: TransitionMask,
  layer: number,
  position: number,
  duration: number,
  direction: TransitionDirection,
): Transition {
  return addMaskTransition(tx, { layer, position, duration, reader: maskReader(mask.path, mask.width, mask.height), title: mask.title, direction });
}

export interface AddMaskTransitionInput {
  /** Track number (unlocked). */
  layer: number;
  /** Timeline start, seconds (snapped to the frame grid). */
  position: number;
  /** Length, seconds (> 0, snapped). */
  duration: number;
  /** The mask's reader JSON (`maskReader(path)` for a catalog mask, a project file's record for a user mask). */
  reader: ReaderInfo;
  /** Display title. Default "Transition". */
  title?: string;
  /** Default `in` (brightness 1 → -1). */
  direction?: TransitionDirection;
  /** Crossfade the audio of the two clips too (`fade_audio_hint`). */
  fadeAudio?: boolean;
}

/**
 * Insert a Mask transition the way the desktop's tools build one
 * (transition_ops.new_mask_transition): the default brightness and contrast
 * keyframes over its length, the given mask reader, no `resource`, and
 * `fade_audio_hint` only when the audio crossfades too.
 */
export function addMaskTransition(tx: Transaction, input: AddMaskTransitionInput): Transition {
  const project = tx.project;
  if (typeof input !== "object" || input === null) throw invalid("addMaskTransition needs an input object.");
  if (!Number.isInteger(input.layer) || input.layer <= 0) throw invalid("layer must be a positive track number.");
  requireUnlocked(project, input.layer);
  if (!isRecord(input.reader)) throw invalid("reader must be the mask's reader JSON.");
  const position = snapSeconds(requireNonNegative(input.position, "position"), project);
  const duration = snapSeconds(requireDuration(input.duration), project);
  if (!(duration > 0)) throw invalid("duration is shorter than one frame.");
  const transition = createTransition({
    id: ids(project)(),
    layer: input.layer,
    position,
    duration,
    reader: input.reader,
    fps: fpsOf(project),
    direction: input.direction ?? "in",
    title: input.title ?? "Transition",
    fadeAudio: input.fadeAudio ?? false,
  });
  tx.insert(["effects"], transition);
  return requireTransition(tx.project, transition.id);
}

/**
 * Put a transition between two clips (zenvi-core
 * `add_transition_between_clips`): clip B moves back by `duration` (not
 * before 0) so the two overlap, and a mask named `name` (catalog id or name,
 * fuzzy-matched like the desktop) covers the overlap on the higher of the two
 * tracks. Later clips are not rippled. One undo step.
 */
export function applyTransitionBetween(
  tx: Transaction,
  clipAId: string,
  clipBId: string,
  name: string,
  duration: number,
): ApplyTransitionResult {
  const project = tx.project;
  const clipA = requireClip(project, clipAId);
  const clipB = requireClip(project, clipBId);
  if (clipAId === clipBId) throw invalid("Pick two different clips.");
  const dur = requireDuration(duration);
  const mask = resolveMask(name, undefined);
  const layer = Math.max(clipA.layer, clipB.layer);
  requireUnlocked(project, clipB.layer);
  requireUnlocked(project, layer);
  const snappedDuration = snapSeconds(dur, project);
  if (!(snappedDuration > 0)) throw invalid("duration is shorter than one frame.");
  const position = snapSeconds(Math.max(clipB.position - dur, 0), project);
  const movedClip = patchClip(tx, clipBId, { position });
  const transition = toolTransition(tx, mask, layer, position, snappedDuration, "in");
  return movedClip.position !== clipB.position ? { transition, movedClip } : { transition };
}

/**
 * Put a transition at the start (fade in) or end (fade out) of one clip
 * (zenvi-core `add_transition_to_clip`).
 */
export function applyTransitionToClip(
  tx: Transaction,
  clipId: string,
  name: string,
  placement: "start" | "end",
  duration: number,
): Transition {
  const project = tx.project;
  const clip = requireClip(project, clipId);
  requireUnlocked(project, clip.layer);
  if (placement !== "start" && placement !== "end") throw invalid(`placement must be start or end.`);
  const dur = requireDuration(duration);
  const mask = resolveMask(name, undefined);
  const snappedDuration = snapSeconds(dur, project);
  if (!(snappedDuration > 0)) throw invalid("duration is shorter than one frame.");
  const raw = placement === "end" ? clip.position + (clip.end - clip.start) - dur : clip.position;
  const position = snapSeconds(Math.max(0, raw), project);
  return toolTransition(tx, mask, clip.layer, position, snappedDuration, placement === "end" ? "out" : "in");
}

export interface MoveTransitionInput {
  position?: number;
  layer?: number;
}

/** Move a transition in time and/or to another (existing, unlocked) track. */
export function moveTransition(tx: Transaction, transitionId: string, to: MoveTransitionInput): Transition {
  const project = tx.project;
  const transition = requireTransition(project, transitionId);
  requireUnlocked(project, transition.layer);
  if (typeof to !== "object" || to === null) throw invalid("moveTransition needs a target.");
  const patch: Record<string, unknown> = {};
  if (to.position !== undefined) patch.position = snapSeconds(requireNonNegative(to.position, "position"), project);
  if (to.layer !== undefined) {
    if (!findLayer(project, to.layer)) throw new OpError("not_found", `No track with number ${to.layer}.`, { layer: to.layer });
    requireUnlocked(project, to.layer);
    patch.layer = to.layer;
  }
  return patchTransition(tx, transitionId, patch);
}

/** transition_ops.mask_reader: the mask's reader JSON (`mask_reader`, else `reader`), {} when it has none. */
export function transitionMaskReader(transition: Record<string, unknown>): Record<string, unknown> {
  for (const key of ["mask_reader", "reader"]) {
    const reader = transition[key];
    if (isRecord(reader)) return reader;
  }
  return {};
}

/** transition_ops.uses_static_mask: the mask is one still image (its curves follow the transition's length). */
export function usesStaticMask(transition: Record<string, unknown>): boolean {
  const data = transitionMaskReader(transition);
  if ("has_single_image" in data) return Boolean(data.has_single_image);
  return isSingleImageMedia(data);
}

/**
 * Keyframes of a static-mask transition whose length changed from `oldFrames`
 * to `newFrames` (timeline.py `update_transition_data`): X rescaled with the
 * desktop rule, then the first point anchored at 1 and the last at
 * `newFrames + 1` (`_anchor_transition_endpoint_keyframes`).
 */
export function rescaleTransitionKeyframes(kf: Keyframe, oldFrames: number, newFrames: number): Keyframe {
  let next = oldFrames && newFrames && oldFrames !== newFrames ? scaleKeyframe(kf, newFrames / oldFrames, "desktop") : kf;
  if (newFrames && next.Points.length >= 2) {
    const points = next.Points.map((p) => ({ ...p, co: { ...p.co } }));
    points[0]!.co.X = 1;
    points[points.length - 1]!.co.X = Math.trunc(newFrames) + 1;
    next = { ...next, Points: points };
  }
  return next;
}

/**
 * Drag one edge of a transition to `timelineSeconds`. Left moves the start
 * (position) and shortens/lengthens it; right moves the end. Static-mask
 * keyframes are rescaled so the animation still spans the whole transition.
 * At least one frame long.
 */
export function trimTransition(tx: Transaction, transitionId: string, edge: Edge, timelineSeconds: number): Transition {
  const project = tx.project;
  const transition = requireTransition(project, transitionId);
  requireUnlocked(project, transition.layer);
  if (edge !== "left" && edge !== "right") throw invalid(`edge must be "left" or "right".`);
  const t = snapSeconds(requireFinite(timelineSeconds, "timelineSeconds"), project);
  const frame = frameSeconds(project);
  const oldDuration = transition.end - transition.start;
  let position = transition.position;
  let end = transition.end;
  if (edge === "left") {
    let delta = t - transition.position;
    delta = Math.max(delta, -transition.position);
    delta = Math.min(delta, oldDuration - frame);
    position = snapSeconds(transition.position + delta, project);
    end = snapSeconds(transition.end - delta, project);
  } else {
    end = snapSeconds(Math.max(transition.start + (t - transition.position), transition.start + frame), project);
  }
  const newDuration = end - transition.start;
  const rate = rateOf(project);
  const oldFrames = oldDuration > 0 ? pyRound(oldDuration * rate) : 0;
  const newFrames = newDuration > 0 ? pyRound(newDuration * rate) : 0;
  const patch: Record<string, unknown> = { position, end };
  if (usesStaticMask(transition)) {
    for (const prop of ["brightness", "contrast"] as const) {
      if (transition[prop]) patch[prop] = rescaleTransitionKeyframes(transition[prop], oldFrames, newFrames);
    }
  }
  return patchTransition(tx, transitionId, patch);
}

/** Flip a transition's direction (desktop Reverse_Transition_Triggered: brightness/contrast mirrored in time). */
export function reverseTransition(tx: Transaction, transitionId: string): Transition {
  const transition = requireTransition(tx.project, transitionId);
  requireUnlocked(tx.project, transition.layer);
  return patchTransition(tx, transitionId, reversedTransitionCurves(transition));
}

/** Remove a transition. Returns its id. */
export function removeTransition(tx: Transaction, transitionId: string): string {
  const transition = requireTransition(tx.project, transitionId);
  requireUnlocked(tx.project, transition.layer);
  tx.delete(["effects", { id: transitionId }]);
  return transitionId;
}

export type CurveDirection = "default" | "reversed";

/**
 * Which way a transition's progress curve runs (transition_ops.direction_of):
 * "default" when brightness falls (the lower clip wipes away), "reversed"
 * when it rises, null when it has fewer than two points or ends where it
 * starts.
 */
export function transitionDirection(transition: Record<string, unknown>): CurveDirection | null {
  const brightness = transition.brightness;
  const points = isRecord(brightness) && Array.isArray(brightness.Points) ? brightness.Points : [];
  const keyed: [number, number][] = [];
  for (const point of points) {
    const co = isRecord(point) && isRecord(point.co) ? point.co : null;
    if (!co) continue;
    const x = Number(co.X);
    const y = Number(co.Y);
    if (co.X === null || co.Y === null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    keyed.push([x, y]);
  }
  if (keyed.length < 2) return null;
  keyed.sort((a, b) => a[0] - b[0]);
  const first = keyed[0]![1];
  const last = keyed[keyed.length - 1]![1];
  return first > last ? "default" : first < last ? "reversed" : null;
}

/** transition_ops.frames_for: whole frames in `seconds`, rounded half up like frame_time (zenvi-core #181). */
function framesFor(seconds: number, rate: number): number {
  return Math.max(0, Math.floor(Math.max(0, Number(seconds) || 0) * rate + 0.5));
}

type Curves = Partial<Pick<Transition, "brightness" | "contrast">>;

/**
 * A static mask's brightness and contrast fitted to a new length
 * (transition_ops.rescale_curves, what a drag-trim does): X values scaled by
 * new/old frames with the desktop rule, then the first point pinned at frame
 * 1 and the last at the new end. Animated masks keep their curves ({}).
 */
export function rescaledTransitionCurves(transition: Record<string, unknown>, oldDuration: number, newDuration: number, fps: Fraction): Curves {
  if (!usesStaticMask(transition)) return {};
  const rate = fps.num / fps.den;
  const oldFrames = framesFor(oldDuration, rate);
  const newFrames = framesFor(newDuration, rate);
  const out: Curves = {};
  for (const prop of ["brightness", "contrast"] as const) {
    const kf = transition[prop];
    if (isRecord(kf)) out[prop] = rescaleTransitionKeyframes(kf as unknown as Keyframe, oldFrames, newFrames);
  }
  return out;
}

/** The curves mirrored in time (transition_ops.reverse_transition_data, Transition ▸ Reverse). */
export function reversedTransitionCurves(transition: Record<string, unknown>): Curves {
  const out: Curves = {};
  for (const prop of ["brightness", "contrast"] as const) {
    const kf = transition[prop];
    if (isRecord(kf)) out[prop] = reverseKeyframe(kf as unknown as Keyframe);
  }
  return out;
}

/**
 * Timing and curves for a transition whose mask changed between a still and
 * an animated one (transition_ops.set_mask_defaults): a still starts at 0
 * with brightness 1 → -1 and contrast 3; an animated mask keeps its range
 * with flat 0 curves (the video drives the wipe).
 */
export function maskDefaultCurves(
  transition: Record<string, unknown>,
  fps: Fraction,
): { start: number; end: number; duration: number; brightness: Keyframe; contrast: Keyframe } {
  const start = Number(transition.start) || 0;
  let end = Number(transition.end) || start;
  if (end < start) end = start;
  const duration = Math.max(0, end - start);
  if (usesStaticMask(transition)) {
    return { start: 0, end: duration, duration, ...transitionKeyframes(duration, fps, 1.0, -1.0, 3.0) };
  }
  return { start, end, duration, ...transitionKeyframes(duration, fps, 0.0, 0.0, 0.0) };
}

/**
 * Save a transition's new data as a whole (what the desktop's
 * `Transition.save` of an edited dict records): changed keys are written,
 * keys `next` no longer has are deleted. Refused on locked tracks.
 */
export function writeTransition(tx: Transaction, transitionId: string, next: Record<string, unknown>): Transition {
  const project = tx.project;
  const current = requireTransition(project, transitionId);
  if (!isRecord(next)) throw invalid("writeTransition needs the transition's data.");
  if (next.id !== transitionId) throw invalid("A transition's id cannot change.");
  requireUnlocked(project, current.layer);
  const layer = Number(next.layer);
  if (layer !== current.layer) {
    if (!findLayer(project, layer)) throw new OpError("not_found", `No track with number ${String(next.layer)}.`, { layer: next.layer });
    requireUnlocked(project, layer);
  }
  const changed = changedFields(current as Record<string, unknown>, next);
  if (Object.keys(changed).length > 0) tx.update(["effects", { id: transitionId }], changed);
  for (const key of Object.keys(current)) {
    if (!(key in next)) tx.delete(["effects", { id: transitionId }, key]);
  }
  return requireTransition(tx.project, transitionId);
}

const TRANSITION_KEYFRAMES = new Set(["brightness", "contrast"]);
const TRANSITION_FLAGS = new Set(["replace_image", "fade_audio_hint"]);

/**
 * Set a transition property with the same keyframe rules as
 * `setClipProperty` (`at.frame` counts from the transition start):
 * `brightness`/`contrast` (keyframes), `replace_image`/`fade_audio_hint`
 * (flags), `title`, `position`/`layer` (move), `end` (length), and `mask`
 * (a catalog id or path: swaps the mask image and resets the keyframes to
 * the desktop defaults, `_set_transition_mask_defaults`).
 */
export function setTransitionProperty(
  tx: Transaction,
  transitionId: string,
  prop: string,
  value: PropertyValue,
  at: KeyframeAt = {},
): Transition {
  const project = tx.project;
  const transition = requireTransition(project, transitionId);
  requireUnlocked(project, transition.layer);
  if (at.interpolation !== undefined && ![0, 1, 2].includes(at.interpolation)) {
    throw invalid("interpolation must be 0 (bezier), 1 (linear) or 2 (constant).");
  }
  const keyframeAt = at.frame !== undefined || at.time !== undefined;
  if (TRANSITION_KEYFRAMES.has(prop)) {
    const meta = TRANSITION_PROPERTIES[prop];
    const n = requireFinite(value, prop);
    if (meta && meta.min !== null && meta.max !== null && (n < meta.min || n > meta.max)) {
      throw invalid(`${prop} must be between ${meta.min} and ${meta.max} (got ${n}).`);
    }
    if (at.frame !== undefined && at.time !== undefined) throw invalid("Give at most one of frame / time.");
    const frame =
      at.frame !== undefined
        ? requireFinite(at.frame, "frame")
        : at.time !== undefined
          ? clipFrameAtTime(transition, requireFinite(at.time, "time"), fpsOf(project))
          : undefined;
    const next = writeKeyframeValue(transition[prop] as Keyframe | undefined, n, frame, at.interpolation);
    return patchTransition(tx, transitionId, { [prop]: next });
  }
  if (keyframeAt) throw invalid(`${prop} is not keyframeable.`);
  if (TRANSITION_FLAGS.has(prop)) {
    if (typeof value !== "boolean") throw invalid(`${prop} must be true or false.`);
    return patchTransition(tx, transitionId, { [prop]: value });
  }
  if (prop === "title") {
    if (typeof value !== "string") throw invalid("title must be a string.");
    return patchTransition(tx, transitionId, { title: value });
  }
  if (prop === "position" || prop === "layer") {
    return moveTransition(tx, transitionId, { [prop]: requireFinite(value, prop) });
  }
  if (prop === "end") {
    return trimTransition(tx, transitionId, "right", transition.position + requireFinite(value, prop) - transition.start);
  }
  if (prop === "mask") {
    if (typeof value !== "string") throw invalid("mask must be a catalog id or path.");
    const mask = resolveMask(undefined, value);
    const duration = transition.end - transition.start;
    const { brightness, contrast } = transitionKeyframes(duration, fpsOf(project));
    return patchTransition(tx, transitionId, {
      reader: maskReader(mask.path, mask.width, mask.height),
      start: 0,
      end: duration,
      brightness,
      contrast,
    });
  }
  throw invalid(`Unknown transition property: ${prop}.`);
}

export interface MissingTransition {
  position: number;
  layer: number;
  start: number;
  end: number;
}

/**
 * The automatic transition a clip's overlap on its own track calls for
 * (timeline.py `_find_missing_transition_details`): the first overlap of at
 * least 0.5 s with a clip on the same track, unless a transition already
 * starts or ends there (±0.01 s). Null when none is needed.
 */
export function findMissingTransition(project: Transaction["project"], clipId: string): MissingTransition | null {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const duration = Number(clip.end) - Number(clip.start);
  if (!(duration > 0)) return null;
  const left = Number(clip.position);
  const right = left + duration;
  let found: MissingTransition | null = null;
  const sameLayer = project.clips
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.layer === clip.layer)
    .sort((a, b) => Number(a.c.position) - Number(b.c.position) || a.i - b.i)
    .map(({ c }) => c);
  for (const other of sameLayer) {
    if (other.id === clipId) continue;
    const otherLeft = Number(other.position);
    const otherRight = otherLeft + (Number(other.end) - Number(other.start));
    if (left < otherRight && left > otherLeft) {
      found = { position: left, layer: clip.layer, start: 0, end: otherRight - left };
    } else if (right > otherLeft && right < otherRight) {
      found = { position: otherLeft, layer: clip.layer, start: 0, end: right - otherLeft };
    }
    if (found && found.end >= 0.5) break;
    if (found && found.end < 0.5) found = null;
  }
  if (!found) return null;
  const newLeft = found.position;
  const newRight = found.position + (found.end - found.start);
  for (const t of project.effects) {
    if (t.layer !== clip.layer) continue;
    const tLeft = Number(t.position);
    const tRight = tLeft + (Number(t.end) - Number(t.start));
    if (Math.abs(tLeft - newLeft) < 0.01 || Math.abs(tRight - newRight) < 0.01) return null;
  }
  return found;
}

/**
 * Add the automatic transition for a clip's new overlap, if one is needed
 * (timeline.py `add_missing_transition`: fade mask, brightness 1 → -1,
 * contrast 3, `fade_audio_hint` so the audio crossfades too). The desktop
 * does this only when its "Auto-Transition" preference is on; callers decide.
 * Returns the transition, or null when none was needed.
 */
export function addAutoTransition(tx: Transaction, clipId: string): Transition | null {
  requireClip(tx.project, clipId);
  const missing = findMissingTransition(tx.project, clipId);
  if (!missing) return null;
  requireUnlocked(tx.project, missing.layer);
  const transition = createTransition({
    id: ids(tx.project)(),
    layer: missing.layer,
    position: missing.position,
    duration: missing.end - missing.start,
    reader: maskReader("@transitions/common/fade.svg"),
    fps: fpsOf(tx.project),
    direction: "in",
    fadeAudio: true,
  });
  tx.insert(["effects"], transition);
  return requireTransition(tx.project, transition.id);
}
