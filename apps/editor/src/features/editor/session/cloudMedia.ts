/**
 * Upload a project's media to Zenvi Cloud, deduplicated by full-file SHA-256
 * (`POST /v1/media/check`, then `POST /v1/media` → SAS PUT →
 * `POST /v1/media/:sha256/complete` for each missing blob).
 */
import type { Project } from "@zenvi/engine";
import { uploadToSas, type CloudClient } from "@/lib/cloud";
import type { MediaStore } from "@/lib/storage/media";
import { resolveEmojiAsset } from "../catalog";
import { fileDisplayName, fileHash } from "./media";

export interface MediaUploadProgress {
  done: number;
  total: number;
  label: string;
}

/** A project file the cloud copy refers to but Zenvi Cloud does not have, and this browser cannot upload. */
export interface MissingCloudFile {
  fileId: string;
  name: string;
}

export interface MediaUploadResult {
  uploaded: number;
  /** How many files are in `missing`. */
  unavailable: number;
  missing: MissingCloudFile[];
}

export interface UploadOptions {
  onProgress?: (p: MediaUploadProgress) => void;
  /**
   * Files the cloud already has by other means (it matched a desktop file by
   * its own hash and listed it in `GET /v1/projects/:id` → `media`).
   */
  inCloud?: (fileId: string) => boolean;
}

export async function uploadMissingMedia(
  project: Project,
  cloud: CloudClient,
  store: MediaStore,
  alreadyUploaded: Set<string>,
  options: UploadOptions = {},
): Promise<MediaUploadResult> {
  const { onProgress, inCloud } = options;
  const byHash = new Map<string, Project["files"][number]>();
  const missing: MissingCloudFile[] = [];
  const miss = (file: Project["files"][number]) => missing.push({ fileId: String(file.id), name: fileDisplayName(file) });
  for (const file of project.files) {
    // Bundled engine assets (emoji) are part of every Zenvi install; there is nothing to upload.
    if (resolveEmojiAsset(String(file.path ?? ""))) continue;
    const sha = fileHash(file);
    if (!sha) {
      if (!inCloud?.(String(file.id))) miss(file);
      continue;
    }
    if (!alreadyUploaded.has(sha)) byHash.set(sha, file);
  }
  if (byHash.size === 0) return { uploaded: 0, unavailable: missing.length, missing };
  onProgress?.({ done: 0, total: 1, label: "Checking what Zenvi Cloud already has" });
  const existing = await cloud.checkMedia([...byHash.keys()]);
  for (const sha of existing) alreadyUploaded.add(sha);
  const todo: { sha: string; blob: File; name: string; type: string }[] = [];
  for (const [sha, file] of byHash) {
    if (existing.has(sha)) continue;
    const stored = await store.get(sha);
    if (!stored) {
      if (!inCloud?.(String(file.id))) miss(file);
      continue;
    }
    todo.push({
      sha,
      blob: stored.file,
      name: String(file.cloud?.name ?? file.name ?? stored.file.name),
      type: String(file.cloud?.content_type ?? (stored.file.type || "application/octet-stream")),
    });
  }
  const total = todo.reduce((n, t) => n + t.blob.size, 0) || 1;
  let done = 0;
  for (const item of todo) {
    const ticket = await cloud.requestUpload({ sha256: item.sha, size: item.blob.size, name: item.name, contentType: item.type });
    if (!ticket.exists && ticket.uploadUrl) {
      const base = done;
      await uploadToSas(ticket.uploadUrl, item.blob, item.type, (f) => onProgress?.({ done: base + f * item.blob.size, total, label: `Uploading ${item.name}` }), undefined, ticket.uploadHeaders);
      await cloud.completeUpload(item.sha);
    }
    alreadyUploaded.add(item.sha);
    done += item.blob.size;
    onProgress?.({ done, total, label: `Uploaded ${item.name}` });
  }
  return { uploaded: todo.length, unavailable: missing.length, missing };
}
