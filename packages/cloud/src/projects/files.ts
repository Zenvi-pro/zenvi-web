/**
 * Add imported media to a project's bin inside a ProjectDocument transaction,
 * with the engine's `addFile` op (dedupes by path and by sha256 fingerprint,
 * so importing the same bytes twice records nothing).
 *
 * Cloud imports are named after the file (`beach.mp4`), so two different
 * files can share a name; the second gets a hash-suffixed path so `addFile`
 * does not mistake it for the first.
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
  const sha = media.fingerprint?.sha256;
  let entry = media;
  const clash = tx.project.files.find((file) => file.path === media.path);
  if (clash && sha !== undefined && clash.fingerprint?.sha256 !== sha && clash.cloud?.sha256 !== sha) {
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
