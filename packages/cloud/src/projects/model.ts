/**
 * Project JSON helpers the cloud needs: validation of untrusted uploads, a new
 * empty project, listing stats and the media a project references.
 *
 * Validation and defaults belong to the engine (`parseProject` /
 * `createProject`, W1 `packages/engine/src/{io,model}`). Until those are
 * exported from `@zenvi/engine`, `validateProject` and `newProject` here are a
 * deliberately shallow stand-in (owner: W7; swap to the engine functions when
 * they land): they check the fields the cloud relies on and keep every other
 * key untouched.
 */

import type { Project, ProjectFile } from "@zenvi/engine";
import { z } from "zod";
import { ApiError } from "../http/errors.js";
import { profileFor, type ProfileSpec } from "./profiles.js";

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

/**
 * A new empty project: the desktop's `src/settings/_default.project` with a
 * profile applied (default "HD 720p 30 fps", the desktop's default), as the
 * desktop does on File → New.
 */
export function newProject(id: string, profile: ProfileSpec = profileFor("landscape_720p", 30)): Project {
  const layer = (n: number) => ({ id: `L${n}`, label: "", number: n * 1_000_000, y: 0, lock: false });
  return {
    id,
    fps: { ...profile.fps },
    display_ratio: { ...profile.displayRatio },
    pixel_ratio: { ...profile.pixelRatio },
    width: profile.width,
    height: profile.height,
    sample_rate: 48000,
    channels: 2,
    channel_layout: 3,
    settings: {},
    clips: [],
    effects: [],
    files: [],
    duration: 300,
    scale: 15.0,
    tick_pixels: 100,
    playhead_position: 0,
    profile: profile.description,
    export_settings: null,
    export_overrides: {},
    layers: [1, 2, 3, 4, 5].map(layer),
    markers: [],
    progress: [],
    history: { undo: [], redo: [] },
    version: { "openshot-qt": "0.0.0", libopenshot: "0.0.0" },
  };
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

/** The content hash a project file's bytes live under in Zenvi Cloud, if any. */
export function fileSha256(file: ProjectFile): string | undefined {
  const cloud = file.cloud?.sha256;
  if (isSha256(cloud)) return cloud;
  const fingerprint = file.fingerprint?.sha256;
  return isSha256(fingerprint) ? fingerprint : undefined;
}

export function displayName(file: ProjectFile): string {
  if (typeof file.name === "string" && file.name !== "") return file.name;
  if (typeof file.cloud?.name === "string" && file.cloud.name !== "") return file.cloud.name;
  const path = typeof file.path === "string" ? file.path : "";
  return path.split(/[\\/]/).pop() || file.id;
}

/** Every project file with a content hash, plus the ones without (not in the cloud). */
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
