/**
 * Add imported media to a project's bin inside a ProjectDocument transaction.
 *
 * Stand-in for the engine's `addFile` op (W1 `packages/engine/src/ops/files.ts`,
 * not yet exported from `@zenvi/engine`); owner W7, replace with the engine op
 * once exported. Mirrors it: desktop file entry = reader info + id +
 * media_type (zenvi-core src/windows/models/files_model.py `add_files`),
 * deduplicated by sha256 so importing the same bytes twice is a no-op.
 */

import { randomInt } from "node:crypto";
import type { ImportedMedia, MediaType, ProjectFile, Transaction } from "@zenvi/engine";

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** 10 characters from A-Z0-9, like the desktop's `generate_id` (project_data.py). */
export function newObjectId(taken: ReadonlySet<string>): string {
  for (;;) {
    let id = "";
    for (let i = 0; i < 10; i += 1) id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
    if (!taken.has(id)) return id;
  }
}

export function mediaTypeOf(info: ImportedMedia["info"]): MediaType {
  if (info.media_type === "video" || info.media_type === "audio" || info.media_type === "image") return info.media_type;
  if (info.has_single_image) return "image";
  if (info.has_video) return "video";
  return "audio";
}

/** Returns the file entry and whether it was newly added. */
export function addMediaFile(tx: Transaction, media: ImportedMedia): { file: ProjectFile; added: boolean } {
  const sha = media.fingerprint?.sha256 ?? media.cloud?.sha256;
  const existing = tx.project.files.find(
    (file) => (sha !== undefined && (file.fingerprint?.sha256 === sha || file.cloud?.sha256 === sha)) || file.path === media.path,
  );
  if (existing) return { file: existing, added: false };
  const taken = new Set(tx.project.files.map((f) => f.id));
  const file: ProjectFile = {
    ...media.info,
    id: newObjectId(taken),
    path: media.path,
    media_type: mediaTypeOf(media.info),
    ...(media.name ? { name: media.name } : {}),
    ...(media.fingerprint ? { fingerprint: media.fingerprint } : {}),
    ...(media.cloud ? { cloud: media.cloud } : {}),
  };
  tx.insert(["files"], file);
  return { file, added: true };
}
