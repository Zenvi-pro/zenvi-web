/**
 * Zenvi project model.
 *
 * These types describe the project JSON the desktop editor saves (`.zvn`,
 * OpenShot `.osp` lineage) and libopenshot 1.0 reads through
 * `Timeline::SetJson`. Field names, value encodings and units match that JSON
 * exactly so a project round-trips between desktop, web, CLI and cloud.
 *
 * Every object type carries an index signature: unknown keys written by newer
 * desktop builds (AI metadata, tags, fingerprints…) must survive a round trip.
 *
 * Units: all times are seconds (floats) unless a name says `frame`. Keyframe
 * `X` values are 1-based frame numbers at the *project* frame rate.
 */

/** A rational number, e.g. `{ num: 30000, den: 1001 }` for 29.97 fps. */
export interface Fraction {
  num: number;
  den: number;
}

// ---------------------------------------------------------------------------
// Keyframes (libopenshot src/KeyFrame.h, Point.h, Coordinate.h)
// ---------------------------------------------------------------------------

/** libopenshot `InterpolationType`. */
export const Interpolation = {
  BEZIER: 0,
  LINEAR: 1,
  CONSTANT: 2,
} as const;
export type Interpolation = (typeof Interpolation)[keyof typeof Interpolation];

/** libopenshot `HandleType`. */
export const HandleType = {
  AUTO: 0,
  MANUAL: 1,
} as const;
export type HandleType = (typeof HandleType)[keyof typeof HandleType];

export interface Coordinate {
  X: number;
  Y: number;
}

export interface KeyframePoint {
  /** `X` = 1-based frame number, `Y` = value. */
  co: Coordinate;
  /** Bezier handles, relative (0..1) to the segment. Defaults: left (0.5, 1), right (0.5, 0). */
  handle_left?: Coordinate;
  handle_right?: Coordinate;
  handle_type?: HandleType;
  interpolation: Interpolation;
  [key: string]: unknown;
}

export interface Keyframe {
  Points: KeyframePoint[];
  [key: string]: unknown;
}

/** libopenshot `Color`: one keyframe per channel, values 0..255. */
export interface ColorKeyframe {
  red: Keyframe;
  green: Keyframe;
  blue: Keyframe;
  alpha?: Keyframe;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Enums (libopenshot src/Enums.h). Stored as integers in the JSON.
// ---------------------------------------------------------------------------

export const Gravity = {
  TOP_LEFT: 0,
  TOP: 1,
  TOP_RIGHT: 2,
  LEFT: 3,
  CENTER: 4,
  RIGHT: 5,
  BOTTOM_LEFT: 6,
  BOTTOM: 7,
  BOTTOM_RIGHT: 8,
} as const;
export type Gravity = (typeof Gravity)[keyof typeof Gravity];

export const ScaleMode = {
  CROP: 0,
  FIT: 1,
  STRETCH: 2,
  NONE: 3,
} as const;
export type ScaleMode = (typeof ScaleMode)[keyof typeof ScaleMode];

export const Anchor = {
  CANVAS: 0,
  VIEWPORT: 1,
} as const;
export type Anchor = (typeof Anchor)[keyof typeof Anchor];

export const FrameDisplay = {
  NONE: 0,
  CLIP: 1,
  TIMELINE: 2,
  BOTH: 3,
} as const;
export type FrameDisplay = (typeof FrameDisplay)[keyof typeof FrameDisplay];

export const VolumeMix = {
  NONE: 0,
  AVERAGE: 1,
  REDUCE: 2,
} as const;
export type VolumeMix = (typeof VolumeMix)[keyof typeof VolumeMix];

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export type MediaType = "video" | "audio" | "image";

/**
 * libopenshot `ReaderInfo` as serialized by `ReaderBase::JsonValue()`, plus the
 * reader `type` and `path`. Also the shape of a project file entry.
 */
export interface ReaderInfo {
  /** "FFmpegReader" | "QtImageReader" | "ImageReader" | "ChunkReader" | … */
  type: string;
  path: string;
  has_video: boolean;
  has_audio: boolean;
  has_single_image: boolean;
  duration: number;
  width: number;
  height: number;
  fps: Fraction;
  video_length: number | string;
  pixel_ratio: Fraction;
  display_ratio: Fraction;
  sample_rate: number;
  channels: number;
  channel_layout: number;
  vcodec?: string;
  acodec?: string;
  video_bit_rate?: number;
  audio_bit_rate?: number;
  video_stream_index?: number;
  audio_stream_index?: number;
  video_timebase?: Fraction;
  audio_timebase?: Fraction;
  interlaced_frame?: boolean;
  top_field_first?: boolean;
  pixel_format?: number;
  file_size?: number | string;
  metadata?: Record<string, string>;
  media_type?: MediaType;
  [key: string]: unknown;
}

export interface FileFingerprint {
  size: number;
  mtime?: number;
  sha256: string;
  [key: string]: unknown;
}

/**
 * Where a file's bytes live when the project is stored in Zenvi Cloud.
 * Added by push; desktop builds that do not know it ignore it.
 */
export interface CloudMediaRef {
  /** Content hash (lowercase hex). Media blobs are content-addressed per user. */
  sha256: string;
  size: number;
  content_type?: string;
  /** Original file name, for display and for pull. */
  name: string;
  [key: string]: unknown;
}

/** An entry in the project's media bin (`project.files[]`). */
export interface ProjectFile extends ReaderInfo {
  id: string;
  media_type: MediaType;
  fingerprint?: FileFingerprint;
  /** Display name override (desktop "Name" column). Defaults to basename(path). */
  name?: string;
  tags?: string;
  cloud?: CloudMediaRef;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Timeline objects
// ---------------------------------------------------------------------------

/** A clip effect (libopenshot `EffectBase::JsonValue()`); params vary by effect. */
export interface Effect {
  id: string;
  /** libopenshot class name, e.g. "Brightness", "Blur", "ChromaKey". */
  class_name: string;
  /** Same as class_name for effects; "Mask" for transitions. */
  type: string;
  name?: string;
  description?: string;
  has_video?: boolean;
  has_audio?: boolean;
  has_tracked_object?: boolean;
  /** Stacking order among a clip's effects. */
  order?: number;
  apply_before_clip?: boolean;
  position?: number;
  start?: number;
  end?: number;
  duration?: number;
  layer?: number;
  parent_effect_id?: string;
  /** Effect parameters: Keyframe | ColorKeyframe | number | string | boolean | nested objects. */
  [param: string]: unknown;
}

export interface Clip {
  id: string;
  /** `project.files[].id` this clip reads from. */
  file_id: string;
  title?: string;
  /** Timeline start, seconds. */
  position: number;
  /** Source in point, seconds. */
  start: number;
  /** Source out point, seconds. */
  end: number;
  /** Source media duration, seconds (informational; libopenshot uses end-start). */
  duration?: number;
  /** Track number (`layers[].number`). Higher numbers draw on top. */
  layer: number;
  /** Snapshot of the reader the clip plays. `reader.path` must resolve to media. */
  reader: ReaderInfo;
  /** Thumbnail path the desktop shows (not used for rendering). */
  image?: string;

  gravity: Gravity;
  scale: ScaleMode;
  anchor: Anchor;
  display: FrameDisplay;
  mixing: VolumeMix;
  composite?: number;
  waveform: boolean;
  parentObjectId?: string;

  location_x: Keyframe;
  location_y: Keyframe;
  scale_x: Keyframe;
  scale_y: Keyframe;
  alpha: Keyframe;
  rotation: Keyframe;
  shear_x: Keyframe;
  shear_y: Keyframe;
  origin_x: Keyframe;
  origin_y: Keyframe;
  volume: Keyframe;
  /** Time remapping: Y = source frame to show at timeline frame X. Empty = identity. */
  time: Keyframe;
  channel_filter: Keyframe;
  channel_mapping: Keyframe;
  /** -1 = use reader value, 0 = off, 1 = on. */
  has_audio: Keyframe;
  has_video: Keyframe;
  perspective_c1_x: Keyframe;
  perspective_c1_y: Keyframe;
  perspective_c2_x: Keyframe;
  perspective_c2_y: Keyframe;
  perspective_c3_x: Keyframe;
  perspective_c3_y: Keyframe;
  perspective_c4_x: Keyframe;
  perspective_c4_y: Keyframe;
  wave_color: ColorKeyframe;

  effects: Effect[];
  [key: string]: unknown;
}

/**
 * A timeline-level transition (`project.effects[]`), libopenshot `Mask` effect.
 * The mask image's luminance, shifted by `brightness` and sharpened by
 * `contrast`, becomes the alpha of the top clip on `layer` while it overlaps.
 */
export interface Transition extends Effect {
  type: "Mask";
  class_name: "Mask";
  position: number;
  start: number;
  end: number;
  layer: number;
  /** Reader for the mask image (a PNG/SVG from the transitions catalog). */
  reader: ReaderInfo;
  brightness: Keyframe;
  contrast: Keyframe;
  replace_image: boolean;
  title?: string;
  [param: string]: unknown;
}

export interface Layer {
  id: string;
  /** Track number: multiples of 1_000_000 on the desktop; higher = on top. */
  number: number;
  label: string;
  y: number;
  lock: boolean;
  [key: string]: unknown;
}

export interface Marker {
  id: string;
  /** Timeline position, seconds. */
  position: number;
  icon?: string;
  vector?: string;
  label?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  fps: Fraction;
  display_ratio: Fraction;
  pixel_ratio: Fraction;
  width: number;
  height: number;
  sample_rate: number;
  channels: number;
  channel_layout: number;
  settings: Record<string, unknown>;
  clips: Clip[];
  /** Timeline-level effects. On the desktop these are transitions. */
  effects: Transition[];
  files: ProjectFile[];
  /** Timeline length, seconds. */
  duration: number;
  /** Timeline zoom (seconds per tick). UI state saved with the project. */
  scale: number;
  tick_pixels: number;
  /** Playhead, seconds. UI state saved with the project. */
  playhead_position: number;
  /** Profile description, e.g. "HD 720p 30 fps". */
  profile: string;
  export_settings: Record<string, unknown> | null;
  export_overrides: Record<string, unknown>;
  layers: Layer[];
  markers: Marker[];
  progress: unknown[];
  /** Serialized undo/redo slice (desktop `history-limit`, default 50). */
  history: { undo: unknown[]; redo: unknown[]; [key: string]: unknown };
  version: Record<string, string>;
  [key: string]: unknown;
}

/** Every object that lives in a project collection has an id. */
export type Identified = { id: string };

/** Names of the collections that hold identified objects. */
export type ProjectCollection = "clips" | "effects" | "files" | "layers" | "markers";
