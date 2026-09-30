/**
 * Clip presets from the desktop clip context menu: Fade, Rotate, Layout,
 * Volume, Time, Animate (motion in/out, emphasis, camera, credits).
 *
 * Ported from zenvi-core src/windows/views/timeline.py (Fade_Triggered,
 * Rotate_Triggered, Layout_Triggered, Volume_Triggered, Time_Triggered,
 * Animate_Triggered) and src/animation_presets.py / camera_motion.py. Menu
 * enums: src/windows/views/timeline_backend/enums.py.
 */

import type { Transaction } from "../history/document.js";
import type { Clip } from "../model/types.js";
import { OpError } from "./errors.js";

/** Desktop MenuFade. */
export const FADE_PRESETS = ["none", "in_fast", "in_slow", "out_fast", "out_slow", "in_out_fast", "in_out_slow"] as const;
export type FadePreset = (typeof FADE_PRESETS)[number];

/** Desktop MenuRotate. */
export const ROTATE_PRESETS = ["none", "right_90", "left_90", "flip_180"] as const;
export type RotatePreset = (typeof ROTATE_PRESETS)[number];

/**
 * Desktop MenuLayout for one clip. (`ALL_WITH_ASPECT` / `ALL_WITHOUT_ASPECT`
 * arrange several clips; see `layoutShowAll`.)
 */
export const LAYOUT_PRESETS = ["none", "center", "top_left", "top_right", "bottom_left", "bottom_right"] as const;
export type LayoutPreset = (typeof LAYOUT_PRESETS)[number];

/** Desktop MenuVolume (`level` uses `ClipPresetOptions.level`). */
export const VOLUME_PRESETS = [
  "none",
  "fade_in_fast",
  "fade_in_slow",
  "fade_out_fast",
  "fade_out_slow",
  "fade_in_out_fast",
  "fade_in_out_slow",
  "level",
] as const;
export type VolumePreset = (typeof VOLUME_PRESETS)[number];

/**
 * Desktop MenuTime. `forward`/`backward` use `ClipPresetOptions.speed`
 * (e.g. 2 or 0.5); `freeze`/`freeze_zoom` use `seconds` and `playhead`.
 */
export const TIME_PRESETS = ["none", "forward", "backward", "reverse", "freeze", "freeze_zoom"] as const;
export type TimePreset = (typeof TIME_PRESETS)[number];

/** Desktop MenuAnimate, lower-cased (`SLIDE_IN_LEFT` → `slide_in_left`). */
export const ANIMATE_PRESETS = [
  "none",
  // In
  "slide_in_left", "slide_in_right", "slide_in_top", "slide_in_bottom",
  "blur_in",
  "wipe_in_circle_expand", "wipe_in_circle_shrink", "wipe_in_fade",
  "wipe_in_left", "wipe_in_right", "wipe_in_top", "wipe_in_bottom",
  "blur_wipe_in_circle_expand", "blur_wipe_in_circle_shrink",
  "blur_wipe_in_left", "blur_wipe_in_right", "blur_wipe_in_top", "blur_wipe_in_bottom",
  "pop_in", "spiral_in",
  "back_in_down", "back_in_left", "back_in_right", "back_in_up",
  "bounce_in", "bounce_in_down", "bounce_in_left", "bounce_in_right", "bounce_in_up",
  // Out
  "slide_out_left", "slide_out_right", "slide_out_top", "slide_out_bottom",
  "blur_out",
  "wipe_out_circle_expand", "wipe_out_circle_shrink", "wipe_out_fade",
  "wipe_out_left", "wipe_out_right", "wipe_out_top", "wipe_out_bottom",
  "blur_wipe_out_circle_expand", "blur_wipe_out_circle_shrink",
  "blur_wipe_out_left", "blur_wipe_out_right", "blur_wipe_out_top", "blur_wipe_out_bottom",
  "pop_out", "spiral_out",
  "back_out_down", "back_out_left", "back_out_right", "back_out_up",
  "bounce_out", "bounce_out_down", "bounce_out_left", "bounce_out_right", "bounce_out_up",
  // Emphasis
  "bounce", "flash", "pulse", "rubber_band", "shake_x", "shake_y", "swing", "tada", "wobble", "jello", "heart_beat",
  // Camera
  "cam_push_in", "cam_pull_out",
  "cam_pan_auto", "cam_pan_left", "cam_pan_right", "cam_pan_up", "cam_pan_down",
  "ken_burns_in", "ken_burns_out",
  "ken_burns_in_left_to_right", "ken_burns_in_right_to_left", "ken_burns_in_top_to_bottom", "ken_burns_in_bottom_to_top",
  "ken_burns_out_left_to_right", "ken_burns_out_right_to_left", "ken_burns_out_top_to_bottom", "ken_burns_out_bottom_to_top",
  // Credits
  "credits_up", "credits_down",
] as const;
export type AnimatePreset = (typeof ANIMATE_PRESETS)[number];

export type ClipPresetId =
  | `fade.${FadePreset}`
  | `rotate.${RotatePreset}`
  | `layout.${LayoutPreset}`
  | `volume.${VolumePreset}`
  | `time.${TimePreset}`
  | `animate.${AnimatePreset}`;

/** Every preset id, for tool schemas and menus. */
export const CLIP_PRESET_IDS: readonly ClipPresetId[] = [
  ...FADE_PRESETS.map((p) => `fade.${p}` as const),
  ...ROTATE_PRESETS.map((p) => `rotate.${p}` as const),
  ...LAYOUT_PRESETS.map((p) => `layout.${p}` as const),
  ...VOLUME_PRESETS.map((p) => `volume.${p}` as const),
  ...TIME_PRESETS.map((p) => `time.${p}` as const),
  ...ANIMATE_PRESETS.map((p) => `animate.${p}` as const),
];

export function isClipPresetId(value: string): value is ClipPresetId {
  return (CLIP_PRESET_IDS as readonly string[]).includes(value);
}

/** Desktop menus' "Entire Clip" / "Start of Clip" / "End of Clip". */
export type PresetRange = "entire" | "start" | "end";

export interface ClipPresetOptions {
  /** Which part of the clip a fade / volume / rotate preset covers. Default `entire`. */
  range?: PresetRange;
  /** `volume.level`: linear gain (desktop menu offers 0..1.3). */
  level?: number;
  /** `time.forward` / `time.backward`: speed factor (2 = 2x faster, 0.5 = 2x slower). */
  speed?: number;
  /** `time.freeze*`: freeze length, seconds. */
  seconds?: number;
  /** `time.freeze*`: timeline seconds of the frame to freeze. Default the clip start. */
  playhead?: number;
}

/**
 * Apply one clip context-menu preset. Returns the updated clip. Presets that
 * produce no change (e.g. `rotate.none` on an unrotated clip) record nothing.
 */
export function applyClipPreset(
  tx: Transaction,
  clipId: string,
  presetId: ClipPresetId,
  opts: ClipPresetOptions = {},
): Clip {
  void tx;
  void clipId;
  void presetId;
  void opts;
  throw new OpError("unsupported", `not implemented: applyClipPreset`);
}

/**
 * Arrange several clips in a grid so all are visible at once (desktop Layout
 * ▸ Show All, `show_all_clips`). `stretch` fills each cell (Distort) instead
 * of keeping the aspect ratio.
 */
export function layoutShowAll(tx: Transaction, clipIds: readonly string[], opts: { stretch?: boolean } = {}): Clip[] {
  void tx;
  void clipIds;
  void opts;
  throw new OpError("unsupported", "not implemented: layoutShowAll");
}
