/**
 * Add imported media to a project's bin inside a ProjectDocument transaction,
 * with the engine's `addFile` op (which dedupes by path, like the desktop).
 *
 * Cloud imports are content-addressed, and MCP hosts retry and re-send the
 * same attachment, so the same bytes already in the bin (same
 * `file.cloud.sha256`) return that entry and record nothing. The desktop's
 * `fingerprint.sha256` is a partial hash and never matches content. Imports
 * are named after the file (`beach.mp4`), so two different files can share a
 * name; the second gets a hash-suffixed path so `addFile` does not mistake it
 * for the first.
 */

import { addFile, type ImportedMedia, OpError, type ProjectFile, type Transaction } from "@zenvi/engine";
import { ApiError } from "../http/errors.js";

function withSuffix(path: string, suffix: string): string {
  const dot = path.lastIndexOf(".");
  return dot > 0 ? `${path.slice(0, dot)}-${suffix}${path.slice(dot)}` : `${path}-${suffix}`;
}

/** Returns the file entry and whether it was newly added. */
export function addMediaFile(tx: Transaction, media: ImportedMedia): { file: ProjectFile; added: boolean } {
  const before = new Set(tx.project.files.map((file) => file.id));
  const sha = media.cloud?.sha256;
  if (sha !== undefined) {
    const same = tx.project.files.find((file) => file.cloud?.sha256 === sha);
    if (same) return { file: same, added: false };
  }
  let entry = media;
  const clash = tx.project.files.find((file) => file.path === media.path);
  if (clash && sha !== undefined && clash.cloud?.sha256 !== sha) {
    const path = withSuffix(media.path, sha.slice(0, 8));
    entry = { ...media, path, info: { ...media.info, path } };
  }
  try {
    const file = addFile(tx, entry);
    return { file, added: !before.has(file.id) };
  } catch (error) {
    if (error instanceof OpError) throw new ApiError(422, "invalid_media", error.message);
    throw error;
  }
}
