/**
 * Linked media: a project file whose media is a render of a spec, with the
 * spec kept on the file record so the render can be redone (one undo step)
 * when the spec changes. The record is the desktop's `zenvi_link` object
 * (zenvi-core jashan/handoff-core src/classes/handoff/linked_media.py,
 * SPEC §3.6): kind, version 1, source, props, render, state, error. Zenvi
 * Motion blocks use kind "zenvi-motion" and keep their own settings under
 * `motion`; unknown keys of other kinds survive untouched.
 *
 * The desktop rewrites every string under a key named path, image,
 * resource, protobuf_data_path or lut_path when it saves, so the record
 * never uses those names and props containing one are stored JSON-encoded
 * (`{"$zenvi_json": "…"}`, linked_media.encode_props).
 */

import { readPictureEvents, type PictureEvent } from "../sfx/events.js";

export const LINK_KEY = "zenvi_link";
export const LINK_VERSION = 1;
export const MOTION_LINK_KIND = "zenvi-motion";
const PATH_LIKE_KEYS = new Set(["path", "image", "resource", "protobuf_data_path", "lut_path"]);
const PROPS_ESCAPE_KEY = "$zenvi_json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasPathLikeKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasPathLikeKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([k, v]) => PATH_LIKE_KEYS.has(k.toLowerCase()) || hasPathLikeKey(v));
}

/** Props as stored: as is, or JSON-encoded when a key would be rewritten as a path on save (encode_props). */
export function encodeLinkProps(props: Readonly<Record<string, unknown>>): Record<string, unknown> {
  if (hasPathLikeKey(props)) return { [PROPS_ESCAPE_KEY]: JSON.stringify(sortKeys(props)) };
  return structuredClone({ ...props });
}

/** Props as the source sees them (decode_props). */
export function decodeLinkProps(stored: unknown): Record<string, unknown> {
  if (isRecord(stored) && Object.keys(stored).length === 1 && typeof stored[PROPS_ESCAPE_KEY] === "string") {
    try {
      const value: unknown = JSON.parse(stored[PROPS_ESCAPE_KEY]);
      return isRecord(value) ? value : {};
    } catch {
      return {};
    }
  }
  return isRecord(stored) ? structuredClone(stored) : {};
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
}

/** How a motion block was rendered: what update_motion_block_tool needs to render it again. */
export interface MotionLinkSpec {
  block: string;
  /** The checked params (media params hold bin file ids). */
  params: Record<string, unknown>;
  seconds: number;
  alpha: boolean;
  motionBlurSamples: number;
  draft: boolean;
}

export interface LinkRender {
  codec: string;
  width: number;
  height: number;
  fps: { num: number; den: number };
  frames: number;
  /** The rendered file (the file record's path when it was made). */
  output: string;
  fingerprint: string;
  /** ISO 8601. */
  renderedAt: string;
  /** The block's picture events (sfx/events.ts), when the host reported them. */
  events?: readonly PictureEvent[];
}

/** The `zenvi_link` record of a rendered motion block. */
export function motionLink(spec: MotionLinkSpec, render: LinkRender): Record<string, unknown> {
  return {
    kind: MOTION_LINK_KIND,
    version: LINK_VERSION,
    source: { project_dir: null, entry: null, composition: spec.block, composition_key: null, file: null, line: null, aep: null },
    props: encodeLinkProps(spec.params),
    render: {
      codec: render.codec,
      width: render.width,
      height: render.height,
      fps: { num: render.fps.num, den: render.fps.den },
      duration_frames: render.frames,
      output: render.output,
      rendered_at: render.renderedAt,
      fingerprint: render.fingerprint,
    },
    state: "fresh",
    error: null,
    motion: {
      block: spec.block,
      seconds: spec.seconds,
      alpha: spec.alpha,
      motion_blur_samples: spec.motionBlurSamples,
      draft: spec.draft,
      ...(render.events ? { events: render.events.map((e) => ({ ...e })) } : {}),
    },
  };
}

/**
 * The picture events recorded with a motion block's render; null when none
 * were (another kind of file, or a block placed before events were recorded:
 * an empty list means the block has nothing to sound).
 */
export function readMotionEvents(file: Readonly<Record<string, unknown>>): PictureEvent[] | null {
  const link = file[LINK_KEY];
  if (!isRecord(link) || link.kind !== MOTION_LINK_KIND || !isRecord(link.motion) || !Array.isArray(link.motion.events)) return null;
  return readPictureEvents(link.motion.events);
}

/** The motion spec of a file rendered from a block, or null for any other file. */
export function readMotionLink(file: Readonly<Record<string, unknown>>): (MotionLinkSpec & { fingerprint: string | null }) | null {
  const link = file[LINK_KEY];
  if (!isRecord(link) || link.kind !== MOTION_LINK_KIND) return null;
  const motion = isRecord(link.motion) ? link.motion : {};
  const source = isRecord(link.source) ? link.source : {};
  const render = isRecord(link.render) ? link.render : {};
  const block = typeof motion.block === "string" ? motion.block : typeof source.composition === "string" ? source.composition : null;
  if (!block) return null;
  const seconds = Number(motion.seconds);
  return {
    block,
    params: decodeLinkProps(link.props),
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
    alpha: motion.alpha === true,
    motionBlurSamples: Math.max(1, Math.trunc(Number(motion.motion_blur_samples) || 1)),
    draft: motion.draft === true,
    fingerprint: typeof render.fingerprint === "string" ? render.fingerprint : null,
  };
}
