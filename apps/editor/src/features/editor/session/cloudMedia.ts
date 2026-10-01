/**
 * Upload a project's media to Zenvi Cloud, deduplicated by full-file SHA-256
 * (`POST /v1/media/check`, then `POST /v1/media` → SAS PUT →
 * `POST /v1/media/:sha256/complete` for each missing blob).
 */
import type { Project } from "@zenvi/engine";
import { uploadToSas, type CloudClient } from "@/lib/cloud";
import type { MediaStore } from "@/lib/storage/media";
import { fileHash } from "./media";

export interface MediaUploadProgress {
  done: number;
  total: number;
  label: string;
}

export interface MediaUploadResult {
  uploaded: number;
  /** Files whose bytes are not in this browser (cannot be uploaded from here). */
  unavailable: number;
}

export async function uploadMissingMedia(
  project: Project,
  cloud: CloudClient,
  store: MediaStore,
  alreadyUploaded: Set<string>,
  onProgress?: (p: MediaUploadProgress) => void,
): Promise<MediaUploadResult> {
  const byHash = new Map<string, Project["files"][number]>();
  let unavailable = 0;
  for (const file of project.files) {
    const sha = fileHash(file);
    if (!sha) {
      unavailable += 1;
      continue;
    }
    if (!alreadyUploaded.has(sha)) byHash.set(sha, file);
  }
  if (byHash.size === 0) return { uploaded: 0, unavailable };
  onProgress?.({ done: 0, total: 1, label: "Checking what Zenvi Cloud already has" });
  const existing = await cloud.checkMedia([...byHash.keys()]);
  for (const sha of existing) alreadyUploaded.add(sha);
  const todo: { sha: string; blob: File; name: string; type: string }[] = [];
  for (const [sha, file] of byHash) {
    if (existing.has(sha)) continue;
    const stored = await store.get(sha);
    if (!stored) {
      unavailable += 1;
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
  return { uploaded: todo.length, unavailable };
}
