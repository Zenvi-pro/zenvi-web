/**
 * Default objects, with the same keys and values the desktop writes.
 *
 * - Project: zenvi-core src/settings/_default.project, after `new()` applies
 *   the default profile ("HD 720p 30 fps"), the default audio settings
 *   (48 kHz stereo) and a fresh id (src/classes/project_data.py:341-380).
 * - Clip: libopenshot 1.0 `Clip(path).Json()` (every key `Clip::JsonValue()`
 *   writes, generated into libopenshot-defaults.data.ts) plus the desktop's
 *   add-to-timeline edits (src/windows/views/timeline.py `addClip`).
 * - Transition: the sparse Mask dictionary the desktop saves
 *   (timeline.py `addTransition` / `add_missing_transition`).
 */

import type { Clip, Fraction, Keyframe, Layer, Project, ProjectFile, ReaderInfo, Transition } from "./types.js";
import { Interpolation, ScaleMode } from "./types.js";
import { expandCompact, libopenshotKeyframe } from "./compact.js";
import { generateId } from "./ids.js";
import { DEFAULT_PROFILE_DESCRIPTION, findProfile, type Profile } from "./profiles.js";
import { LIBOPENSHOT_CLIP_JSON } from "./libopenshot-defaults.data.js";
import { pyRound } from "./rounding.js";
import { isAudioOnlyMedia } from "./media.js";

/** Desktop preference `default-image-length` (seconds a still image lasts when added). */
export const DEFAULT_IMAGE_LENGTH = 10;
/** Desktop preference `default-transition-length`, seconds. */
export const DEFAULT_TRANSITION_LENGTH = 1;
/** Desktop preference `history-limit`. */
export const DEFAULT_HISTORY_LIMIT = 50;
/** Desktop preference `default-samplerate`. */
export const DEFAULT_SAMPLE_RATE = 48000;

/** FFmpeg channel layouts (libopenshot `ChannelLayout`). */
export const ChannelLayout = {
  MONO: 4,
  STEREO: 3,
  SURROUND: 7,
  FIVE_POINT_ONE: 1551,
  SEVEN_POINT_ONE: 1599,
} as const;

const LAYOUT_FOR_CHANNELS: Record<number, number> = {
  1: ChannelLayout.MONO,
  2: ChannelLayout.STEREO,
  3: ChannelLayout.SURROUND,
  6: ChannelLayout.FIVE_POINT_ONE,
  8: ChannelLayout.SEVEN_POINT_ONE,
};

/** The five tracks of `_default.project`. */
export function defaultLayers(): Layer[] {
  return [1, 2, 3, 4, 5].map((n) => ({ id: `L${n}`, label: "", number: n * 1_000_000, y: 0, lock: false }));
}

/** `_default.project` exactly as shipped (before `new()` applies the profile). */
export function defaultProjectTemplate(): Project {
  return {
    id: "T0",
    fps: { num: 24, den: 1 },
    display_ratio: { num: 16, den: 9 },
    pixel_ratio: { num: 1, den: 1 },
    width: 1280,
    height: 720,
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
    profile: "HD 720p 30 fps",
    export_settings: null,
    export_overrides: {},
    layers: defaultLayers(),
    markers: [],
    progress: [],
    history: { undo: [], redo: [] },
    version: { "openshot-qt": "0.0.0", libopenshot: "0.0.0" },
  };
}

export interface CreateProjectOptions {
  /** Profile key or description (default "HD 720p 30 fps"), or a profile object. */
  profile?: string | Profile;
  /** Default 48000. */
  sampleRate?: number;
  /** 1, 2, 3, 6 or 8 (default 2, stereo). */
  channels?: number;
  id?: string;
}

/** A new, empty project like the desktop's File ▸ New. Throws on an unknown profile. */
export function createProject(opts: CreateProjectOptions = {}): Project {
  const project = defaultProjectTemplate();
  const profile =
    typeof opts.profile === "object" ? opts.profile : findProfile(opts.profile ?? DEFAULT_PROFILE_DESCRIPTION);
  if (!profile) throw new Error(`Unknown profile: ${String(opts.profile)}`);
  applyProfileFields(project, profile);
  const channels = opts.channels ?? 2;
  const layout = LAYOUT_FOR_CHANNELS[channels];
  if (layout === undefined) throw new Error(`Unsupported channel count: ${channels}`);
  project.sample_rate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  project.channels = channels;
  project.channel_layout = layout;
  project.id = opts.id ?? generateId();
  return project;
}

/** Write a profile's size, frame rate and ratios onto a project object (project_data.py `apply_profile`). */
export function applyProfileFields(project: Project, profile: Profile): void {
  project.profile = profile.description;
  project.width = profile.width;
  project.height = profile.height;
  project.fps = { num: profile.fps.num, den: profile.fps.den };
  project.display_ratio = { num: profile.display_ratio.num, den: profile.display_ratio.den };
  project.pixel_ratio = { num: profile.pixel_ratio.num, den: profile.pixel_ratio.den };
}

/** A new track object. */
export function createLayer(number: number, id: string, label = ""): Layer {
  return { id, label, number, y: 0, lock: false };
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

/**
 * Every key libopenshot 1.0 `Clip::JsonValue()` writes for a default clip,
 * with `rotation` already initialized to 0 as `Clip(path)` does for a reader
 * (Clip.cpp `init_reader_rotation`). No `id`, no `reader`.
 */
export function libopenshotClipDefaults(): Record<string, unknown> {
  const json = expandCompact<Record<string, unknown>>(LIBOPENSHOT_CLIP_JSON);
  json.rotation = libopenshotKeyframe(0);
  return json;
}

export interface CreateClipInput {
  id: string;
  /** The bin entry the clip plays; it is copied into `reader`. */
  file: ProjectFile;
  /** Timeline start, seconds. */
  position: number;
  /** Track number. */
  layer: number;
  /** Project frame rate (source times are snapped to its grid). */
  fps: Fraction;
  /** Source in point, seconds. Default the file's own `start` (subclips) or 0. */
  start?: number;
  /** Source out point, seconds. Default the file's `end` (subclips) or its duration. */
  end?: number;
  /** Default `file.name` or the basename of `file.path`. */
  title?: string;
  /** Seconds a still image lasts (desktop `default-image-length`, 10). */
  imageLength?: number;
}

/** Basename of a path or URL (either separator). */
export function basename(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? path;
  const parts = clean.split(/[\\/]/);
  return parts[parts.length - 1] || clean;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

/** True when the file is a still image (desktop `media_type == "image"` or `has_single_image`). */
export function isStillImage(file: Pick<ReaderInfo, "has_single_image" | "media_type">): boolean {
  return file.media_type === "image" || Boolean(file.has_single_image);
}

/**
 * A clip for `file`, as the desktop's add-to-timeline builds it
 * (timeline.py `addClip`): default clip JSON, `file_id`, `title`, the file
 * entry as `reader`, audio-only overrides, and source timing snapped to the
 * frame grid (images last `imageLength`; other media their duration, rounded
 * to whole frames).
 */
export function createClip(input: CreateClipInput): Clip {
  const { file, fps } = input;
  const rate = fps.num / fps.den;
  const snap = (t: number): number => pyRound(t * rate) / rate;
  const clip = libopenshotClipDefaults();
  clip.id = input.id;
  clip.file_id = file.id;
  clip.title = input.title ?? file.name ?? basename(file.path);
  clip.reader = structuredClone(file);
  applyAudioOnlyOverrides(clip, file);

  const startSec = snap(input.start ?? num(file.start) ?? 0);
  let durationSec: number;
  let endSec: number;
  const explicitEnd = input.end ?? num(file.end);
  if (explicitEnd !== undefined) {
    endSec = snap(explicitEnd);
    durationSec = Math.max(0, endSec - startSec);
  } else {
    durationSec = num(file.duration) ?? num((clip.reader as ReaderInfo).duration) ?? 0;
    if (isStillImage(file)) durationSec = input.imageLength ?? DEFAULT_IMAGE_LENGTH;
    if (durationSec <= 0) durationSec = 1 / rate;
    const frames = Math.max(1, Math.trunc(pyRound(durationSec * rate)));
    durationSec = frames / rate;
    endSec = startSec + durationSec;
  }
  if (durationSec <= 0) {
    durationSec = 1 / rate;
    endSec = startSec + durationSec;
  }
  clip.start = startSec;
  clip.duration = durationSec;
  clip.end = endSec;
  clip.position = input.position;
  clip.layer = input.layer;
  return clip as unknown as Clip;
}

/**
 * Stop audio-only media from compositing a (cover-art) picture: `has_video`
 * off (CONSTANT), scale NONE, reader `has_video` false
 * (clip_placement.py `apply_audio_only_clip_overrides`). Mutates `clip`.
 * Returns true when the overrides applied.
 */
export function applyAudioOnlyOverrides(clip: Record<string, unknown>, file: unknown): boolean {
  if (!isAudioOnlyMedia(file)) return false;
  clip.has_video = { Points: [{ co: { X: 1.0, Y: 0.0 }, interpolation: Interpolation.CONSTANT }] } satisfies Keyframe;
  clip.scale = ScaleMode.NONE;
  const reader = clip.reader;
  if (typeof reader === "object" && reader !== null && !Array.isArray(reader)) {
    (reader as Record<string, unknown>).has_video = false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export interface CreateTransitionInput {
  id: string;
  layer: number;
  /** Timeline start, seconds. */
  position: number;
  /** Length, seconds. */
  duration: number;
  /** Reader JSON of the mask image (QtImageReader for the catalog's SVG/JPG masks). */
  reader: ReaderInfo;
  fps: Fraction;
  /** `in` = brightness 1 → -1 (the desktop default), `out` = -1 → 1. */
  direction?: "in" | "out";
  /** Default "Transition" (desktop). */
  title?: string;
  /** Desktop keeps the dropped file path in `resource`. */
  resource?: string;
  /** Desktop marks automatic overlap transitions with `fade_audio_hint: true`. */
  fadeAudio?: boolean;
}

/**
 * Brightness/contrast keyframes of a new transition (timeline.py
 * `_build_transition_default_keyframes`): brightness from `startValue` at
 * frame 1 to `endValue` at `round(duration*fps)+1`, contrast constant.
 */
export function transitionKeyframes(
  duration: number,
  fps: Fraction,
  startValue = 1.0,
  endValue = -1.0,
  contrastValue = 3.0,
): { brightness: Keyframe; contrast: Keyframe } {
  const rate = fps.num / fps.den;
  const points = [libopenshotKeyframe(Math.fround(startValue)).Points[0]!];
  if (startValue !== endValue) {
    const last = libopenshotKeyframe(Math.fround(endValue)).Points[0]!;
    last.co.X = pyRound(Math.max(0, duration) * rate) + 1;
    points.push(last);
  }
  return { brightness: { Points: points }, contrast: libopenshotKeyframe(Math.fround(contrastValue)) };
}

/** A transition dictionary like the desktop saves. */
export function createTransition(input: CreateTransitionInput): Transition {
  const direction = input.direction ?? "in";
  const [from, to] = direction === "in" ? [1.0, -1.0] : [-1.0, 1.0];
  const { brightness, contrast } = transitionKeyframes(input.duration, input.fps, from, to, 3.0);
  const transition: Transition = {
    id: input.id,
    layer: input.layer,
    title: input.title ?? "Transition",
    type: "Mask",
    class_name: "Mask",
    position: input.position,
    start: 0,
    end: input.duration,
    brightness,
    contrast,
    reader: structuredClone(input.reader),
    replace_image: false,
  };
  if (input.resource !== undefined) transition.resource = input.resource;
  if (input.fadeAudio) transition.fade_audio_hint = true;
  return transition;
}
