/**
 * Project JSON helpers the cloud needs: parsing untrusted uploads, listing
 * stats and the media a project references.
 *
 * Reading and writing project JSON belongs to the engine (`@zenvi/engine` io):
 * untrusted input goes through `parseProject` (validation + the desktop's load
 * upgrades + the current version stamp), and every write goes through
 * `serializeProject` (services/projects.ts), so no stored project ever carries
 * the "0.0.0" template stamp the desktop reads as an OpenShot beta project
 * (it would flip every clip's alpha on open).
 */

import { isPortableAssetPath } from "@zenvi/render-node";
import { parseProject, ProjectParseError, type Project, type ProjectFile } from "@zenvi/engine";
import { ApiError } from "../http/errors.js";

const MAX_ISSUES = 50;

/** Parse project JSON from the network. Throws a 400 ApiError listing the problems. */
export function parseUntrustedProject(value: unknown): Project {
  try {
    return parseProject(value);
  } catch (error) {
    if (!(error instanceof ProjectParseError)) throw error;
    const issues = error.issues.slice(0, MAX_ISSUES).map((issue) => ({ path: issue.path, message: issue.message }));
    throw new ApiError(400, "invalid_project", error.message, { issues });
  }
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

/**
 * A file that points at an asset every Zenvi renderer ships, as the desktop
 * stores it (`@emojis/1F525.svg` for an emoji sticker): its bytes come with
 * the renderer, so it is never uploaded and never missing.
 */
export function isBundledAsset(file: ProjectFile): boolean {
  return typeof file.path === "string" && isPortableAssetPath(file.path);
}

/** Every project file with a cloud content address, plus the ones without (not in the cloud). Bundled assets are neither. */
export function projectMedia(project: Project): { refs: MediaRef[]; unhashed: { fileId: string; name: string }[] } {
  const refs: MediaRef[] = [];
  const unhashed: { fileId: string; name: string }[] = [];
  for (const file of project.files) {
    if (isBundledAsset(file)) continue;
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
