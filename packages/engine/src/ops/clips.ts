/**
 * Timeline clip operations.
 *
 * Ported from zenvi-core src/windows/views/timeline.py (addClip,
 * update_clip_data + clip_utils.clamp_timing_to_media, Slice_Triggered,
 * Time_Triggered + retime.py, Fade_Triggered, Split_Audio_Triggered,
 * RemoveGap_Triggered), src/windows/main_window.py (remove / ripple delete),
 * src/windows/models/properties_model.py (property edits) and
 * src/classes/tool_handlers.py (`set_clip_volume`). Every op validates first
 * and throws `OpError` before recording anything.
 */

import type { Transaction } from "../history/document.js";
import type { Clip, ColorKeyframe, Keyframe, KeyframePoint, Project } from "../model/types.js";
import { Interpolation, ScaleMode } from "../model/types.js";
import { createClip, type CreateClipInput } from "../model/defaults.js";
import { createEffect } from "../effects/registry.js";
import { CLIP_COLOR_KEYS, CLIP_KEYFRAME_KEYS, CLIP_PROPERTIES, hasChoices } from "../model/properties.js";
import { findClip, findLayer, findTransition } from "../model/query.js";
import { pyRound } from "../model/rounding.js";
import {
  constantKeyframe,
  makeKeyframePoint,
  openshotPoint,
  removeKeyframePointsInRange,
  setKeyframePoints,
  type PointOptions,
} from "../keyframe/edit.js";
import { evaluate } from "../keyframe/evaluate.js";
import { itemEnd } from "../timeline/windows.js";
import { findGap, itemsOnLayer } from "../timeline/queries.js";
import { buildStaticLevelPoints, currentStaticLevel, dbToGain, hasAudioStream } from "../tools/audio-mix.js";
import {
  OpError,
  invalid,
  requireClip,
  requireFile,
  requireFinite,
  requireNonNegative,
  requireObject,
  requireUnlocked,
} from "./errors.js";
import {
  clipFile,
  ensureLayer,
  fpsOf,
  frameSeconds,
  ids,
  isRecord,
  patchClip,
  patchTransition,
  rateOf,
  reassignEffectIds,
  requireEditableClip,
  resolveClipFrame,
  sameJson,
  snapSeconds,
  withClampedTiming,
} from "./internal.js";
import { retimeClip } from "./retime.js";
import { requireInterpolation, writeColorKeyframe, writeKeyframeValue } from "./values.js";
import { addAutoTransition } from "./transitions.js";
import { trackBelowOrCreate } from "./tracks.js";
import type { ColorInput, Edge, KeyframeAt, KeyframePointInput, PropertyValue, SliceKeep } from "./types.js";

// ---------------------------------------------------------------------------
// Add / move / trim
// ---------------------------------------------------------------------------

export interface AddClipInput {
  /** `project.files[].id` to play. */
  fileId: string;
  /** Timeline start, seconds (>= 0). Snapped to the frame grid. */
  position: number;
  /**
   * Track number (`layers[].number`). A missing track with that number is
   * created, like the desktop's `_ensure_layers_exist`; a locked one refuses.
   */
  layer: number;
  /** Source in point, seconds. Default 0 (a subclip's own `start`). */
  start?: number;
  /**
   * Source out point, seconds. Default the media duration; still images use
   * the desktop `default-image-length` (10 s).
   */
  end?: number;
  /** Clip title. Default the file's display name (basename of its path). */
  title?: string;
  /** Explicit id (tests, deterministic imports). */
  id?: string;
  /**
   * Add the automatic transition when the clip overlaps another on its track
   * (`addAutoTransition`; the desktop's "Auto-Transition" preference). Default false.
   */
  autoTransition?: boolean;
}

/**
 * Add a clip to the timeline: the full libopenshot default clip JSON plus a
 * snapshot of the file's reader, like the desktop's add-to-timeline
 * (including audio-only overrides and media-clamped timing). Returns the
 * inserted clip.
 */
export function addClip(tx: Transaction, input: AddClipInput): Clip {
  const project = tx.project;
  requireObject(input, "addClip input");
  const file = requireFile(project, input.fileId);
  const position = requireNonNegative(input.position, "position");
  if (!Number.isInteger(input.layer) || input.layer <= 0) {
    throw invalid(`layer must be a positive track number (got ${input.layer}).`);
  }
  requireUnlocked(project, input.layer);
  if (input.start !== undefined) requireNonNegative(input.start, "start");
  if (input.end !== undefined) requireNonNegative(input.end, "end");
  if (input.start !== undefined && input.end !== undefined && input.end <= input.start) {
    throw invalid(`end (${input.end}) must be after start (${input.start}).`);
  }
  if (input.id !== undefined && findClip(project, input.id)) {
    throw new OpError("conflict", `A clip with id ${input.id} already exists.`, { id: input.id });
  }
  if (input.title !== undefined && typeof input.title !== "string") throw invalid("title must be a string.");

  const nextId = ids(project);
  const id = input.id ?? nextId();
  const clipInput: CreateClipInput = {
    id,
    file,
    position: snapSeconds(position, project),
    layer: input.layer,
    fps: fpsOf(project),
  };
  if (input.start !== undefined) clipInput.start = input.start;
  if (input.end !== undefined) clipInput.end = input.end;
  if (input.title !== undefined) clipInput.title = input.title;
  const clip = withClampedTiming(createClip(clipInput) as unknown as Record<string, unknown>, project) as unknown as Clip;
  if (!(clip.end - clip.start > 0)) {
    throw invalid(`The requested range leaves the clip empty (media is ${String(file.duration ?? "?")} s).`);
  }
  // apply_file_caption_to_clip: stored caption text becomes a Caption effect.
  const caption = typeof file.caption === "string" ? file.caption.trim() : "";
  if (caption) clip.effects = [createEffect("Caption", { caption_text: caption }, { id: nextId() })];
  ensureLayer(tx, input.layer);
  tx.insert(["clips"], clip);
  if (input.autoTransition) addAutoTransition(tx, id);
  return requireClip(tx.project, id);
}

export interface MoveClipInput {
  /** New timeline start, seconds (>= 0). Snapped to the frame grid. */
  position?: number;
  /** New track number. The track must exist and be unlocked. */
  layer?: number;
  /** Add the automatic transition when the move creates an overlap (desktop drag). Default false. */
  autoTransition?: boolean;
}

/** Move a clip in time and/or to another track. Moving nowhere records nothing. */
export function moveClip(tx: Transaction, clipId: string, to: MoveClipInput): Clip {
  const project = tx.project;
  requireEditableClip(project, clipId);
  requireObject(to, "moveClip target");
  const patch: Record<string, unknown> = {};
  if (to.position !== undefined) patch.position = snapSeconds(requireNonNegative(to.position, "position"), project);
  if (to.layer !== undefined) {
    if (!findLayer(project, to.layer)) {
      throw new OpError("not_found", `No track with number ${to.layer}.`, { layer: to.layer });
    }
    requireUnlocked(project, to.layer);
    patch.layer = to.layer;
  }
  const moved = patchClip(tx, clipId, patch);
  if (to.autoTransition) addAutoTransition(tx, clipId);
  return moved;
}

export interface TrimClipInput {
  /** New source in point, seconds. */
  start?: number;
  /** New source out point, seconds. */
  end?: number;
}

/** The timing fields of a clamped clip, including `time` only when the clamp rewrote it. */
function timingPatch(before: Clip, next: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { start: next.start, end: next.end, duration: next.duration };
  if (next.time !== undefined && next.time !== before.time) out.time = next.time;
  return out;
}

/**
 * Change a clip's source in/out points without moving its timeline position
 * (desktop Properties "Start"/"End", snapped to the frame grid). Values are
 * clamped to the media like the desktop's `clamp_timing_to_media`; an empty
 * result is refused.
 */
export function trimClip(tx: Transaction, clipId: string, range: TrimClipInput): Clip {
  const project = tx.project;
  const clip = requireEditableClip(project, clipId);
  requireObject(range, "trimClip range");
  const start = range.start === undefined ? clip.start : snapSeconds(requireNonNegative(range.start, "start"), project);
  const end = range.end === undefined ? clip.end : snapSeconds(requireNonNegative(range.end, "end"), project);
  const next = withClampedTiming({ ...clip, start, end, duration: end - start } as Record<string, unknown>, project);
  if (!((next.end as number) - (next.start as number) > 0)) {
    throw invalid(`Trimming to ${start}..${end} leaves clip ${clipId} empty.`);
  }
  return patchClip(tx, clipId, timingPatch(clip, next));
}

/**
 * Drag one edge of a clip to `timelineSeconds`, like the desktop timeline trim
 * handles. Left: moves `position` and `start` together (the content stays put
 * on screen). Right: moves `end`. Clamped to the media, the timeline start and
 * a one-frame minimum length.
 */
export function trimClipEdge(tx: Transaction, clipId: string, edge: Edge, timelineSeconds: number): Clip {
  const project = tx.project;
  const clip = requireEditableClip(project, clipId);
  if (edge !== "left" && edge !== "right") throw invalid(`edge must be "left" or "right" (got ${String(edge)}).`);
  const t = snapSeconds(requireFinite(timelineSeconds, "timelineSeconds"), project);
  const frame = frameSeconds(project);
  let patch: Record<string, unknown>;
  if (edge === "left") {
    let delta = t - clip.position;
    delta = Math.max(delta, -clip.start, -clip.position);
    delta = Math.min(delta, clip.end - clip.start - frame);
    const start = snapSeconds(clip.start + delta, project);
    const position = snapSeconds(clip.position + delta, project);
    patch = { position, start, end: clip.end, duration: clip.end - start };
  } else {
    let end = clip.start + (t - clip.position);
    end = Math.max(end, clip.start + frame);
    end = snapSeconds(end, project);
    patch = { start: clip.start, end, duration: end - clip.start };
  }
  const next = withClampedTiming({ ...clip, ...patch } as Record<string, unknown>, project);
  if (!((next.end as number) - (next.start as number) > 0)) {
    throw invalid(`Trimming clip ${clipId} there leaves it empty.`);
  }
  const out = timingPatch(clip, next);
  if (patch.position !== undefined) out.position = patch.position;
  return patchClip(tx, clipId, out);
}

// ---------------------------------------------------------------------------
// Split / delete / duplicate
// ---------------------------------------------------------------------------

export interface SplitClipResult {
  /** Id of the part before the cut (the original clip), or null when not kept. */
  leftId: string | null;
  /** Id of the part after the cut (a new clip when both are kept), or null when not kept. */
  rightId: string | null;
}

/**
 * The time the desktop slices at: snapped to the frame grid, plus one frame
 * for keep-left so the left part includes the frame under the playhead
 * (timeline.py Slice_Triggered).
 */
function slicePoint(project: Project, atSeconds: number, keep: SliceKeep): number {
  const fps = fpsOf(project);
  let t = (pyRound((atSeconds * fps.num) / fps.den) * fps.den) / fps.num;
  if (keep === "left") t += fps.den / fps.num;
  return t;
}

function requireKeep(keep: SliceKeep): void {
  if (keep !== "both" && keep !== "left" && keep !== "right") throw invalid(`keep must be both, left or right.`);
}

/** Split a clip at an already computed slice time. */
function splitAt(tx: Transaction, clip: Clip, at: number, keep: SliceKeep): SplitClipResult {
  const project = tx.project;
  const position = Number(clip.position);
  const start = Number(clip.start);
  const end = Number(clip.end);
  const newEnd = start + (at - position);
  if (keep === "left") {
    const left = withClampedTiming({ ...clip, end: newEnd, duration: Math.max(0, newEnd - start) } as Record<string, unknown>, project);
    patchClip(tx, clip.id, timingPatch(clip, left));
    return { leftId: clip.id, rightId: null };
  }
  if (keep === "right") {
    const right = withClampedTiming(
      { ...clip, position: at, start: newEnd, duration: Math.max(0, end - newEnd) } as Record<string, unknown>,
      project,
    );
    patchClip(tx, clip.id, { ...timingPatch(clip, right), position: at });
    return { leftId: null, rightId: clip.id };
  }
  const nextId = ids(project);
  const rightData = structuredClone(clip) as Record<string, unknown>;
  rightData.id = nextId();
  rightData.position = at;
  rightData.start = newEnd;
  rightData.end = end;
  rightData.duration = Math.max(0, end - newEnd);
  delete rightData.ai_metadata;
  reassignEffectIds(rightData, nextId);
  const left = withClampedTiming({ ...clip, end: newEnd, duration: Math.max(0, newEnd - start) } as Record<string, unknown>, project);
  patchClip(tx, clip.id, timingPatch(clip, left));
  tx.insert(["clips"], withClampedTiming(rightData, project));
  return { leftId: clip.id, rightId: rightData.id as string };
}

/**
 * Cut a clip at timeline time `atSeconds` (desktop Slice_Triggered). `both`
 * keeps the original clip as the left part and adds a new clip for the right
 * part (new clip and effect ids; clip-level `ai_metadata` is not copied);
 * `left`/`right` keep only that side. As on the desktop the cut snaps to the
 * frame grid and keep-left includes the frame at the cut. Keyframes need no
 * shifting because clip keyframes are in source frame space; both parts keep
 * them all. The cut must fall strictly inside the clip.
 */
export interface SplitClipOptions {
  /**
   * Ripple slice (desktop W / Q): after keeping one side, close the gap the
   * removed part leaves by moving later items on the track left. Only with
   * `left` / `right`.
   */
  ripple?: boolean;
}

export function splitClip(
  tx: Transaction,
  clipId: string,
  atSeconds: number,
  keep: SliceKeep = "both",
  opts: SplitClipOptions = {},
): SplitClipResult {
  const project = tx.project;
  const clip = requireEditableClip(project, clipId);
  requireKeep(keep);
  if (opts.ripple && keep === "both") throw invalid("A ripple slice keeps one side (left or right).");
  const at = slicePoint(project, requireFinite(atSeconds, "atSeconds"), keep);
  if (!(clip.position < at && at < itemEnd(clip))) {
    throw invalid(`Time ${atSeconds} s is not inside clip ${clipId} (${clip.position}..${itemEnd(clip)} s).`);
  }
  if (!opts.ripple) return splitAt(tx, clip, at, keep);
  // timeline.py Slice_Triggered(ripple=True): trim, then ripple_delete_gap (position >= cut).
  const originalPosition = Number(clip.position);
  const start = Number(clip.start);
  const end = Number(clip.end);
  const newEdge = start + (at - originalPosition);
  const removed = keep === "left" ? end - start - (newEdge - start) : end - start - (end - newEdge);
  const later = (p: number): boolean => p >= at;
  const result = splitAt(tx, clip, at, keep);
  if (keep === "right") patchClip(tx, clipId, { position: originalPosition });
  for (const c of tx.project.clips.filter((c) => c.layer === clip.layer && c.id !== clipId && later(Number(c.position)))) {
    tx.update(["clips", { id: c.id }], { position: Number(c.position) - removed });
  }
  for (const t of tx.project.effects.filter((t) => t.layer === clip.layer && later(Number(t.position)))) {
    tx.update(["effects", { id: t.id }], { position: Number(t.position) - removed });
  }
  return result;
}

export interface SliceAllOptions {
  keep?: SliceKeep;
  /** Only items on these tracks. Default every unlocked track. */
  layers?: readonly number[];
}

export interface SliceAllResult {
  clips: (SplitClipResult & { clipId: string })[];
  transitions: (SplitClipResult & { transitionId: string })[];
}

/**
 * Cut every clip and transition under timeline time `atSeconds` (desktop
 * playhead "Slice All" / `slice_clip_at_playhead_tool`). Items on locked
 * tracks are skipped, as are items with an edge exactly at the cut. Nothing
 * under the time records nothing.
 */
export function sliceAllAt(tx: Transaction, atSeconds: number, opts: SliceAllOptions = {}): SliceAllResult {
  const project = tx.project;
  const keep = opts.keep ?? "both";
  requireKeep(keep);
  const at = slicePoint(project, requireFinite(atSeconds, "atSeconds"), keep);
  const locked = new Set(project.layers.filter((l) => l.lock).map((l) => l.number));
  const wanted = opts.layers ? new Set(opts.layers) : null;
  const eligible = (layer: number): boolean => !locked.has(layer) && (wanted === null || wanted.has(layer));
  const clipIds = project.clips.filter((c) => eligible(c.layer) && c.position < at && at < itemEnd(c)).map((c) => c.id);
  const transitionIds = project.effects
    .filter((t) => eligible(t.layer) && t.position < at && at < itemEnd(t))
    .map((t) => t.id);
  const result: SliceAllResult = { clips: [], transitions: [] };
  for (const id of clipIds) result.clips.push({ clipId: id, ...splitAt(tx, requireClip(tx.project, id), at, keep) });
  for (const id of transitionIds) result.transitions.push({ transitionId: id, ...sliceTransition(tx, id, at, keep) });
  return result;
}

/** Slice one transition at an already computed time (Slice_Triggered transition branch). */
function sliceTransition(tx: Transaction, id: string, at: number, keep: SliceKeep): SplitClipResult {
  const t = findTransition(tx.project, id)!;
  const position = Number(t.position);
  const start = Number(t.start);
  const end = Number(t.end);
  const newEnd = start + (at - position);
  if (keep === "left") {
    patchTransition(tx, id, { end: newEnd, duration: Math.max(0, newEnd - start) });
    return { leftId: id, rightId: null };
  }
  if (keep === "right") {
    patchTransition(tx, id, { position: at, start: newEnd, duration: Math.max(0, end - newEnd) });
    return { leftId: null, rightId: id };
  }
  const right = structuredClone(t) as Record<string, unknown>;
  right.id = ids(tx.project)();
  right.position = at;
  right.start = newEnd;
  right.end = end;
  right.duration = Math.max(0, end - newEnd);
  patchTransition(tx, id, { end: newEnd, duration: Math.max(0, newEnd - start) });
  tx.insert(["effects"], right);
  return { leftId: id, rightId: right.id as string };
}

export interface DeleteClipsOptions {
  /**
   * Close the gap each deleted clip leaves on its track by moving later clips
   * and transitions on that track left (desktop ripple delete). Default false.
   */
  ripple?: boolean;
}

/**
 * Delete clips. Unknown ids refuse with `not_found` and clips on locked
 * tracks with `locked` (nothing is deleted). Returns the deleted ids.
 */
export function deleteClips(tx: Transaction, clipIds: readonly string[], opts: DeleteClipsOptions = {}): string[] {
  const project = tx.project;
  if (!Array.isArray(clipIds)) throw invalid("clipIds must be an array.");
  const unique = [...new Set(clipIds)];
  for (const id of unique) requireEditableClip(project, id);
  for (const id of unique) {
    const clip = requireClip(tx.project, id);
    const startPosition = Number(clip.position);
    const duration = Number(clip.end) - Number(clip.start);
    tx.delete(["clips", { id }]);
    if (opts.ripple) rippleShift(tx, clip.layer, startPosition, duration);
  }
  return unique;
}

/** main_window.py `ripple_delete_gap`: items on `layer` strictly after `from` move left by `gap`. */
export function rippleShift(tx: Transaction, layer: number, from: number, gap: number): void {
  for (const c of tx.project.clips.filter((c) => c.layer === layer && c.position > from)) {
    tx.update(["clips", { id: c.id }], { position: c.position - gap });
  }
  for (const t of tx.project.effects.filter((t) => t.layer === layer && t.position > from)) {
    tx.update(["effects", { id: t.id }], { position: t.position - gap });
  }
}

export interface DuplicateClipOptions {
  /** Timeline start of the copy. Default: right after the original on its track. */
  position?: number;
  /** Track of the copy. Default: the original's track. */
  layer?: number;
  id?: string;
}

/** Copy a clip (new clip id and new effect ids, like desktop paste). Returns the copy. */
export function duplicateClip(tx: Transaction, clipId: string, opts: DuplicateClipOptions = {}): Clip {
  const project = tx.project;
  const clip = requireClip(project, clipId);
  const layer = opts.layer ?? clip.layer;
  if (opts.layer !== undefined && !findLayer(project, layer)) {
    throw new OpError("not_found", `No track with number ${layer}.`, { layer });
  }
  requireUnlocked(project, layer);
  const position =
    opts.position === undefined ? itemEnd(clip) : snapSeconds(requireNonNegative(opts.position, "position"), project);
  if (opts.id !== undefined && findClip(project, opts.id)) {
    throw new OpError("conflict", `A clip with id ${opts.id} already exists.`, { id: opts.id });
  }
  const nextId = ids(project);
  const copy = structuredClone(clip) as Record<string, unknown>;
  copy.id = opts.id ?? nextId();
  copy.position = position;
  copy.layer = layer;
  reassignEffectIds(copy, nextId);
  tx.insert(["clips"], copy);
  return requireClip(tx.project, copy.id as string);
}

/**
 * Close the empty gap on track `layer` that `findGap` reports for
 * `atSeconds` by moving every later clip and transition on that track left
 * (desktop RemoveGap_Triggered). Returns the gap length removed (0 when there
 * is no gap there, in which case nothing is recorded).
 */
export function removeGap(tx: Transaction, layer: number, atSeconds: number): number {
  const project = tx.project;
  requireFinite(atSeconds, "atSeconds");
  if (!findLayer(project, layer)) throw new OpError("not_found", `No track with number ${layer}.`, { layer });
  requireUnlocked(project, layer);
  const gap = findGap(project, layer, atSeconds);
  if (!gap) return 0;
  const size = gap.end - gap.start;
  const clipIds = new Set(project.clips.map((c) => c.id));
  for (const item of itemsOnLayer(project, layer)) {
    if (item.position > gap.start) {
      tx.update([clipIds.has(item.id) ? "clips" : "effects", { id: item.id }], { position: item.position - size });
    }
  }
  return size;
}

// ---------------------------------------------------------------------------
// Properties and keyframes
// ---------------------------------------------------------------------------

/** Clip keys that are plain values (not keyframes) and may be set directly. */
const PLAIN_CLIP_KEYS: Record<string, "int" | "bool" | "string"> = {
  gravity: "int",
  scale: "int",
  anchor: "int",
  display: "int",
  mixing: "int",
  composite: "int",
  waveform: "bool",
  waveform_mode: "int",
  title: "string",
  parentObjectId: "string",
};

const TIMING_KEYS = new Set(["position", "start", "end", "layer"]);
const SCALE_CLAMP_KEYS = new Set(["scale_x", "scale_y", "shear_x", "shear_y"]);

/**
 * The desktop's guard against huge scale/shear values
 * (properties_model.py:914-929): ±round(2000·k / max(width, height)) with
 * k = 15 for SVG clips, 50 otherwise.
 */
export function maxScaleMultiple(project: Project, clip: Clip): number {
  const isSvg = String(clip.reader?.path ?? "").toLowerCase().endsWith("svg");
  let max = isSvg ? 15 : 50;
  if (project.width > 0 && project.height > 0) max = pyRound((2000 * max) / Math.max(project.width, project.height));
  return max;
}

function choiceValues(prop: string): number[] | null {
  const meta = CLIP_PROPERTIES[prop];
  if (!hasChoices(meta)) return null;
  return meta!.choices!.map((c) => Number(c.value));
}

/**
 * Set one clip property the way the desktop Properties panel does.
 *
 * - Keyframed properties (`alpha`, `location_x`, `scale_x`, `volume`, `time`,
 *   …): with `at.frame`/`at.time`, the point at that frame is updated or a
 *   point is inserted (LINEAR, CONSTANT for choice properties); without it the
 *   property becomes that constant value. `scale_*`/`shear_*` are clamped like
 *   the desktop; `time` values are whole frames.
 * - Color properties (`wave_color`): a `ColorInput`, keyframed per channel.
 * - Plain properties (`gravity`, `scale`, `anchor`, `display`, `mixing`,
 *   `composite`, `waveform`, `waveform_mode`, `title`, `parentObjectId`): set
 *   outright; `at` must be omitted. Choice values must be one of the choices.
 * - `position`/`layer` delegate to `moveClip`, `start`/`end` to `trimClip`.
 *
 * Unknown property names are refused with `invalid_argument`.
 */
export function setClipProperty(
  tx: Transaction,
  clipId: string,
  prop: string,
  value: PropertyValue,
  at: KeyframeAt = {},
): Clip {
  const project = tx.project;
  const clip = requireEditableClip(project, clipId);
  if (typeof prop !== "string" || prop === "") throw invalid("prop is required.");
  const interpolation = requireInterpolation(at.interpolation);
  if (TIMING_KEYS.has(prop)) {
    if (at.frame !== undefined || at.time !== undefined) throw invalid(`${prop} is not keyframeable.`);
    const n = requireFinite(value, prop);
    if (prop === "position") return moveClip(tx, clipId, { position: n });
    if (prop === "layer") return moveClip(tx, clipId, { layer: n });
    return trimClip(tx, clipId, prop === "start" ? { start: n } : { end: n });
  }

  if (CLIP_COLOR_KEYS.includes(prop)) {
    const frame = resolveClipFrame(project, clip, at);
    const next = writeColorKeyframe(clip[prop] as ColorKeyframe | undefined, value as ColorInput, frame, interpolation);
    return patchClip(tx, clipId, { [prop]: next });
  }

  if (CLIP_KEYFRAME_KEYS.includes(prop)) {
    let n = typeof value === "boolean" ? (value ? 1 : 0) : requireFinite(value, prop);
    const choices = choiceValues(prop);
    if (choices && !choices.includes(n)) throw invalid(`${prop} must be one of ${choices.join(", ")} (got ${n}).`);
    if (SCALE_CLAMP_KEYS.has(prop)) {
      const max = maxScaleMultiple(project, clip);
      n = Math.max(Math.min(n, max), -max);
    }
    if (prop === "time") n = Math.trunc(n);
    const frame = resolveClipFrame(project, clip, at);
    const next = writeKeyframeValue(clip[prop] as Keyframe | undefined, n, frame, interpolation, choices !== null);
    return patchClip(tx, clipId, { [prop]: next });
  }

  const kind = PLAIN_CLIP_KEYS[prop];
  if (!kind) throw invalid(`Unknown clip property: ${prop}.`);
  if (at.frame !== undefined || at.time !== undefined) throw invalid(`${prop} is not keyframeable.`);
  if (kind === "string") {
    if (typeof value !== "string") throw invalid(`${prop} must be a string.`);
    return patchClip(tx, clipId, { [prop]: value });
  }
  if (kind === "bool") {
    const b = typeof value === "boolean" ? value : value === 1 ? true : value === 0 ? false : undefined;
    if (b === undefined) throw invalid(`${prop} must be true or false.`);
    return patchClip(tx, clipId, { [prop]: b });
  }
  const n = requireFinite(value, prop);
  if (!Number.isInteger(n)) throw invalid(`${prop} must be an integer (got ${n}).`);
  const choices = choiceValues(prop);
  if (choices && !choices.includes(n)) throw invalid(`${prop} must be one of ${choices.join(", ")} (got ${n}).`);
  return patchClip(tx, clipId, { [prop]: n });
}

export interface SetKeyframesOptions {
  /**
   * `replace` (default): the property's points become exactly `points`.
   * `merge`: each point replaces an existing point at the same frame or is
   * inserted; other points stay.
   */
  mode?: "replace" | "merge";
}

/** Build a JSON point from a `KeyframePointInput` (frame or time resolved against the clip). */
function pointFromInput(project: Project, clip: Clip, input: KeyframePointInput, index: number): KeyframePoint {
  requireObject(input, `points[${index}]`);
  if ((input.frame === undefined) === (input.time === undefined)) {
    throw invalid(`points[${index}] needs exactly one of frame / time.`);
  }
  const frame = resolveClipFrame(project, clip, input.frame !== undefined ? { frame: input.frame } : { time: input.time! });
  const value = requireFinite(input.value, `points[${index}].value`);
  const interpolation = requireInterpolation(input.interpolation) ?? Interpolation.BEZIER;
  const opts: PointOptions = {};
  if (input.handleLeft) opts.handleLeft = input.handleLeft;
  if (input.handleRight) opts.handleRight = input.handleRight;
  if (input.handleType !== undefined) opts.handleType = input.handleType;
  return makeKeyframePoint(frame!, value, interpolation, opts);
}

/** Write many keyframe points of one keyframed clip property at once. */
export function setClipKeyframes(
  tx: Transaction,
  clipId: string,
  prop: string,
  points: readonly KeyframePointInput[],
  opts: SetKeyframesOptions = {},
): Clip {
  const project = tx.project;
  const clip = requireEditableClip(project, clipId);
  if (!CLIP_KEYFRAME_KEYS.includes(prop)) throw invalid(`${prop} is not a keyframed clip property.`);
  if (!Array.isArray(points) || points.length === 0) throw invalid("points must be a non-empty array.");
  const mode = opts.mode ?? "replace";
  if (mode !== "replace" && mode !== "merge") throw invalid(`mode must be replace or merge.`);
  const built = points.map((p, i) => pointFromInput(project, clip, p, i));
  if (prop === "time") for (const p of built) p.co.Y = Math.trunc(p.co.Y);
  const current = clip[prop] as Keyframe | undefined;
  const base: Keyframe = mode === "merge" && current ? current : { ...(current ?? {}), Points: [] };
  return patchClip(tx, clipId, { [prop]: setKeyframePoints(base, built) });
}

// ---------------------------------------------------------------------------
// Time, fades, volume, audio
// ---------------------------------------------------------------------------

export interface SetClipSpeedOptions {
  /** `backward` plays the clip in reverse at `factor` (desktop Time ▸ Backward). Default forward. */
  direction?: "forward" | "backward";
}

/** Replace a clip wholesale when anything changed. */
export function replaceClip(tx: Transaction, before: Clip, after: Clip): Clip {
  if (sameJson(before, after)) return before;
  tx.replace(["clips", { id: before.id }], after);
  return requireClip(tx.project, before.id);
}

/**
 * Play a clip `factor` times faster (2 = twice as fast, 0.5 = half speed),
 * like the desktop Time presets (1/16x to 16x): the clip's timeline length
 * becomes `(end - start) / factor` and the `time` curve (plus every other
 * keyframe) is retimed to match (`retime_clip`).
 */
export function setClipSpeed(tx: Transaction, clipId: string, factor: number, opts: SetClipSpeedOptions = {}): Clip {
  const project = tx.project;
  const clip = requireEditableClip(project, clipId);
  const f = requireFinite(factor, "factor");
  if (!(f >= 1 / 16 && f <= 16)) throw invalid(`factor must be between 1/16 and 16 (got ${f}).`);
  const direction = opts.direction ?? "forward";
  if (direction !== "forward" && direction !== "backward") throw invalid(`direction must be forward or backward.`);
  const newEnd = Number(clip.start) + (Number(clip.end) - Number(clip.start)) / f;
  const retimed = retimeClip(clip, newEnd, fpsOf(project), direction === "backward" ? -1 : 1, clip.position);
  if (!retimed) throw invalid(`Speed ${f} leaves clip ${clipId} empty.`);
  const next = withClampedTiming(retimed as unknown as Record<string, unknown>, project, clip);
  return replaceClip(tx, clip, next as unknown as Clip);
}

export interface RetimeClipInput {
  /** New length on the timeline, seconds (> 0). */
  duration: number;
  /** New timeline start, seconds (left-edge drags move it). Default unchanged. */
  position?: number;
}

/**
 * Timing-mode drag (desktop Timing tool, timeline.py `RetimeClip`): stretch
 * or squeeze a clip to a new timeline length, changing its speed instead of
 * its content (retime.py `retime_clip`, forward). Cached waveform samples are
 * dropped because they no longer match.
 */
export function retimeClipTo(tx: Transaction, clipId: string, input: RetimeClipInput): Clip {
  const project = tx.project;
  const clip = requireEditableClip(project, clipId);
  requireObject(input, "retimeClipTo input");
  const duration = requireFinite(input.duration, "duration");
  if (!(duration > 0)) throw invalid("duration must be > 0.");
  const position = input.position === undefined ? clip.position : requireNonNegative(input.position, "position");
  const retimed = retimeClip(clip, Number(clip.start) + duration, fpsOf(project), 1, position);
  if (!retimed) throw invalid("That length leaves the clip empty.");
  if (isRecord(retimed.ui)) {
    const ui = { ...retimed.ui };
    for (const key of ["audio_data", "audio_data_rms", "audio_data_rate", "audio_data_format"]) delete ui[key];
    retimed.ui = ui;
  }
  return replaceClip(tx, clip, withClampedTiming(retimed as unknown as Record<string, unknown>, project, clip) as unknown as Clip);
}

export interface FadeClipOptions {
  /** Fade-in length in seconds from the clip start (0 removes a fade-in). */
  fadeIn?: number;
  /** Fade-out length in seconds before the clip end (0 removes a fade-out). */
  fadeOut?: number;
  /** Fade the picture (`alpha`). Default true when the clip has video (or shows its waveform). */
  video?: boolean;
  /** Fade the sound (`volume`). Default true when the clip has audio. */
  audio?: boolean;
}

/** Desktop fade zone: 3 s (the slow fade), timeline.py Fade_Triggered. */
export const FADE_ZONE_SECONDS = 3.0;

/** What the desktop fades for a clip: alpha when it shows a picture (or waveform), volume when it has audio. */
export function fadeTargets(clip: Clip): { alpha: boolean; volume: boolean } {
  const reader: Record<string, unknown> = isRecord(clip.reader) ? clip.reader : {};
  return {
    alpha: Boolean(reader.has_video ?? true) || Boolean(clip.waveform),
    volume: Boolean(reader.has_audio ?? true),
  };
}

/**
 * Fade-in for one keyframe (Fade_Triggered IN_* branch): clear the 3 s zone,
 * then 0 at the clip's first frame rising to the zone-boundary value after
 * `length` seconds.
 */
export function fadeInKeyframe(kf: Keyframe | undefined, startOfClip: number, endOfClip: number, length: number, rate: number): Keyframe {
  const zoneEnd = Math.min(startOfClip + FADE_ZONE_SECONDS * rate, endOfClip);
  const target = evaluate(kf, Math.trunc(pyRound(zoneEnd)), 1.0);
  const endAnimation = Math.min(startOfClip + length * rate, endOfClip);
  const cleared = removeKeyframePointsInRange(kf, startOfClip, zoneEnd);
  return setKeyframePoints(cleared, [
    openshotPoint(startOfClip, 0.0, Interpolation.BEZIER),
    openshotPoint(endAnimation, target, Interpolation.BEZIER),
  ]);
}

/**
 * Fade-out for one keyframe (Fade_Triggered OUT_* branch): clear the 3 s zone,
 * then the zone-boundary value `length` seconds before the end falling to 0
 * at the clip's end frame.
 */
export function fadeOutKeyframe(kf: Keyframe | undefined, endOfClip: number, length: number, rate: number): Keyframe {
  const zoneStart = Math.max(1.0, endOfClip - FADE_ZONE_SECONDS * rate);
  const source = evaluate(kf, Math.trunc(pyRound(zoneStart)), 1.0);
  const startAnimation = Math.max(1.0, endOfClip - length * rate);
  const cleared = removeKeyframePointsInRange(kf, zoneStart, endOfClip);
  return setKeyframePoints(cleared, [
    openshotPoint(startAnimation, source, Interpolation.BEZIER),
    openshotPoint(endOfClip, 0.0, Interpolation.BEZIER),
  ]);
}

/** Remove a fade: points in the fade zone are dropped (a curve with nothing left becomes 1.0). */
function clearFadeZone(kf: Keyframe | undefined, from: number, to: number): Keyframe {
  const cleared = removeKeyframePointsInRange(kf, from, to);
  return cleared.Points.length > 0 ? cleared : { ...cleared, Points: constantKeyframe(1.0).Points };
}

/** The desktop's first/last keyframe X of a clip (`round(start*fps)+1`, `round(end*fps)+1`). */
export function clipFrameSpan(clip: Clip, rate: number): { startOfClip: number; endOfClip: number } {
  return { startOfClip: pyRound(Number(clip.start) * rate) + 1, endOfClip: pyRound(Number(clip.end) * rate) + 1 };
}

/**
 * Fade a clip in and/or out (desktop Fade menu: alpha and volume together;
 * Fast = 1 s, Slow = 3 s, any length here). Points in the 3 s fade zone are
 * replaced and the fade ends at the value the curve had at the zone boundary,
 * so an existing level is preserved. A length of 0 removes that fade.
 */
export function fadeClip(tx: Transaction, clipId: string, opts: FadeClipOptions): Clip {
  const project = tx.project;
  const clip = requireEditableClip(project, clipId);
  requireObject(opts, "fadeClip options");
  if (opts.fadeIn === undefined && opts.fadeOut === undefined) throw invalid("Give fadeIn and/or fadeOut.");
  const fadeIn = opts.fadeIn === undefined ? undefined : requireNonNegative(opts.fadeIn, "fadeIn");
  const fadeOut = opts.fadeOut === undefined ? undefined : requireNonNegative(opts.fadeOut, "fadeOut");
  const length = Number(clip.end) - Number(clip.start);
  if ((fadeIn ?? 0) > length + 1e-9 || (fadeOut ?? 0) > length + 1e-9) {
    throw invalid(`A fade cannot be longer than the clip (${length.toFixed(3)} s).`);
  }
  const rate = rateOf(project);
  const { startOfClip, endOfClip } = clipFrameSpan(clip, rate);
  const targets = fadeTargets(clip);
  const doAlpha = opts.video ?? targets.alpha;
  const doVolume = opts.audio ?? targets.volume;
  if (!doAlpha && !doVolume) throw invalid(`Clip ${clipId} has nothing to fade.`);

  const apply = (kf: Keyframe | undefined): Keyframe => {
    let next: Keyframe = kf ?? constantKeyframe(1.0);
    if (fadeIn !== undefined) {
      next =
        fadeIn === 0
          ? clearFadeZone(next, startOfClip, Math.min(startOfClip + FADE_ZONE_SECONDS * rate, endOfClip))
          : fadeInKeyframe(next, startOfClip, endOfClip, fadeIn, rate);
    }
    if (fadeOut !== undefined) {
      next =
        fadeOut === 0
          ? clearFadeZone(next, Math.max(1.0, endOfClip - FADE_ZONE_SECONDS * rate), endOfClip)
          : fadeOutKeyframe(next, endOfClip, fadeOut, rate);
    }
    return next;
  };
  const patch: Record<string, unknown> = {};
  if (doAlpha) patch.alpha = apply(clip.alpha);
  if (doVolume) patch.volume = apply(clip.volume);
  return patchClip(tx, clipId, patch);
}

export interface SetClipVolumeOptions {
  /** Linear gain 0..1.3 (give exactly one of `level` / `levelDb`). */
  level?: number;
  /** Gain in dB (negative = quieter). */
  levelDb?: number;
  /** Timeline seconds where the window starts. Omit both for the whole clip. */
  start?: number;
  /** Timeline seconds where the window ends. */
  end?: number;
  /** Ramp length at each window edge, milliseconds. Default 150. */
  fadeMs?: number;
  /** `replace` (default) sets the level; `scale` multiplies existing automation. */
  mode?: "replace" | "scale";
}

export interface SetClipVolumeResult {
  clip: Clip;
  /** The clip's static level before the change, or null when it was automated. */
  before: number | null;
  /** The linear gain written (clamped to 0..1.3 like the desktop). */
  target: number;
  /** Number of volume points written. */
  points: number;
}

/**
 * Set a clip's audio level over the whole clip or one timeline window
 * (zenvi-core tool_handlers.py `set_clip_volume` + classes/audio_mix.py
 * `build_static_level_points`). Refuses clips without audio, and windows
 * that do not overlap the clip.
 */
export function setClipVolume(tx: Transaction, clipId: string, opts: SetClipVolumeOptions): SetClipVolumeResult {
  const project = tx.project;
  const clip = requireEditableClip(project, clipId);
  requireObject(opts, "setClipVolume options");
  if (opts.level !== undefined && opts.levelDb !== undefined) throw invalid("Pass either level or levelDb, not both.");
  if (opts.level === undefined && opts.levelDb === undefined) throw invalid("setClipVolume needs level or levelDb.");
  const target =
    opts.levelDb !== undefined ? dbToGain(requireFinite(opts.levelDb, "levelDb")) : requireFinite(opts.level, "level");
  if (target < 0) throw invalid(`level must be >= 0 (got ${target}).`);
  if (opts.start !== undefined) requireFinite(opts.start, "start");
  if (opts.end !== undefined) requireFinite(opts.end, "end");
  const fade = Math.max(0, requireFinite(opts.fadeMs ?? 150, "fadeMs") / 1000);
  const mode = opts.mode ?? "replace";
  if (mode !== "replace" && mode !== "scale") throw invalid("mode must be replace or scale.");
  if (!hasAudioStream(clip, clipFile(project, clip))) {
    throw new OpError("invalid_argument", `Clip ${clipId} has no audio stream.`);
  }
  const before = currentStaticLevel(clip);
  const points = buildStaticLevelPoints(clip, fpsOf(project), target, {
    startSeconds: opts.start ?? null,
    endSeconds: opts.end ?? null,
    fade,
    scale: mode === "scale",
  });
  if (points.length === 0) {
    throw invalid(`The requested window does not overlap clip ${clipId} (${clip.position}..${itemEnd(clip)} s).`);
  }
  const next = patchClip(tx, clipId, { volume: { ...(clip.volume ?? {}), Points: points } });
  return { clip: next, before, target: Math.max(0, Math.min(1.3, target)), points: points.length };
}

export interface SeparateAudioOptions {
  /** One audio clip per channel (desktop Separate Audio ▸ Multiple). Default false (single clip). */
  perChannel?: boolean;
}

/**
 * Split a clip's sound onto its own clip(s) (desktop Split_Audio_Triggered).
 *
 * - A clip with video: new audio-only clips (`has_video` off, scale NONE,
 *   `has_audio` auto) go on the track(s) below — one with every channel, or
 *   one per channel (`channel_filter`), each on the next track down — and the
 *   original clip's audio is switched off. Tracks are created when missing.
 * - An audio-only clip is reused: single keeps it with all channels; per
 *   channel keeps channel 1 on it and adds the others below.
 *
 * New clips get new clip and effect ids. Returns the audio clips (new or
 * reused). Clips without audio are refused.
 */
export function separateAudio(tx: Transaction, clipId: string, opts: SeparateAudioOptions = {}): Clip[] {
  const project = tx.project;
  const clip = requireEditableClip(project, clipId);
  const reader: Record<string, unknown> = isRecord(clip.reader) ? clip.reader : {};
  const hasAudio = reader.has_audio === undefined || reader.has_audio === null ? true : Boolean(reader.has_audio);
  const channelCount = reader.channels === undefined || reader.channels === null ? null : Math.trunc(Number(reader.channels));
  const hasVideo = reader.has_video === undefined || reader.has_video === null ? true : Boolean(reader.has_video);
  if (!hasAudio || (channelCount !== null && !(channelCount > 0))) {
    throw invalid(`Clip ${clipId} has no audio to separate.`);
  }
  if (opts.perChannel && channelCount === null) throw invalid(`Clip ${clipId} does not report its channel count.`);
  // Validate before recording: the existing tracks the new clips land on must be unlocked.
  const needed = hasVideo ? (opts.perChannel ? channelCount! : 1) : opts.perChannel ? channelCount! - 1 : 0;
  for (const layer of project.layers
    .filter((l) => l.number < clip.layer)
    .sort((a, b) => b.number - a.number)
    .slice(0, needed)) {
    requireUnlocked(project, layer.number);
  }
  const constant = (value: number): Keyframe => ({ Points: [openshotPoint(1, value, Interpolation.CONSTANT)] });
  const title = String(clip.title ?? "");
  const nextId = ids(project);
  const out: Clip[] = [];
  const insertCopy = (data: Record<string, unknown>): void => {
    const copy = structuredClone(data);
    copy.id = nextId();
    reassignEffectIds(copy, nextId);
    tx.insert(["clips"], copy);
    out.push(requireClip(tx.project, copy.id as string));
  };

  if (!hasVideo) {
    if (!opts.perChannel) return [patchClip(tx, clipId, { channel_filter: constant(-1.0) })];
    let layer = clip.layer;
    for (let channel = 0; channel < channelCount!; channel += 1) {
      const fields = {
        channel_filter: constant(channel),
        has_video: constant(0.0),
        scale: ScaleMode.NONE,
        title: `${title} (channel ${channel + 1})`,
      };
      if (channel === 0) {
        out.push(patchClip(tx, clipId, fields));
      } else {
        layer = trackBelowOrCreate(tx, layer);
        insertCopy({ ...requireClip(tx.project, clipId), ...fields, layer });
      }
    }
    return out;
  }

  const base = { ...clip, has_audio: constant(-1.0) } as Record<string, unknown>;
  if (!opts.perChannel) {
    const layer = trackBelowOrCreate(tx, clip.layer);
    insertCopy({
      ...base,
      channel_filter: constant(-1.0),
      has_video: constant(0.0),
      scale: ScaleMode.NONE,
      layer,
      title: `${title} (all channels)`,
    });
  } else {
    let layer = clip.layer;
    for (let channel = 0; channel < channelCount!; channel += 1) {
      layer = trackBelowOrCreate(tx, layer);
      insertCopy({
        ...base,
        channel_filter: constant(channel),
        has_video: constant(0.0),
        scale: ScaleMode.NONE,
        layer,
        title: `${title} (channel ${channel + 1})`,
      });
    }
  }
  patchClip(tx, clipId, { has_audio: constant(0.0) });
  return out;
}
