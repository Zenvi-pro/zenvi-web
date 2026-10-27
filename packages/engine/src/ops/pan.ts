/**
 * Panned renders of audio clips (pan_tool). libopenshot's Clip has no pan
 * (`channel_filter` / `channel_mapping` route whole channels), so a panned
 * clip plays a stereo WAV the engine rendered from its source, the way FX
 * renders and sound effects are files the desktop simply plays. The render
 * covers the whole source, so the clip keeps its trim, position and volume
 * keyframes (source frames) unchanged; `clip.zenvi_pan` records the source
 * file and the pan, so a new pan renders from the original again and pan 0
 * puts the original back.
 */

import type { Transaction } from "../history/document.js";
import { clipsUsingFile } from "../model/query.js";
import type { Clip, ProjectFile } from "../model/types.js";
import type { ImportedMedia } from "../tools/types.js";
import { invalid, requireFile } from "./errors.js";
import { addFile } from "./files.js";
import { patchClip, requireEditableClip } from "./internal.js";

export const PAN_KEY = "zenvi_pan";

/** A pan: constant, or keyframes in timeline seconds (-1 left .. 1 right). */
export interface PanMark {
  source_file_id: string;
  pan?: number;
  points?: { t: number; pan: number }[];
}

export function readPanMark(clip: Clip): PanMark | undefined {
  const mark = (clip as { [PAN_KEY]?: unknown })[PAN_KEY];
  if (typeof mark !== "object" || mark === null) return undefined;
  const m = mark as Partial<PanMark>;
  return typeof m.source_file_id === "string" ? (m as PanMark) : undefined;
}

/** The file a clip's sound comes from before any pan render. */
export function panSourceFile(project: { files: readonly ProjectFile[] }, clip: Clip): ProjectFile | undefined {
  const id = readPanMark(clip)?.source_file_id ?? String(clip.file_id ?? "");
  return project.files.find((f) => String(f.id) === id);
}

function swapTo(tx: Transaction, clip: Clip, file: ProjectFile, mark: PanMark | null): void {
  const previous = String(clip.file_id ?? "");
  const patch: Record<string, unknown> = { file_id: file.id, reader: structuredClone(file) };
  if (mark) patch[PAN_KEY] = mark;
  patchClip(tx, clip.id, patch);
  if (!mark) {
    const { [PAN_KEY]: _dropped, ...rest } = requireEditableClip(tx.project, clip.id) as Clip & Record<string, unknown>;
    tx.replace(["clips", { id: clip.id }], rest);
  }
  // A pan render no other clip plays leaves the bin with it.
  const old = tx.project.files.find((f) => String(f.id) === previous);
  if (old && old.id !== file.id && (old as { [PAN_KEY]?: unknown })[PAN_KEY] && clipsUsingFile(tx.project, old.id).length === 0) tx.delete(["files", { id: old.id }]);
}

/** Point a clip at a fresh panned render of its source. */
export function linkPanRender(tx: Transaction, clipId: string, media: ImportedMedia, mark: PanMark): Clip {
  const clip = requireEditableClip(tx.project, clipId);
  requireFile(tx.project, mark.source_file_id);
  const file = addFile(tx, media, { dedupe: false });
  tx.update(["files", { id: file.id }], { [PAN_KEY]: { source_file_id: mark.source_file_id } });
  swapTo(tx, clip, requireFile(tx.project, file.id), mark);
  return requireEditableClip(tx.project, clipId);
}

/** Put a panned clip back on its source file (centre). */
export function unlinkPanRender(tx: Transaction, clipId: string): Clip {
  const clip = requireEditableClip(tx.project, clipId);
  const mark = readPanMark(clip);
  if (!mark) throw invalid(`Clip ${clipId} is not panned.`);
  swapTo(tx, clip, requireFile(tx.project, mark.source_file_id), null);
  return requireEditableClip(tx.project, clipId);
}
