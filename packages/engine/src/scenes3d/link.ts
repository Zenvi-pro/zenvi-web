/**
 * The `zenvi_link` record of a rendered 3D scene: the desktop's linked-clip
 * shape (zenvi-core handoff/linked_media.py, LINK_VERSION 1) with
 * `kind: "blender"`, so a desktop build that registers a Blender provider
 * can re-render it. Keys the desktop rewrites as paths on save (`path`,
 * `image`, …) are never used: the movie is `render.output`, media are file
 * ids in `props`.
 */

import type { ProjectFile } from "../model/types.js";
import { isScene3dId, type Scene3dId, type Scene3dParams } from "./catalog.js";

export const ZENVI_LINK_KEY = "zenvi_link";
export const BLENDER_LINK_KIND = "blender";

export type Scene3dQuality = "draft" | "final";
export type Scene3dCodec = "prores4444" | "h264";

/** What a host reports for one finished render. */
export interface Scene3dRender {
  /** The movie (local path the host's media import reads). */
  path: string;
  codec: Scene3dCodec;
  width: number;
  height: number;
  fps: { num: number; den: number };
  frames: number;
  /** sha256 of scene id, params, media, scene-script hash, size, fps and frames. */
  fingerprint: string;
  /** Served from the render cache. */
  cached: boolean;
  /** Wall-clock seconds (0 when cached). */
  seconds: number;
  /** ISO time the movie was rendered. */
  renderedAt: string;
  /** Blender's version string. */
  blender: string;
}

export interface BlenderLink {
  kind: typeof BLENDER_LINK_KIND;
  version: 1;
  source: { project_dir: null; entry: string; composition: Scene3dId; composition_key: null; file: null; line: null; aep: null };
  props: Scene3dParams;
  render: {
    codec: Scene3dCodec;
    width: number;
    height: number;
    fps: { num: number; den: number };
    duration_frames: number;
    output: string;
    rendered_at: string;
    fingerprint: string;
  };
  state: "fresh";
  error: null;
  /** Zenvi 3D extras (the desktop keeps unknown keys). */
  scenes3d: { quality: Scene3dQuality; blender: string };
  [key: string]: unknown;
}

export function blenderLink(scene: Scene3dId, params: Scene3dParams, render: Scene3dRender, quality: Scene3dQuality): BlenderLink {
  return {
    kind: BLENDER_LINK_KIND,
    version: 1,
    source: { project_dir: null, entry: `scenes/${scene}.py`, composition: scene, composition_key: null, file: null, line: null, aep: null },
    props: structuredClone(params),
    render: {
      codec: render.codec,
      width: render.width,
      height: render.height,
      fps: { ...render.fps },
      duration_frames: render.frames,
      output: render.path,
      rendered_at: render.renderedAt,
      fingerprint: render.fingerprint,
    },
    state: "fresh",
    error: null,
    scenes3d: { quality, blender: render.blender },
  };
}

/** The scene and stored params of a file rendered by Zenvi 3D, or null. */
export function readBlenderLink(file: ProjectFile): { scene: Scene3dId; props: Record<string, unknown>; link: Record<string, unknown> } | null {
  const link = file[ZENVI_LINK_KEY];
  if (!link || typeof link !== "object" || Array.isArray(link)) return null;
  const record = link as Record<string, unknown>;
  if (record.kind !== BLENDER_LINK_KIND) return null;
  const source = record.source as Record<string, unknown> | undefined;
  const scene = source?.composition;
  if (!isScene3dId(scene)) return null;
  const props = record.props && typeof record.props === "object" && !Array.isArray(record.props) ? (record.props as Record<string, unknown>) : {};
  return { scene, props, link: record };
}
