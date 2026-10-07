/**
 * Helpers shared by the op modules (not part of the public ops API).
 */

import type { Transaction } from "../history/document.js";
import type { Clip, Fraction, Keyframe, Layer, Project, ProjectFile, Transition } from "../model/types.js";
import { createLayer } from "../model/defaults.js";
import { findFile, findLayer } from "../model/query.js";
import { pyRound } from "../model/rounding.js";
import { clampTimingToMedia } from "../model/timing.js";
import { generateId, idFactory } from "../model/ids.js";
import { OpError, invalid, requireClip, requireUnlocked } from "./errors.js";
import type { KeyframeAt } from "./types.js";
import { clipFrameAtTime } from "../timeline/windows.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function fpsOf(project: Project): Fraction {
  const fps = project.fps;
  return fps && fps.num > 0 && fps.den > 0 ? fps : { num: 30, den: 1 };
}

export function rateOf(project: Project): number {
  const fps = fpsOf(project);
  return fps.num / fps.den;
}

/** Desktop `snap_to_grid = round(t * fps) / fps` (Python rounding). */
export function snapSeconds(seconds: number, project: Project): number {
  const rate = rateOf(project);
  return pyRound(seconds * rate) / rate;
}

/** One frame, seconds. */
export function frameSeconds(project: Project): number {
  return 1 / rateOf(project);
}

/** A clip that exists and sits on an unlocked track. */
export function requireEditableClip(project: Project, clipId: string): Clip {
  const clip = requireClip(project, clipId);
  requireUnlocked(project, clip.layer, "Track");
  return clip;
}

/** The bin entry a clip plays, when it is still in the project. */
export function clipFile(project: Project, clip: Clip): ProjectFile | undefined {
  return clip.file_id ? findFile(project, clip.file_id) : undefined;
}

/**
 * Create the track `layer` when no track has that number (timeline.py
 * `_ensure_layers_exist`). Returns the track.
 */
export function ensureLayer(tx: Transaction, layer: number): Layer {
  if (!Number.isInteger(layer) || layer <= 0) {
    throw invalid(`Track number must be a positive integer (got ${layer}).`);
  }
  const existing = findLayer(tx.project, layer);
  if (existing) return existing;
  const id = generateId((candidate) => tx.project.layers.some((l) => l.id === candidate));
  tx.insert(["layers"], createLayer(layer, id));
  return findLayer(tx.project, layer)!;
}

/**
 * Apply the desktop's `clamp_timing_to_media` to a clip about to be saved:
 * returns the clip with start/end/duration (and time points) clamped.
 */
export function withClampedTiming<T extends Record<string, unknown>>(clip: T, project: Project, existing?: Clip): T {
  const timing = clampTimingToMedia(clip, fpsOf(project), existing as Record<string, unknown> | undefined);
  const next: Record<string, unknown> = { ...clip, start: timing.start, end: timing.end, duration: timing.duration };
  if (timing.time) next.time = timing.time;
  return next as T;
}

/** Only the keys of `next` whose JSON differs from `prev` (no-op updates record nothing). */
export function changedFields(prev: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (!sameJson(prev[key], value)) out[key] = value;
  }
  return out;
}

export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => sameJson(v, bb[i]));
  }
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Record a shallow merge of `patch` into clip `id` when it changes anything. Returns the clip after. */
export function patchClip(tx: Transaction, id: string, patch: Record<string, unknown>): Clip {
  const clip = requireClip(tx.project, id);
  const changed = changedFields(clip as Record<string, unknown>, patch);
  if (Object.keys(changed).length > 0) tx.update(["clips", { id }], changed);
  return requireClip(tx.project, id);
}

/** Record a shallow merge into transition `id` when it changes anything. */
export function patchTransition(tx: Transaction, id: string, patch: Record<string, unknown>): Transition {
  const transition = tx.project.effects.find((t) => t.id === id);
  if (!transition) throw new OpError("not_found", `No transition with id ${id}.`, { id });
  const changed = changedFields(transition as Record<string, unknown>, patch);
  if (Object.keys(changed).length > 0) tx.update(["effects", { id }], changed);
  return tx.project.effects.find((t) => t.id === id)!;
}

/** New ids for a clip copy's effects (timeline.py `_assign_new_effect_ids`). */
export function reassignEffectIds(clip: Record<string, unknown>, nextId: () => string): void {
  const effects = clip.effects;
  if (!Array.isArray(effects)) return;
  clip.effects = effects.map((effect) => (isRecord(effect) ? { ...effect, id: nextId() } : effect));
}

/** An id generator unique within the project. */
export function ids(project: Project): () => string {
  return idFactory(project);
}

/**
 * The keyframe X an edit targets: `at.frame`, or `at.time` converted the way
 * the Properties panel does for this clip, or undefined for "constant".
 */
export function resolveClipFrame(project: Project, clip: Clip, at: KeyframeAt): number | undefined {
  if (at.frame !== undefined && at.time !== undefined) throw invalid("Give at most one of frame / time.");
  if (at.frame !== undefined) {
    if (!Number.isFinite(at.frame)) throw invalid(`frame must be a finite number (got ${at.frame}).`);
    return at.frame;
  }
  if (at.time !== undefined) {
    if (!Number.isFinite(at.time)) throw invalid(`time must be a finite number (got ${at.time}).`);
    return clipFrameAtTime(clip, at.time, fpsOf(project));
  }
  return undefined;
}

/** Every keyframe `Points` list nested anywhere in a value (retime.py `_iterate_keyframe_lists`). */
export function mapKeyframesDeep(value: unknown, fn: (kf: Keyframe) => Keyframe): unknown {
  if (Array.isArray(value)) return value.map((v) => mapKeyframesDeep(v, fn));
  if (!isRecord(value)) return value;
  if (Array.isArray(value.Points)) return fn(value as Keyframe);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = mapKeyframesDeep(v, fn);
  return out;
}

/** Replace a clip wholesale when anything changed. */
export function replaceClip(tx: Transaction, before: Clip, after: Clip): Clip {
  if (sameJson(before, after)) return before;
  tx.replace(["clips", { id: before.id }], after);
  return requireClip(tx.project, before.id);
}

/** What the desktop fades for a clip: alpha when it shows a picture (or waveform), volume when it has audio. */
export function fadeTargets(clip: Clip): { alpha: boolean; volume: boolean } {
  const reader: Record<string, unknown> = isRecord(clip.reader) ? clip.reader : {};
  return {
    alpha: Boolean(reader.has_video ?? true) || Boolean(clip.waveform),
    volume: Boolean(reader.has_audio ?? true),
  };
}
