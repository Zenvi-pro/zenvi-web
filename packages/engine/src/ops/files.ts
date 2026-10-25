/**
 * Project media bin (`project.files[]`).
 *
 * Desktop: zenvi-core src/windows/models/files_model.py (`add_files`) builds a
 * file entry from `openshot.Clip(path).Reader().Json()` plus `media_type` and
 * an id; "Remove from Project" deletes the file and every clip that plays it.
 * develop 1f80cb3d0 src/classes/project_files.py `save_file_and_sync_clips`
 * (File Properties' accept) and editor_tools/media_files.py `create_subclips`
 * (the Split Clip dialog) are `writeFile` and `addSubclipFiles`.
 */

import type { Transaction } from "../history/document.js";
import type { MediaType, ProjectFile } from "../model/types.js";
import { clipsUsingFile } from "../model/query.js";
import { idFactory } from "../model/ids.js";
import { getMediaType, isAudioOnlyMedia } from "../model/media.js";
import type { ImportedMedia } from "../tools/types.js";
import { OpError, invalid, requireFile, requireNonNegative } from "./errors.js";
import { changedFields, ids, isRecord, patchClip, sameJson } from "./internal.js";

export interface AddFileOptions {
  /** Explicit id (tests, deterministic imports). Must not be in use. */
  id?: string;
  /** Display name (desktop "Name" column). Defaults to `media.name`. */
  name?: string;
  /** Override the detected media type. */
  mediaType?: MediaType;
  tags?: string;
  /**
   * When a file with the same `path` is already in the bin, return it instead
   * of adding a duplicate (desktop importer: `File.get(path=…)`). Default
   * true. (`fingerprint.sha256` is a partial hash, so it is never used to
   * match files.)
   */
  dedupe?: boolean;
}

/**
 * The media type the desktop importer assigns (image_types.py
 * `get_media_type`), using the original file name when the path has no
 * extension (browser storage, URLs).
 */
export function detectMediaType(media: Pick<ImportedMedia, "path" | "info" | "name">): MediaType {
  return getMediaType({ path: media.path, has_video: media.info.has_video, has_audio: media.info.has_audio }, media.name);
}

/**
 * Add imported media to the bin like the desktop importer
 * (files_model.py `add_files`): reader info + `media_type` + an id, and for
 * audio-only media `has_video = false` with the project's width/height.
 * Returns the new entry, or the existing one when `dedupe` found the same
 * path (nothing is recorded then).
 */
export function addFile(tx: Transaction, media: ImportedMedia, opts: AddFileOptions = {}): ProjectFile {
  if (!media || typeof media.path !== "string" || media.path === "") {
    throw invalid("media.path is required.");
  }
  if (!media.info || typeof media.info !== "object") throw invalid("media.info is required.");
  if (opts.mediaType !== undefined && !["video", "audio", "image"].includes(opts.mediaType)) {
    throw invalid(`mediaType must be video, audio or image (got ${String(opts.mediaType)}).`);
  }
  const project = tx.project;
  if (opts.dedupe !== false) {
    const existing = project.files.find((file) => file.path === media.path);
    if (existing) return existing;
  }
  if (opts.id !== undefined && project.files.some((file) => file.id === opts.id)) {
    throw new OpError("conflict", `A file with id ${opts.id} already exists.`, { id: opts.id });
  }
  const id = opts.id ?? idFactory(project)();
  const entry: ProjectFile = {
    ...structuredClone(media.info),
    path: media.path,
    id,
    media_type: opts.mediaType ?? detectMediaType(media),
  };
  if (isAudioOnlyMedia(entry)) {
    entry.has_video = false;
    entry.width = project.width;
    entry.height = project.height;
  }
  const name = opts.name ?? media.name;
  if (name !== undefined) entry.name = name;
  if (opts.tags !== undefined) entry.tags = opts.tags;
  if (media.fingerprint) entry.fingerprint = structuredClone(media.fingerprint);
  if (media.cloud) entry.cloud = structuredClone(media.cloud);
  tx.insert(["files"], entry);
  return requireFile(tx.project, id);
}

export interface RemoveFileOptions {
  /**
   * Also delete the clips that play this file (desktop "Remove from Project").
   * When false and clips still use the file, the op refuses with `conflict`.
   * Default true.
   */
  removeClips?: boolean;
}

export interface RemoveFileResult {
  fileId: string;
  removedClipIds: string[];
}

/** Remove a file from the bin, and (by default) every clip that plays it. */
export function removeFile(tx: Transaction, fileId: string, opts: RemoveFileOptions = {}): RemoveFileResult {
  const project = tx.project;
  requireFile(project, fileId);
  const clips = clipsUsingFile(project, fileId);
  if (clips.length > 0 && opts.removeClips === false) {
    throw new OpError("conflict", `File ${fileId} is used by ${clips.length} clip(s).`, {
      clipIds: clips.map((c) => c.id),
    });
  }
  for (const clip of clips) tx.delete(["clips", { id: clip.id }]);
  tx.delete(["files", { id: fileId }]);
  return { fileId, removedClipIds: clips.map((c) => c.id) };
}

/** Fields `updateFile` refuses to change: the id is referenced by clips. */
const IMMUTABLE_FILE_KEYS = new Set(["id"]);

/**
 * Shallow-merge `patch` into a file entry (rename, tags, relink `path`,
 * refreshed reader info, AI metadata). Returns the updated entry. A patch that
 * changes nothing records nothing.
 */
export function updateFile(tx: Transaction, fileId: string, patch: Partial<ProjectFile>): ProjectFile {
  const file = requireFile(tx.project, fileId);
  if (!patch || typeof patch !== "object") throw invalid("patch must be an object.");
  for (const key of Object.keys(patch)) {
    if (IMMUTABLE_FILE_KEYS.has(key) && patch[key] !== file[key]) {
      throw invalid(`File ${key} cannot be changed.`);
    }
  }
  if (patch.media_type !== undefined && !["video", "audio", "image"].includes(patch.media_type)) {
    throw invalid(`media_type must be video, audio or image (got ${String(patch.media_type)}).`);
  }
  const changed = Object.entries(patch).filter(([key, value]) => !sameJson(file[key], value));
  if (changed.length === 0) return file;
  tx.update(["files", { id: fileId }], Object.fromEntries(changed));
  return requireFile(tx.project, fileId);
}

export interface WriteFileOptions {
  /** Also give every clip that plays the file this title (update_project_files_tool rename_clips). */
  clipTitle?: string;
}

export interface WriteFileResult {
  file: ProjectFile;
  /** Every clip that plays the file, in project order: their reader, duration and end follow it. */
  updatedClipIds: string[];
  /** The clips whose title became `clipTitle`. */
  renamedClipIds: string[];
}

/**
 * Save a file's new record and refresh the clips that play it
 * (project_files.save_file_and_sync_clips): keys the record no longer has
 * are deleted; each clip's `reader` becomes a copy of the record, its
 * `duration` the file's and its `end` is clamped to it. Like the desktop's
 * File Properties, this follows the file into clips on locked tracks too.
 * The id cannot change.
 */
export function writeFile(tx: Transaction, fileId: string, next: Record<string, unknown>, opts: WriteFileOptions = {}): WriteFileResult {
  const current = requireFile(tx.project, fileId);
  if (!isRecord(next)) throw invalid("writeFile needs the file's record.");
  if (next.id !== fileId) throw invalid("File id cannot be changed.");
  if (next.media_type !== undefined && !["video", "audio", "image"].includes(next.media_type as string)) {
    throw invalid(`media_type must be video, audio or image (got ${String(next.media_type)}).`);
  }
  if (opts.clipTitle !== undefined && typeof opts.clipTitle !== "string") throw invalid("clipTitle must be a string.");
  const changed = changedFields(current as Record<string, unknown>, next);
  if (Object.keys(changed).length > 0) tx.update(["files", { id: fileId }], changed);
  for (const key of Object.keys(current)) {
    if (!(key in next)) tx.delete(["files", { id: fileId }, key]);
  }
  const file = requireFile(tx.project, fileId);
  const duration = Number(file.duration);
  const updatedClipIds: string[] = [];
  const renamedClipIds: string[] = [];
  for (const clip of clipsUsingFile(tx.project, fileId)) {
    const patch: Record<string, unknown> = { reader: structuredClone(file), duration: file.duration };
    if (Number(clip.end) > duration) patch.end = file.duration;
    if (opts.clipTitle !== undefined && clip.title !== opts.clipTitle) {
      patch.title = opts.clipTitle;
      renamedClipIds.push(clip.id);
    }
    patchClip(tx, clip.id, patch);
    updatedClipIds.push(clip.id);
  }
  return { file, updatedClipIds, renamedClipIds };
}

export interface SubclipInput {
  /** Source in point, seconds. */
  start: number;
  /** Source out point, seconds (after `start`). */
  end: number;
  /** Display name in Project Files. */
  name: string;
  /** Replaces the copied `ai_metadata` (the source's, trimmed to the range). */
  aiMetadata?: Record<string, unknown>;
}

/**
 * New Project Files entries that each play one range of a file
 * (media_files.create_subclips, the Split Clip dialog): a copy of the file's
 * record without its name and id, with `start`/`end`, `ai_metadata` replaced
 * when given, the new name and a new id. Nothing goes on the timeline.
 * Returns the new files in order.
 */
export function addSubclipFiles(tx: Transaction, sourceId: string, subclips: readonly SubclipInput[]): ProjectFile[] {
  const source = requireFile(tx.project, sourceId);
  if (!Array.isArray(subclips) || subclips.length === 0) throw invalid("Give at least one sub-clip.");
  for (const sub of subclips) {
    const start = requireNonNegative(sub?.start, "start");
    const end = requireNonNegative(sub?.end, "end");
    if (!(end > start)) throw invalid(`A sub-clip must end after it starts (got ${start}..${end}).`);
    if (typeof sub.name !== "string") throw invalid("A sub-clip needs a name.");
    if (sub.aiMetadata !== undefined && !isRecord(sub.aiMetadata)) throw invalid("aiMetadata must be an object.");
  }
  const created: ProjectFile[] = [];
  for (const sub of subclips) {
    const { name: _name, id: _id, ...rest } = structuredClone(source) as Record<string, unknown>;
    const entry: Record<string, unknown> = rest;
    entry.start = sub.start;
    entry.end = sub.end;
    if (sub.aiMetadata !== undefined) entry.ai_metadata = structuredClone(sub.aiMetadata);
    entry.name = sub.name;
    entry.id = ids(tx.project)();
    tx.insert(["files"], entry);
    created.push(requireFile(tx.project, entry.id as string));
  }
  return created;
}
