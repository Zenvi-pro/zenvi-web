/**
 * Transition mask lookup used by the transition ops.
 *
 * STUB (W1): the transitions catalog (`src/transitions/`, workstream W1b)
 * owns the full list of zenvi-core `src/transitions/{common,extra}` masks.
 * Until it lands this module knows the seven `common` masks and accepts
 * explicit `extra/<name>` ids; `resolveTransitionMask` keeps its signature
 * when it switches to the catalog.
 */

import type { ReaderInfo } from "../model/types.js";

export interface TransitionMask {
  /** Path as the desktop stores it, e.g. `@transitions/common/fade.svg`, or a user file path. */
  path: string;
  /** Title the desktop's tools give the transition: the file name without extension. */
  title: string;
  /** Natural size of the mask image. The desktop masks are 720×576. */
  width: number;
  height: number;
}

/** zenvi-core src/transitions/common (all 720×576 SVGs). */
const COMMON_MASKS = [
  "circle_in_to_out",
  "circle_out_to_in",
  "fade",
  "wipe_bottom_to_top",
  "wipe_left_to_right",
  "wipe_right_to_left",
  "wipe_top_to_bottom",
] as const;

function mask(category: "common" | "extra", stem: string): TransitionMask {
  const ext = category === "common" ? "svg" : "jpg";
  return { path: `@transitions/${category}/${stem}.${ext}`, title: stem, width: 720, height: 576 };
}

/**
 * Resolve a transition by catalog id (`common/fade`, `extra/barr_ripple_1`),
 * stored path (`@transitions/…`) or name, fuzzy-matched like zenvi-core
 * tool_handlers.py `add_transition_between_clips`: lower-case, spaces to
 * underscores, then the first file whose stem contains the query or is
 * contained in it (common before extra).
 */
export function resolveTransitionMask(query: string): TransitionMask | undefined {
  const q = String(query ?? "").trim();
  if (!q) return undefined;
  const stored = /^@transitions\/(common|extra)\/([^/]+)\.(svg|jpg|png)$/i.exec(q);
  if (stored) return { ...mask(stored[1]!.toLowerCase() as "common" | "extra", stored[2]!), path: q };
  const id = /^(common|extra)\/([^/.]+)(?:\.(?:svg|jpg|png))?$/i.exec(q);
  if (id) return mask(id[1]!.toLowerCase() as "common" | "extra", id[2]!);
  const search = q.toLowerCase().replace(/ /g, "_");
  const stem = COMMON_MASKS.find((s) => s.includes(search) || search.includes(s));
  return stem ? mask("common", stem) : undefined;
}

/**
 * The reader JSON libopenshot 1.0 `QtImageReader(path).Json()` writes for a
 * still mask (QtImageReader.cpp `Open`: 30 fps, one hour, single image).
 */
export function maskReader(path: string, width = 720, height = 576): ReaderInfo {
  const g = gcd(width, height);
  return {
    acodec: "",
    audio_bit_rate: 0,
    audio_stream_index: -1,
    audio_timebase: { num: 1, den: 1 },
    channel_layout: 4,
    channels: 0,
    display_ratio: { num: width / g, den: height / g },
    duration: 3600,
    file_size: width * height * 4,
    fps: { num: 30, den: 1 },
    has_audio: false,
    has_single_image: true,
    has_video: true,
    height,
    interlaced_frame: false,
    metadata: {},
    path,
    pixel_format: -1,
    pixel_ratio: { num: 1, den: 1 },
    sample_rate: 0,
    top_field_first: true,
    type: "QtImageReader",
    vcodec: "QImage",
    video_bit_rate: 0,
    video_length: 108000,
    video_stream_index: -1,
    video_timebase: { num: 1, den: 30 },
    width,
  };
}

function gcd(a: number, b: number): number {
  a = Math.abs(Math.trunc(a));
  b = Math.abs(Math.trunc(b));
  while (b) [a, b] = [b, a % b];
  return a || 1;
}
