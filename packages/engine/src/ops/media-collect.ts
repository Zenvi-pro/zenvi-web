/**
 * Pointing a project's files and clips at moved media: the half of File >
 * Collect Media / Reclaim that touches project data. The copying, the
 * byte-for-byte check and the deleting are the host's (local files).
 *
 * Port of zenvi-core develop src/classes/media_collect.py `repoint_media`
 * and editor_tools/project_export.py `_media_changes`.
 */

import type { Transaction } from "../history/document.js";
import type { Project } from "../model/types.js";
import { isRecord } from "./internal.js";

/** One file's media moving from `from` to `to`. */
export interface MediaRelocation {
  fileId: string;
  from: string;
  to: string;
}

/** The file and clip fields a relocation changes. */
export interface MediaRepoint {
  files: { id: string; path: string; original_path?: string }[];
  clips: { id: string; reader: Record<string, unknown> }[];
}

/**
 * The changes that point files and clip readers from each move's old path
 * to its new one (by file id, else by path). With `keepOriginal` a file
 * remembers where it was collected from (`original_path`, kept when it
 * already has one). Pure: returns only what differs.
 */
export function mediaRepoint(project: Project, moves: readonly MediaRelocation[], keepOriginal: boolean): MediaRepoint {
  const byId = new Map(moves.filter((m) => m.fileId).map((m) => [m.fileId, m]));
  const byPath = new Map(moves.map((m) => [m.from, m.to]));
  const out: MediaRepoint = { files: [], clips: [] };
  for (const file of project.files) {
    const path = typeof file.path === "string" ? file.path : "";
    const next = byId.get(file.id)?.to ?? (path ? byPath.get(path) : undefined);
    if (next === undefined) continue;
    const original = typeof file.original_path === "string" && file.original_path ? file.original_path : keepOriginal ? path : undefined;
    if (next === path && original === file.original_path) continue;
    out.files.push(original === undefined ? { id: file.id, path: next } : { id: file.id, path: next, original_path: original });
  }
  for (const clip of project.clips) {
    const reader = isRecord(clip.reader) ? clip.reader : null;
    if (!reader) continue;
    const readerPath = typeof reader.path === "string" ? reader.path : "";
    const next = (clip.file_id ? byId.get(clip.file_id)?.to : undefined) ?? (readerPath ? byPath.get(readerPath) : undefined);
    if (next === undefined || next === readerPath) continue;
    out.clips.push({ id: clip.id, reader: { ...reader, path: next } });
  }
  return out;
}

/** Record a repoint in the caller's transaction (collect: one undo step back to the originals). */
export function applyMediaRepoint(tx: Transaction, repoint: MediaRepoint): void {
  for (const { id, ...values } of repoint.files) tx.update(["files", { id }], values);
  for (const { id, reader } of repoint.clips) tx.update(["clips", { id }], { reader });
}
