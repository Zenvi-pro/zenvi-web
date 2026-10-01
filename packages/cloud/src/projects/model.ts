/**
 * Project JSON helpers the cloud needs: validation of untrusted uploads,
 * listing stats and the media a project references. New projects come from
 * the engine's `createProject`.
 *
 * Validation belongs to the engine (`parseProject`, W1 `packages/engine/src/io`).
 * Until it is exported from `@zenvi/engine`, `validateProject` here is a
 * deliberately shallow stand-in (owner: W7; swap to `parseProject` when it
 * lands): it checks the fields the cloud relies on and keeps every other key
 * untouched.
 */

import type { Project, ProjectFile } from "@zenvi/engine";
import { z } from "zod";
import { ApiError } from "../http/errors.js";

const fraction = z.object({ num: z.number().int().positive(), den: z.number().int().positive() }).passthrough();
const identified = z.object({ id: z.string().min(1).max(200) }).passthrough();

const projectShape = z
  .object({
    id: z.string().max(200).optional(),
    fps: fraction,
    width: z.number().int().positive().max(16384),
    height: z.number().int().positive().max(16384),
    clips: z.array(identified).max(20_000),
    files: z.array(identified).max(20_000),
    effects: z.array(identified).max(20_000).optional(),
    layers: z.array(identified).max(1_000).optional(),
    markers: z.array(identified).max(20_000).optional(),
  })
  .passthrough();

/** Validate an untrusted project JSON value. Throws a 422 ApiError listing the problems. */
export function validateProject(value: unknown): Project {
  const result = projectShape.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 10).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new ApiError(422, "invalid_project", `Not a valid Zenvi project: ${issues.join("; ")}`, { issues });
  }
  return value as Project;
}

export interface ProjectStats {
  clips: number;
  files: number;
  /** Seconds from 0 to the end of the last clip. */
  duration: number;
  width: number;
  height: number;
  fps: number;
}

export function projectStats(project: Project): ProjectStats {
  let end = 0;
  for (const clip of project.clips) {
    const clipEnd = Number(clip.position) + (Number(clip.end) - Number(clip.start));
    if (Number.isFinite(clipEnd)) end = Math.max(end, clipEnd);
  }
  const fps = project.fps.den > 0 ? project.fps.num / project.fps.den : 0;
  return {
    clips: project.clips.length,
    files: project.files.length,
    duration: Math.round(end * 1000) / 1000,
    width: project.width,
    height: project.height,
    fps: Math.round(fps * 1000) / 1000,
  };
}

const SHA256 = /^[0-9a-f]{64}$/;

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

export interface MediaRef {
  fileId: string;
  sha256: string;
  name: string;
  contentType?: string;
  size?: number;
}

/**
 * The content address of a project file's bytes in Zenvi Cloud: the full-file
 * SHA-256 in `file.cloud.sha256` (engine CloudMediaRef), or undefined.
 *
 * Never `file.fingerprint.sha256`: the desktop's fingerprint hashes only the
 * size plus the first and last 1 MB (zenvi-core src/classes/media_fingerprint.py)
 * for cheap relinking, so it does not identify the content.
 */
export function fileSha256(file: ProjectFile): string | undefined {
  const cloud = file.cloud?.sha256;
  return isSha256(cloud) ? cloud : undefined;
}

export function displayName(file: ProjectFile): string {
  if (typeof file.name === "string" && file.name !== "") return file.name;
  if (typeof file.cloud?.name === "string" && file.cloud.name !== "") return file.cloud.name;
  const path = typeof file.path === "string" ? file.path : "";
  return path.split(/[\\/]/).pop() || file.id;
}

/** Every project file with a cloud content address, plus the ones without (not in the cloud). */
export function projectMedia(project: Project): { refs: MediaRef[]; unhashed: { fileId: string; name: string }[] } {
  const refs: MediaRef[] = [];
  const unhashed: { fileId: string; name: string }[] = [];
  for (const file of project.files) {
    const sha256 = fileSha256(file);
    if (!sha256) {
      unhashed.push({ fileId: file.id, name: displayName(file) });
      continue;
    }
    refs.push({
      fileId: file.id,
      sha256,
      name: displayName(file),
      contentType: typeof file.cloud?.content_type === "string" ? file.cloud.content_type : undefined,
      size: typeof file.cloud?.size === "number" ? file.cloud.size : undefined,
    });
  }
  return { refs, unhashed };
}
