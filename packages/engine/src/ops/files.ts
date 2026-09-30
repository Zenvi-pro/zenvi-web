/**
 * Project media bin (`project.files[]`).
 *
 * Desktop: zenvi-core src/windows/models/files_model.py (`add_files`) builds a
 * file entry from `openshot.Clip(path).Reader().Json()` plus `media_type` and
 * an id; "Remove from Project" deletes the file and every clip that plays it.
 */

import type { Transaction } from "../history/document.js";
import type { MediaType, ProjectFile } from "../model/types.js";
import { clipsUsingFile } from "../model/query.js";
import { idFactory } from "../model/ids.js";
import { getMediaType, isAudioOnlyMedia } from "../model/media.js";
import type { ImportedMedia } from "../tools/types.js";
import { OpError, invalid, requireFile } from "./errors.js";
import { sameJson } from "./internal.js";

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
