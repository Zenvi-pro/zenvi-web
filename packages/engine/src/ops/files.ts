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
import type { ImportedMedia } from "../tools/types.js";
import { OpError, invalid, requireFile } from "./errors.js";

export interface AddFileOptions {
  /** Explicit id (tests, deterministic imports). Must not be in use. */
  id?: string;
  /** Display name (desktop "Name" column). Defaults to `media.name`. */
  name?: string;
  /** Override the detected media type. */
  mediaType?: MediaType;
  tags?: string;
  /**
   * When a file with the same path (or the same sha256 fingerprint) is already
   * in the project, return it instead of adding a duplicate. Default true, like
   * the desktop importer, which skips files already in the bin.
   */
  dedupe?: boolean;
}

/**
 * The media type the desktop assigns on import (files_model.py): an image when
 * the reader has a single image, video when it has video, audio otherwise.
 */
export function detectMediaType(info: ImportedMedia["info"]): MediaType {
  if (info.media_type === "video" || info.media_type === "audio" || info.media_type === "image") {
    return info.media_type;
  }
  if (info.has_single_image) return "image";
  if (info.has_video) return "video";
  return "audio";
}

/**
 * Add imported media to the bin. Returns the new entry (or the existing one
 * when `dedupe` found a match, in which case nothing is recorded).
 */
export function addFile(tx: Transaction, media: ImportedMedia, opts: AddFileOptions = {}): ProjectFile {
  if (!media || typeof media.path !== "string" || media.path === "") {
    throw invalid("media.path is required.");
  }
  if (!media.info || typeof media.info !== "object") throw invalid("media.info is required.");
  const project = tx.project;
  if (opts.dedupe !== false) {
    const sha = media.fingerprint?.sha256;
    const existing = project.files.find(
      (file) => file.path === media.path || (sha !== undefined && file.fingerprint?.sha256 === sha),
    );
    if (existing) return existing;
  }
  if (opts.id !== undefined && project.files.some((file) => file.id === opts.id)) {
    throw new OpError("conflict", `A file with id ${opts.id} already exists.`, { id: opts.id });
  }
  const id = opts.id ?? idFactory(project)();
  const entry: ProjectFile = {
    ...media.info,
    path: media.path,
    id,
    media_type: opts.mediaType ?? detectMediaType(media.info),
  };
  const name = opts.name ?? media.name;
  if (name !== undefined) entry.name = name;
  if (opts.tags !== undefined) entry.tags = opts.tags;
  if (media.fingerprint) entry.fingerprint = media.fingerprint;
  if (media.cloud) entry.cloud = media.cloud;
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

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
