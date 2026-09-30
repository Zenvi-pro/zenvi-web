/**
 * Errors thrown by editing operations.
 *
 * Ops validate every input before they record anything, and throw `OpError`
 * when an input is invalid, so a failed op leaves the transaction (and
 * therefore history) untouched. Tools catch `OpError` and turn it into an
 * `Error: …` result; anything else that escapes an op is a programmer error.
 */

import type { Clip, Layer, Marker, Project, ProjectFile, Transition } from "../model/types.js";
import { findClip, findClipEffect, findFile, findLayer, findMarker, findTransition, type ClipEffectRef } from "../model/query.js";

export type OpErrorCode =
  /** A referenced object (clip, file, track, effect…) does not exist. */
  | "not_found"
  /** An argument is malformed or out of range. */
  | "invalid_argument"
  /** The object sits on a locked track (the desktop refuses edits there). */
  | "locked"
  /** A well-formed request that conflicts with the project state. */
  | "conflict"
  /** A valid request this engine cannot carry out (e.g. an OpenCV-only effect). */
  | "unsupported";

export class OpError extends Error {
  override readonly name = "OpError";

  constructor(
    readonly code: OpErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function isOpError(error: unknown): error is OpError {
  return error instanceof OpError;
}

// ---------------------------------------------------------------------------
// Validation helpers shared by the op modules
// ---------------------------------------------------------------------------

export function invalid(message: string, details?: Record<string, unknown>): OpError {
  return new OpError("invalid_argument", message, details);
}

/** Throw `invalid_argument` unless `value` is a (non-array) object. */
export function requireObject(value: unknown, what: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid(`${what} must be an object.`);
  }
}

/** A finite number, or throw `invalid_argument` naming `what`. */
export function requireFinite(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalid(`${what} must be a finite number (got ${String(value)}).`);
  }
  return value;
}

export function requireNonNegative(value: unknown, what: string): number {
  const n = requireFinite(value, what);
  if (n < 0) throw invalid(`${what} must be >= 0 (got ${n}).`);
  return n;
}

export function requirePositive(value: unknown, what: string): number {
  const n = requireFinite(value, what);
  if (n <= 0) throw invalid(`${what} must be > 0 (got ${n}).`);
  return n;
}

export function requireClip(project: Project, id: string): Clip {
  const clip = findClip(project, id);
  if (!clip) throw new OpError("not_found", `No clip with id ${id}.`, { id });
  return clip;
}

export function requireFile(project: Project, id: string): ProjectFile {
  const file = findFile(project, id);
  if (!file) throw new OpError("not_found", `No file with id ${id}.`, { id });
  return file;
}

export function requireTransition(project: Project, id: string): Transition {
  const transition = findTransition(project, id);
  if (!transition) throw new OpError("not_found", `No transition with id ${id}.`, { id });
  return transition;
}

export function requireMarker(project: Project, id: string): Marker {
  const marker = findMarker(project, id);
  if (!marker) throw new OpError("not_found", `No marker with id ${id}.`, { id });
  return marker;
}

export function requireLayer(project: Project, layer: number): Layer {
  const found = findLayer(project, layer);
  if (!found) throw new OpError("not_found", `No track with number ${layer}.`, { layer });
  return found;
}

export function requireClipEffect(project: Project, effectId: string): ClipEffectRef {
  const ref = findClipEffect(project, effectId);
  if (!ref) throw new OpError("not_found", `No effect with id ${effectId}.`, { id: effectId });
  return ref;
}

/**
 * Throw `locked` when track `layer` is locked. A layer number with no track
 * object is treated as unlocked (libopenshot draws clips on any layer number).
 */
export function requireUnlocked(project: Project, layer: number, what = "Track"): void {
  const found = findLayer(project, layer);
  if (found?.lock) {
    const label = found.label ? ` "${found.label}"` : "";
    throw new OpError("locked", `${what}${label} (${layer}) is locked.`, { layer });
  }
}

