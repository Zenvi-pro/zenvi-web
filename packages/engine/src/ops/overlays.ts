/**
 * Overlay clips (titles, timers, emoji, caption carriers) and the edits the
 * text tools make to existing clips and files.
 *
 * Desktop: zenvi-core src/classes/editor_tools/titles_text_common.py
 * `place_clip` (Timeline.addClip, then trim and properties in the same undo
 * step) and `create_track` (a labelled track on top); titles_text.py
 * `edit_title` (a title file moved to a new SVG version, every clip's reader
 * following it, or one clip given its own copy); titles_text_captions.py
 * `_save_effects` (a clip's effect list replaced in one update).
 */

import type { Transaction } from "../history/document.js";
import type { Clip, Effect, ProjectFile } from "../model/types.js";
import { createLayer } from "../model/defaults.js";
import { generateId } from "../model/ids.js";
import { clipsUsingFile, findLayer } from "../model/query.js";
import { addClip } from "./clips.js";
import { invalid, requireClip, requireFile, requireNonNegative, requireObject, requirePositive, requireUnlocked } from "./errors.js";
import { isRecord, patchClip, requireEditableClip } from "./internal.js";

/** Clip keys `props` may not set: they are the placement itself. */
const PLACEMENT_KEYS = new Set(["id", "file_id", "position", "layer", "start", "end", "duration", "reader"]);

export interface PlaceOverlayClipInput {
  /** Bin file the clip plays. */
  fileId: string;
  /** Timeline start, seconds (snapped to the frame grid). */
  position: number;
  /** Seconds on screen (> 0); the clip plays the file from its start. */
  duration: number;
  /** Track number; created with `newTrackLabel` when no track has it. */
  layer: number;
  /** Label of a track this call creates (the desktop's "Titles", "Timer", "Emoji", "Captions"). */
  newTrackLabel?: string;
  /** Clip title. Default the file's display name. */
  title?: string;
  /** Clip keys set on the new clip, replacing the defaults (gravity, keyframes, effects, zenvi_role…). */
  props?: Readonly<Record<string, unknown>>;
}

/** Create track `layer` labelled `label` when no track has that number. */
export function ensureTrack(tx: Transaction, layer: number, label = ""): void {
  if (findLayer(tx.project, layer)) return;
  const id = generateId((candidate) => tx.project.layers.some((l) => l.id === candidate));
  tx.insert(["layers"], createLayer(layer, id, label));
}

/** Place a file on the timeline with its look already set, as one edit (`place_clip`). Returns the clip. */
export function placeOverlayClip(tx: Transaction, input: PlaceOverlayClipInput): Clip {
  requireObject(input, "placeOverlayClip input");
  const project = tx.project;
  requireFile(project, input.fileId);
  requireNonNegative(input.position, "position");
  requirePositive(input.duration, "duration");
  if (!Number.isInteger(input.layer) || input.layer <= 0) throw invalid(`layer must be a positive track number (got ${input.layer}).`);
  requireUnlocked(project, input.layer);
  if (input.props !== undefined) {
    requireObject(input.props, "props");
    const bad = Object.keys(input.props).filter((key) => PLACEMENT_KEYS.has(key));
    if (bad.length > 0) throw invalid(`props cannot set ${bad.join(", ")}.`);
  }
  ensureTrack(tx, input.layer, input.newTrackLabel ?? "");
  const clipInput: Parameters<typeof addClip>[1] = { fileId: input.fileId, position: input.position, layer: input.layer, start: 0, end: input.duration };
  if (input.title !== undefined) clipInput.title = input.title;
  const clip = addClip(tx, clipInput);
  if (input.props && Object.keys(input.props).length > 0) return patchClip(tx, clip.id, jsonCopy({ ...input.props }));
  return clip;
}

/** A deep copy that is a JSON tree: one keyframe passed as both scale_x and scale_y becomes two (project data may share nothing). */
function jsonCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Replace a clip's effect list (Caption/Timer edits). Records nothing when it is unchanged. */
export function replaceClipEffects(tx: Transaction, clipId: string, effects: readonly Effect[]): Clip {
  requireEditableClip(tx.project, clipId);
  if (!Array.isArray(effects) || effects.some((e) => !isRecord(e) || typeof e.id !== "string")) {
    throw invalid("effects must be a list of effect objects with ids.");
  }
  return patchClip(tx, clipId, { effects: jsonCopy([...effects]) });
}

/**
 * Point a bin file at new media (an edited title's next SVG version) and
 * every clip that plays it at the same path, in one edit. `patch` may also
 * carry the name and fingerprint. Clips on locked tracks are refused first.
 */
export function repointFile(tx: Transaction, fileId: string, patch: Readonly<Partial<ProjectFile>> & { path: string }): ProjectFile {
  const file = requireFile(tx.project, fileId);
  if (typeof patch?.path !== "string" || !patch.path) throw invalid("patch.path is required.");
  if (patch.id !== undefined && patch.id !== file.id) throw invalid("File id cannot be changed.");
  const clips = clipsUsingFile(tx.project, fileId);
  for (const clip of clips) requireUnlocked(tx.project, clip.layer);
  tx.update(["files", { id: fileId }], structuredClone({ ...patch }));
  for (const clip of clips) {
    const reader = isRecord(clip.reader) ? clip.reader : {};
    patchClip(tx, clip.id, { reader: { ...reader, path: patch.path } });
  }
  return requireFile(tx.project, fileId);
}

/** Make one clip play another bin file (its reader becomes that file's data), like the title editor's per-clip copy. */
export function useFileForClip(tx: Transaction, clipId: string, fileId: string): Clip {
  requireEditableClip(tx.project, clipId);
  const file = requireFile(tx.project, fileId);
  patchClip(tx, clipId, { file_id: file.id, reader: structuredClone(file) });
  return requireClip(tx.project, clipId);
}
