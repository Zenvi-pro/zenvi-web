/**
 * The `zenvi_link` record of a Zenvi FX render: the desktop's linked-clip
 * shape (zenvi-core handoff/linked_media.py, LINK_VERSION 1) with
 * `kind: "zenvi-fx"`. The render is its own bin file; the link names the
 * original file (`source.file_id`) and the source range it was rendered
 * from (`source.start` / `source.end`, seconds) and stores the stack in
 * `props.effects`, so removing the FX restores the original clip exactly
 * and a desktop provider can re-render. Keys the desktop rewrites as paths
 * on save (`path`, `image`, …) are never used: the movie is `render.output`.
 */

import type { ProjectFile } from "../model/types.js";
import { isFxId, type FxEffect } from "./catalog.js";

/** The file key linked media live under (shared with the desktop and the other link kinds). */
export const FX_LINK_KEY = "zenvi_link";
export const FX_LINK_KIND = "zenvi-fx";

export type FxCodec = "prores422" | "prores4444";

/** What a host reports for one finished render. */
export interface FxRender {
  /** The movie (local path the host's media import reads). */
  path: string;
  codec: FxCodec;
  width: number;
  height: number;
  fps: { num: number; den: number };
  frames: number;
  /** Seconds the render lasts. */
  duration: number;
  /** sha256 of the source identity, range, filtergraph and renderer version. */
  fingerprint: string;
  /** Served from the render cache. */
  cached: boolean;
  /** Wall-clock seconds (0 when cached). */
  seconds: number;
  /** ISO time the movie was rendered. */
  renderedAt: string;
  /** ffmpeg's version string. */
  ffmpeg: string;
}

export interface FxLinkSource {
  file_id: string;
  /** Source seconds the render covers. */
  start: number;
  end: number;
}

export interface FxLink {
  kind: typeof FX_LINK_KIND;
  version: 1;
  source: { project_dir: null; entry: null; composition: null; composition_key: null; file: null; line: null; aep: null } & FxLinkSource;
  props: { effects: FxEffect[] };
  render: {
    codec: FxCodec;
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
  /** Zenvi FX extras (the desktop keeps unknown keys). */
  fx: { renderer_version: number; ffmpeg: string };
  [key: string]: unknown;
}

export function fxLink(source: FxLinkSource, effects: readonly FxEffect[], render: FxRender, rendererVersion: number): FxLink {
  return {
    kind: FX_LINK_KIND,
    version: 1,
    source: { project_dir: null, entry: null, composition: null, composition_key: null, file: null, line: null, aep: null, ...source },
    props: { effects: structuredClone([...effects]) },
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
    fx: { renderer_version: rendererVersion, ffmpeg: render.ffmpeg },
  };
}

export interface ReadFxLink {
  source: FxLinkSource;
  /** The stored stack as written (parse it again before rendering). */
  effects: unknown[];
  link: Record<string, unknown>;
}

/** The original file, range and stack of a file rendered by Zenvi FX, or null. */
export function readFxLink(file: ProjectFile | undefined): ReadFxLink | null {
  const link = file?.[FX_LINK_KEY];
  if (!link || typeof link !== "object" || Array.isArray(link)) return null;
  const record = link as Record<string, unknown>;
  if (record.kind !== FX_LINK_KIND) return null;
  const source = (record.source ?? {}) as Record<string, unknown>;
  const fileId = source.file_id;
  const start = Number(source.start);
  const end = Number(source.end);
  if (typeof fileId !== "string" || !fileId || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const props = (record.props ?? {}) as Record<string, unknown>;
  const effects = Array.isArray(props.effects) ? props.effects.filter((e) => isFxId((e as { effect?: unknown })?.effect)) : [];
  return { source: { file_id: fileId, start, end }, effects, link: record };
}
