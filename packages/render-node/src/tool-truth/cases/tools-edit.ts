/**
 * Hand-written cases for the editing tools: where clips sit and which
 * source frames they show, keyframes, transitions after the fact, presets,
 * captions and motion transitions. Each changes which pixels the probed
 * frame shows.
 */

import type { TruthCase, TruthClip } from "../harness.js";
import { A, B, BARS, CUT, down, param, SOUND, up, type ToolSpec } from "./define.js";

const at = (seconds: number) => ({ kind: "picture" as const, at: seconds });
const LONG: TruthClip[] = [{ fixture: "bars.mp4", id: "A", position: 0.5 }];
const fadeBetween = { tool: "apply_transition_tool", args: { clip1_id: A, clip2_id: B, duration: "0.6" } };

const move: ToolSpec = { tool: "move_clip_tool", args: { clip_id: A }, clips: LONG, probe: at(0.3), needsChange: true };
const moves: ToolSpec = { tool: "move_clips_tool", args: { timeline_clip_ids: [A], allow_overlap: true }, clips: LONG, probe: at(0.3), needsChange: true };
const trim: ToolSpec = { tool: "trim_clip_tool", args: { clip_id: A }, probe: at(0.8), needsChange: true };
const trims: ToolSpec = { tool: "trim_clips_tool", args: { timeline_clip_ids: [A] }, probe: at(0.8), needsChange: true };
const split: ToolSpec = { tool: "split_clip_tool", args: { clip_id: A, at_seconds: 0.5 }, probe: at(0.7) };
const slice: ToolSpec = { tool: "slice_clips_tool", args: { timeline_clip_ids: [A], at_seconds: 0.5 }, probe: at(0.7) };
const keys: ToolSpec = { tool: "set_keyframes_tool", args: { timeline_clip_id: A, property: "alpha" }, needsChange: true };
const prop: ToolSpec = { tool: "set_clip_property_tool", args: { clip_id: A, property: "alpha" }, needsChange: true };
const effectProp: ToolSpec = {
  tool: "set_effect_property_tool",
  args: { effect_id: "@effect:Brightness", property: "brightness" },
  setup: [{ tool: "add_effect_tool", args: { timeline_clip_id: A, effect: "Brightness" } }],
  needsChange: true,
};
const updateEffect: ToolSpec = { tool: "update_effect_tool", args: { timeline_clip_id: A, effect: "Brightness" }, setup: [{ tool: "add_effect_tool", args: { timeline_clip_id: A, effect: "Brightness" } }], needsChange: true };
const props: ToolSpec = { tool: "set_clip_properties_tool", args: { timeline_clip_ids: [A] } };
const updateTransition: ToolSpec = { tool: "update_transition_tool", args: { between_clip_ids: [A, B] }, clips: CUT, setup: [fadeBetween], probe: at(0.6), needsChange: true };
const preset: ToolSpec = { tool: "apply_clip_preset_tool", args: { timeline_clip_ids: [A] }, probe: at(0.2) };
const freeze: ToolSpec = { tool: "freeze_frame_tool", args: { timeline_clip_id: A, allow_overlap: true, at_seconds: 0.2 }, probe: at(0.6) };
const ramp: ToolSpec = { tool: "speed_ramp_tool", args: { clip_id: A, allow_overlap: true }, probe: at(0.3) };
// Frame 28: mid-whip. (At frame 30 a whip's Shift is ±0.5, the same picture either way: Shift wraps.)
const motion: ToolSpec = { tool: "apply_motion_transition_tool", args: { clip1_id: A, clip2_id: B }, clips: CUT, probe: at(0.92) };
const motions: ToolSpec = { tool: "apply_motion_transitions_tool", args: { track: "1" }, clips: CUT, probe: at(0.92) };
const captions: ToolSpec = { tool: "add_captions_tool", args: { cues: [{ start: 0, end: 1, text: "tool truth" }] }, clips: [], probe: at(0.5) };
const editTitle: ToolSpec = {
  tool: "edit_title_tool",
  args: { title_query: "TRUTH" },
  clips: [],
  setup: [{ tool: "add_title_tool", args: { text: "TRUTH", template: "Standard_1", duration_seconds: 1 } }],
  needsChange: true,
};
const effectsGone: ToolSpec = { tool: "remove_effect_tool", args: { timeline_clip_id: A }, setup: [{ tool: "add_effect_tool", args: { timeline_clip_id: A, effect: "Negate" } }] };

export const EDIT_TOOL_CASES: readonly TruthCase[] = [
  // Placement and trims: the probed time shows another source frame, or nothing.
  param(move, "position_seconds", 0, { expect: [up("coverage")] }),
  param(move, "track", "2", { clips: [{ fixture: "rings.mp4", id: "B", track: 2 }, { fixture: "bars.mp4", id: "A", track: 1 }], probe: at(0.5), label: "over" }),
  param(moves, "position_seconds", 0, { expect: [up("coverage")] }),
  param(moves, "by_seconds", -0.5, { expect: [up("coverage")] }),
  param(moves, "by_frames", -15, { expect: [up("coverage")] }),
  param(trim, "end_seconds", 0.5, { expect: [down("coverage")] }),
  param(trim, "start_seconds", 0.5, { probe: at(0.2) }),
  param(trims, "trim_end_seconds", 0.5, { expect: [down("coverage")] }),
  param(trims, "trim_start_seconds", 0.5, { probe: at(0.2) }),
  param(trims, "duration_seconds", 0.5, { expect: [down("coverage")] }),
  param(trims, "source_start", 0.5, { probe: at(0.2) }),
  param(trims, "source_end", 0.5, { expect: [down("coverage")] }),
  param(split, "keep", "left", { base: "both", expect: [down("coverage")] }),
  param(slice, "keep", "left", { base: "both", expect: [down("coverage")] }),
  param({ tool: "delete_from_timeline_tool", args: { timeline_clip_id: A } }, "timeline_clip_id", A, { baseIsUncalled: true, expect: [down("coverage")], label: "deletes" }),

  // Keyframes.
  param(keys, "points", [{ seconds: 0, value: 1 }, { seconds: 1, value: 0 }], { expect: [down("luma")] }),
  param(keys, "property", "scale_x", { with: { points: [{ seconds: 0, value: 0.3 }] }, base: "scale_y", label: "scale_x", expect: [down("width")] }),
  param(keys, "interpolation", "constant", { with: { points: [{ seconds: 0, value: 1 }, { seconds: 1, value: 0 }] } }),
  param(keys, "ease", "ease_in", { with: { points: [{ seconds: 0, value: 1 }, { seconds: 1, value: 0 }] } }),
  param(keys, "mode", "merge", {
    with: { points: [{ seconds: 1, value: 0 }] },
    setup: [{ tool: "set_keyframes_tool", args: { timeline_clip_id: A, property: "alpha", points: [{ seconds: 0, value: 0.2 }] } }],
    base: "replace",
  }),
  param(prop, "value", 0.3, { expect: [down("luma")] }),
  param(prop, "property", "scale_x", { with: { value: 0.3 }, base: "scale_y", label: "scale_x", expect: [down("width")] }),
  param(prop, "at_seconds", 0.9, { with: { value: 0 }, expect: [up("luma")] }),
  param(prop, "frame", 28, { with: { value: 0 }, expect: [up("luma")] }),
  param(props, "at_seconds", 0.9, { with: { properties: { alpha: 0 } }, expect: [up("luma")] }),
  param(effectProp, "value", 0.5, { expect: [up("luma")] }),
  param(effectProp, "at_seconds", 0.9, { with: { value: 0.8 }, setup: [{ tool: "set_effect_property_tool", args: { effect_id: "@effect:Brightness", property: "brightness", value: -0.5, frame: 1 } }] }),
  param(effectProp, "frame", 28, { with: { value: 0.8 }, setup: [{ tool: "set_effect_property_tool", args: { effect_id: "@effect:Brightness", property: "brightness", value: -0.5, frame: 1 } }] }),
  param(effectProp, "property", "contrast", { with: { value: 60 }, base: "brightness", label: "contrast" }),
  param(updateEffect, "properties", { brightness: 0.5 }, { expect: [up("luma")] }),

  // Transitions after the fact.
  param(updateTransition, "mask", "wipe_left_to_right"),
  param(updateTransition, "duration_seconds", 0.2),
  param(updateTransition, "position_seconds", 0.2, { with: { keep_overlap: true }, baseIsUncalled: true }),
  param(updateTransition, "interpolation", "constant"),
  param(updateTransition, "contrast", 20, { with: { mask: "wipe_left_to_right" }, base: 3 }),
  param(updateTransition, "flip_wipe_side", true, { with: { mask: "wipe_left_to_right" }, base: false }),
  param(updateTransition, "invert_mask", true, { with: { mask: "wipe_left_to_right" }, base: false }),
  param(updateTransition, "replace_image", true, { with: { mask: "wipe_left_to_right" }, base: false }),
  param(updateTransition, "brightness_keyframes", [{ seconds: 0, value: 1 }, { seconds: 0.6, value: 1 }]),
  param({ ...updateTransition, probe: SOUND }, "audio_crossfade", true, { with: { mask: "fade" }, base: false }),
  param({ tool: "remove_transition_tool", args: { between_clip_ids: [A, B] }, clips: CUT, setup: [fadeBetween], probe: at(0.6) }, "between_clip_ids", [A, B], { baseIsUncalled: true, label: "removes" }),
  param({ tool: "reverse_transition_tool", args: { between_clip_ids: [A, B] }, clips: CUT, setup: [{ tool: "apply_transition_tool", args: { clip1_id: A, clip2_id: B, duration: "0.6", transition_name: "wipe left" } }], probe: at(0.6) }, "between_clip_ids", [A, B], { baseIsUncalled: true, label: "reverses" }),
  param({ tool: "add_transitions_between_clips_tool", args: { timeline_clip_ids: [A, B] }, clips: CUT, probe: at(0.8) }, "transition", "wipe left to right", { base: "fade" }),
  param({ tool: "add_transitions_between_clips_tool", args: { timeline_clip_ids: [A, B] }, clips: CUT, probe: at(0.8) }, "duration_seconds", 0.2, { base: 0.6 }),

  // Clip-menu presets (Clip > Fade, Animate, Rotate, Volume).
  param(preset, "preset", "fade_in", { base: "fade_none", expect: [down("luma")] }),
  param(preset, "duration_seconds", 0.25, { with: { preset: "fade_in" }, base: 1, expect: [up("luma")] }),
  param({ ...preset, probe: SOUND }, "level_percent", 20, { with: { preset: "volume_level" }, base: 100, expect: [down("rms")] }),
  param({ ...preset, probe: at(0.5) }, "at_seconds", 0.45, { with: { preset: "pulse" }, base: 0.9 }),

  // Freeze frame and speed ramps change which source frame shows.
  param(freeze, "hold_seconds", 0.8, { base: 0.1 }),
  param(freeze, "at_seconds", 0.05, { with: { hold_seconds: 0.8 }, base: 0.2 }),
  param(freeze, "frame", "first", { with: { hold_seconds: 0.8 }, base: "last" }),
  param(freeze, "zoom", true, { with: { hold_seconds: 0.8 }, base: false }),
  param(ramp, "preset", "ramp_out", { base: "ramp_in" }),
  param(ramp, "slow", 0.1, { with: { preset: "ramp_in" }, base: 0.5 }),
  param(ramp, "fast", 3, { with: { preset: "velocity" }, base: 1.5 }),
  param(ramp, "ramp_seconds", 0.2, { with: { preset: "ramp_in" }, base: 0.9 }),
  param(ramp, "hold_seconds", 0.6, { with: { preset: "hero" }, base: 0.1 }),
  param(ramp, "hit_at", 0.3, { with: { preset: "hero", ramp_seconds: 0.1, hold_seconds: 0.1 }, base: 0.7 }),
  param(ramp, "ease", "linear", { with: { preset: "ramp_in" }, base: "smooth" }),
  param(ramp, "points", [{ at_seconds_in_clip: 0, speed: 0.2 }, { at_seconds_in_clip: 0.5, speed: 3 }], { with: { preset: "custom" }, base: [{ at_seconds_in_clip: 0, speed: 1 }, { at_seconds_in_clip: 0.5, speed: 2 }], probe: at(0.1) }),
  param({ ...ramp, probe: SOUND, clips: BARS }, "audio", "keep", { with: { preset: "ramp_in" }, base: "mute", expect: [up("rms")] }),

  // Motion transitions over the cut.
  param(motion, "preset", "zoom_in", { base: "whip" }),
  param(motion, "direction", "right", { with: { preset: "whip" }, base: "left" }),
  param(motion, "duration", 0.6, { with: { preset: "whip" }, base: 0.1, probe: at(0.85) }),
  param(motion, "intensity", 2, { with: { preset: "whip" }, base: 0.5 }),
  param(motion, "focus_x", 0.1, { with: { preset: "zoom_through" }, base: 0.9 }),
  param(motion, "focus_y", 0.1, { with: { preset: "zoom_through" }, base: 0.9 }),
  param(motions, "preset", "zoom_in", { base: "whip" }),
  param(motions, "direction", "right", { with: { preset: "whip" }, base: "left" }),
  param(motions, "duration", 0.6, { with: { preset: "whip" }, base: 0.1, probe: at(0.85) }),
  param(motions, "intensity", 2, { with: { preset: "whip" }, base: 0.5 }),
  param(motions, "style", "cinematic", { base: "hype" }),

  // Burned-in captions from cues.
  param(captions, "text_color", "#ff0000", { expect: [down("green")] }),
  param(captions, "text_size", 0.15, { expect: [up("coverage")] }),
  param(captions, "position", "top", { expect: [down("centroid_y")] }),
  param(captions, "style", "reels"),
  param(captions, "uppercase", true),
  param(captions, "font", "Instrument Serif"),
  param(captions, "background_color", "#0000ff", { with: { background_opacity: 1 }, expect: [up("blue")] }),
  param(captions, "background_opacity", 1, { with: { background_color: "#0000ff" }, base: 0, expect: [up("blue")] }),
  param(captions, "stroke_color", "#ff0000", { with: { stroke_width: 0.09 }, expect: [up("red")] }),
  param(captions, "stroke_width", 0.09, { with: { stroke_color: "#ff0000" }, base: 0, expect: [up("red")] }),
  param({ ...captions, probe: at(0.05) }, "fade_seconds", 1, { base: 0, expect: [down("luma")] }),
  param(captions, "cues", [{ start: 0, end: 1, text: "a much longer caption line" }], { expect: [up("coverage")] }),

  // Editing a title in place.
  param(editTitle, "text", "CHANGED TITLE"),
  param(editTitle, "text_color", "#ff0000", { expect: [up("red")] }),
  param(editTitle, "background_color", "#00ff00", { expect: [up("green")] }),
  param(editTitle, "font_scale", 2, { expect: [up("coverage")] }),
  param(editTitle, "font_weight", "normal", { expect: [down("coverage")] }),
  param(editTitle, "font_style", "italic"),
  param(editTitle, "font", "Instrument Serif"),

  // Removing what earlier calls added.
  param(effectsGone, "effect", "Negate", { baseIsUncalled: true }),
  param(effectsGone, "all_effects", true, { baseIsUncalled: true }),
];
