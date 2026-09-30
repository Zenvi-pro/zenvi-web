/**
 * Timeline clip operations.
 *
 * Ported from zenvi-core src/windows/views/timeline.py (add to timeline,
 * drag/trim, Slice_Triggered, Time_Triggered, Fade_Triggered,
 * Volume_Triggered, Split_Audio_Triggered) and src/classes/tool_handlers.py
 * (`set_clip_volume`, `add_clip_to_timeline`). Every op validates first and
 * throws `OpError` before recording anything.
 */

import type { Transaction } from "../history/document.js";
import type { Clip } from "../model/types.js";
import { OpError } from "./errors.js";
import type { Edge, KeyframeAt, KeyframePointInput, PropertyValue, SliceKeep } from "./types.js";

function notImplemented(op: string): never {
  throw new OpError("unsupported", `not implemented: ${op}`);
}

// ---------------------------------------------------------------------------
// Add / move / trim
// ---------------------------------------------------------------------------

export interface AddClipInput {
  /** `project.files[].id` to play. */
  fileId: string;
  /** Timeline start, seconds (>= 0). */
  position: number;
  /** Track number (`layers[].number`). The track must exist. */
  layer: number;
  /** Source in point, seconds. Default 0 (a subclip's own `start`). */
  start?: number;
  /**
   * Source out point, seconds. Default the media duration; still images use
   * the desktop `default-image-length` (10 s).
   */
  end?: number;
  /** Clip title. Default the file's display name (basename of its path). */
  title?: string;
  /** Explicit id (tests, deterministic imports). */
  id?: string;
}

/**
 * Add a clip to the timeline: the full libopenshot default clip JSON plus a
 * snapshot of the file's reader, like the desktop's add-to-timeline. Returns
 * the inserted clip.
 */
export function addClip(tx: Transaction, input: AddClipInput): Clip {
  void tx;
  void input;
  return notImplemented("addClip");
}

export interface MoveClipInput {
  /** New timeline start, seconds (>= 0). Snapped to the frame grid. */
  position?: number;
  /** New track number. The track must exist and be unlocked. */
  layer?: number;
}

/** Move a clip in time and/or to another track. Moving nowhere records nothing. */
export function moveClip(tx: Transaction, clipId: string, to: MoveClipInput): Clip {
  void tx;
  void clipId;
  void to;
  return notImplemented("moveClip");
}

export interface TrimClipInput {
  /** New source in point, seconds. */
  start?: number;
  /** New source out point, seconds. */
  end?: number;
}

/**
 * Change a clip's source in/out points without moving its timeline position
 * (desktop Properties "Start"/"End"). Values are clamped to the media like the
 * desktop's `clamp_timing_to_media`; an empty result is refused.
 */
export function trimClip(tx: Transaction, clipId: string, range: TrimClipInput): Clip {
  void tx;
  void clipId;
  void range;
  return notImplemented("trimClip");
}

/**
 * Drag one edge of a clip to `timelineSeconds`, like the desktop timeline trim
 * handles. Left: moves `position` and `start` together (the content stays put
 * on screen). Right: moves `end`. Clamped to the media and to a one-frame
 * minimum length.
 */
export function trimClipEdge(tx: Transaction, clipId: string, edge: Edge, timelineSeconds: number): Clip {
  void tx;
  void clipId;
  void edge;
  void timelineSeconds;
  return notImplemented("trimClipEdge");
}

// ---------------------------------------------------------------------------
// Split / delete / duplicate
// ---------------------------------------------------------------------------

export interface SplitClipResult {
  /** Id of the part before the cut (the original clip), or null when not kept. */
  leftId: string | null;
  /** Id of the part after the cut (a new clip when both are kept), or null when not kept. */
  rightId: string | null;
}

/**
 * Cut a clip at timeline time `atSeconds` (desktop Slice_Triggered). `both`
 * keeps the original clip as the left part and adds a new clip for the right
 * part; `left`/`right` keep only that side. Keyframes need no shifting because
 * clip keyframes are in source frame space; both parts keep them all. The cut
 * must fall strictly inside the clip.
 */
export function splitClip(tx: Transaction, clipId: string, atSeconds: number, keep: SliceKeep = "both"): SplitClipResult {
  void tx;
  void clipId;
  void atSeconds;
  void keep;
  return notImplemented("splitClip");
}

export interface DeleteClipsOptions {
  /**
   * Close the gap each deleted clip leaves on its track by moving later clips
   * (and transitions) on that track left (desktop ripple delete). Default false.
   */
  ripple?: boolean;
}

/** Delete clips. Unknown ids are refused (nothing is deleted). Returns the deleted ids. */
export function deleteClips(tx: Transaction, clipIds: readonly string[], opts: DeleteClipsOptions = {}): string[] {
  void tx;
  void clipIds;
  void opts;
  return notImplemented("deleteClips");
}

export interface DuplicateClipOptions {
  /** Timeline start of the copy. Default: right after the original on its track. */
  position?: number;
  /** Track of the copy. Default: the original's track. */
  layer?: number;
  id?: string;
}

/** Copy a clip (new clip id and new effect ids, like desktop paste). Returns the copy. */
export function duplicateClip(tx: Transaction, clipId: string, opts: DuplicateClipOptions = {}): Clip {
  void tx;
  void clipId;
  void opts;
  return notImplemented("duplicateClip");
}

// ---------------------------------------------------------------------------
// Properties and keyframes
// ---------------------------------------------------------------------------

/**
 * Set one clip property the way the desktop Properties panel does.
 *
 * - Keyframed properties (`alpha`, `location_x`, `scale_x`, `volume`, `time`,
 *   …): with `at.frame`/`at.time`, the point at that frame is updated or a
 *   point is inserted (LINEAR, CONSTANT for choice properties); without it the
 *   property becomes that constant value. `scale_*`/`shear_*` are clamped like
 *   the desktop.
 * - Color properties (`wave_color`): a `ColorInput`, keyframed per channel.
 * - Plain properties (`gravity`, `scale`, `anchor`, `display`, `mixing`,
 *   `composite`, `waveform`, `title`, …): set outright; `at` must be omitted.
 * - `position`/`start`/`end` delegate to `moveClip`/`trimClip`.
 *
 * Unknown property names are refused with `invalid_argument`.
 */
export function setClipProperty(
  tx: Transaction,
  clipId: string,
  prop: string,
  value: PropertyValue,
  at: KeyframeAt = {},
): Clip {
  void tx;
  void clipId;
  void prop;
  void value;
  void at;
  return notImplemented("setClipProperty");
}

export interface SetKeyframesOptions {
  /**
   * `replace` (default): the property's points become exactly `points`.
   * `merge`: each point replaces an existing point at the same frame or is
   * inserted; other points stay.
   */
  mode?: "replace" | "merge";
}

/** Write many keyframe points of one keyframed clip property at once. */
export function setClipKeyframes(
  tx: Transaction,
  clipId: string,
  prop: string,
  points: readonly KeyframePointInput[],
  opts: SetKeyframesOptions = {},
): Clip {
  void tx;
  void clipId;
  void prop;
  void points;
  void opts;
  return notImplemented("setClipKeyframes");
}

// ---------------------------------------------------------------------------
// Time, fades, volume, audio
// ---------------------------------------------------------------------------

export interface SetClipSpeedOptions {
  /** `backward` plays the clip in reverse at `factor` (desktop Time ▸ Backward). Default forward. */
  direction?: "forward" | "backward";
}

/**
 * Play a clip `factor` times faster (2 = twice as fast, 0.5 = half speed),
 * like the desktop Time presets: the clip's timeline length becomes
 * `(end - start) / factor` and the `time` curve (plus every other keyframe) is
 * retimed to match (`retime_clip`). `factor` 1 forward resets the speed.
 */
export function setClipSpeed(tx: Transaction, clipId: string, factor: number, opts: SetClipSpeedOptions = {}): Clip {
  void tx;
  void clipId;
  void factor;
  void opts;
  return notImplemented("setClipSpeed");
}

export interface FadeClipOptions {
  /** Fade-in length in seconds from the clip start (0 removes a fade-in). */
  fadeIn?: number;
  /** Fade-out length in seconds before the clip end (0 removes a fade-out). */
  fadeOut?: number;
  /** Fade the picture (`alpha`). Default true when the clip has video. */
  video?: boolean;
  /** Fade the sound (`volume`). Default true when the clip has audio. */
  audio?: boolean;
}

/**
 * Fade a clip in and/or out (desktop Fade menu: alpha and volume together).
 * Existing points in the fade zone are replaced; the fade ends at the value
 * the curve had at the zone boundary, so an existing level is preserved.
 */
export function fadeClip(tx: Transaction, clipId: string, opts: FadeClipOptions): Clip {
  void tx;
  void clipId;
  void opts;
  return notImplemented("fadeClip");
}

export interface SetClipVolumeOptions {
  /** Linear gain 0..1.3 (give exactly one of `level` / `levelDb`). */
  level?: number;
  /** Gain in dB (negative = quieter). */
  levelDb?: number;
  /** Timeline seconds where the window starts. Omit both for the whole clip. */
  start?: number;
  /** Timeline seconds where the window ends. */
  end?: number;
  /** Ramp length at each window edge, milliseconds. Default 150. */
  fadeMs?: number;
  /** `replace` (default) sets the level; `scale` multiplies existing automation. */
  mode?: "replace" | "scale";
}

export interface SetClipVolumeResult {
  clip: Clip;
  /** The clip's static level before the change, or null when it was automated. */
  before: number | null;
  /** The linear gain written. */
  target: number;
  /** Number of volume points written. */
  points: number;
}

/**
 * Set a clip's audio level over the whole clip or one timeline window
 * (zenvi-core tool_handlers.py `set_clip_volume` + classes/audio_mix.py
 * `build_static_level_points`). Refuses clips without audio.
 */
export function setClipVolume(tx: Transaction, clipId: string, opts: SetClipVolumeOptions): SetClipVolumeResult {
  void tx;
  void clipId;
  void opts;
  return notImplemented("setClipVolume");
}

export interface SeparateAudioOptions {
  /** One audio clip per channel (desktop Separate Audio ▸ Multiple). Default false (single clip). */
  perChannel?: boolean;
}

/**
 * Split a clip's sound onto its own clip(s) on the track below (created when
 * needed), and mute the original's audio (desktop Split_Audio_Triggered).
 * Returns the new audio clips.
 */
export function separateAudio(tx: Transaction, clipId: string, opts: SeparateAudioOptions = {}): Clip[] {
  void tx;
  void clipId;
  void opts;
  return notImplemented("separateAudio");
}

// ---------------------------------------------------------------------------
// Timeline-wide edits
// ---------------------------------------------------------------------------

export interface SliceAllOptions {
  keep?: SliceKeep;
  /** Only clips on these tracks. Default every unlocked track. */
  layers?: readonly number[];
}

/**
 * Cut every clip under timeline time `atSeconds` (desktop playhead menu
 * "Slice All" / `slice_clip_at_playhead_tool`). Clips on locked tracks are
 * skipped. Returns one result per clip that was cut.
 */
export function sliceAllAt(tx: Transaction, atSeconds: number, opts: SliceAllOptions = {}): (SplitClipResult & { clipId: string })[] {
  void tx;
  void atSeconds;
  void opts;
  return notImplemented("sliceAllAt");
}

/**
 * Close the empty gap on track `layer` that contains timeline time
 * `atSeconds` by moving every later clip and transition on that track left
 * (desktop RemoveGap_Triggered). Returns the gap length removed (0 when
 * `atSeconds` is not in a gap, in which case nothing is recorded).
 */
export function removeGap(tx: Transaction, layer: number, atSeconds: number): number {
  void tx;
  void layer;
  void atSeconds;
  return notImplemented("removeGap");
}
