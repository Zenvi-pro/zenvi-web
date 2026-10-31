/**
 * Hand-written cases for the tools whose own arguments (not an effect's or a
 * clip's property table) change the picture: grades, looks, keys, masks,
 * speed, titles, overlays and transitions.
 */

import type { TruthCase } from "../harness.js";
import { A, aliases, B, CUT, down, param, up, type ToolSpec } from "./define.js";

const grade: ToolSpec = { tool: "color_grade_clip_tool", args: { timeline_clip_id: A }, needsChange: true };
const ramp = [{ fixture: "ramp.mp4" as const, id: "A" }];
const DISC = [{ fixture: "disc.png" as const, id: "A" }];
/** The disc over another shot: a black shadow shows on it. */
const DISC_OVER = [
  { fixture: "rings.mp4" as const, id: "B", track: 1 },
  { fixture: "disc.png" as const, id: "A", track: 2 },
];
const color: ToolSpec = { tool: "apply_color_tool", args: { clipId: A }, needsChange: true };
const LUT = "@colors/cinematic_&_blockbuster/teal_&_orange_cinema.cube";
const look: ToolSpec = { tool: "apply_look_tool", args: { clipId: A } };
const preset: ToolSpec = { tool: "apply_look_preset_tool", args: { timeline_clip_id: A } };
const key: ToolSpec = { tool: "chroma_key_clip_tool", args: { timeline_clip_id: A }, clips: [{ fixture: "green.mp4", id: "A" }] };
const keyOver: ToolSpec = {
  tool: "chroma_key_clip_tool",
  args: { timeline_clip_id: A, background_clip_id: B },
  clips: [
    { fixture: "rings.mp4", id: "B", track: 1 },
    { fixture: "green.mp4", id: "A", track: 2 },
  ],
};
const vignette: ToolSpec = { tool: "add_vignette_tool", args: { clip_ids: [A] } };
const mask: ToolSpec = { tool: "add_shape_mask_tool", args: { clip_ids: [A] } };
const speed: ToolSpec = { tool: "set_clip_speed_tool", args: { timeline_clip_ids: [A], allow_overlap: true }, needsChange: true };
const fade: ToolSpec = { tool: "fade_clip_tool", args: { clip_id: A }, probe: { kind: "picture", at: 0.1 }, needsChange: true };
const title: ToolSpec = { tool: "add_title_tool", args: { text: "TRUTH", template: "Standard_1", duration_seconds: 1 }, clips: [] };
const emoji: ToolSpec = { tool: "add_emoji_tool", args: { emoji: "fire", duration_seconds: 1 }, clips: [] };
// On black with an opaque blue box (the default box is translucent black, invisible on black).
const timer: ToolSpec = { tool: "add_timer_tool", args: { duration_seconds: 1, mode: "count_up", background_color: "#3050ff", background_opacity: 1 }, clips: [] };
const kinetic: ToolSpec = { tool: "add_kinetic_title_tool", args: { text: "make it real", duration_seconds: 1 }, clips: [], probe: { kind: "picture", at: 0.9 } };
const transitionBetween: ToolSpec = { tool: "apply_transition_tool", args: { clip1_id: A, clip2_id: B, duration: "0.6" }, clips: CUT, probe: { kind: "picture", at: 0.7 } };
const transition: ToolSpec = { tool: "add_transition_tool", args: { track: "1", position_seconds: 0.7, duration_seconds: 0.6, transition: "common/fade" }, clips: CUT, probe: { kind: "picture", at: 0.9 } };

export const PICTURE_TOOL_CASES: readonly TruthCase[] = [
  // color_grade_clip_tool: every control of the grade.
  param(grade, "exposure", 1, { expect: [up("luma")] }),
  param(grade, "contrast", 0.8, { expect: [up("contrast")] }),
  param(grade, "highlights", -0.8, { expect: [down("luma")] }),
  param(grade, "shadows", 0.8, { expect: [up("luma")] }),
  param(grade, "saturation", 0, { expect: [down("saturation")] }),
  param(grade, "vibrance", 0.9, { clips: ramp, expect: [up("saturation")] }),
  param(grade, "temperature", 0.8, { clips: ramp, expect: [up("red"), down("blue")] }),
  param(grade, "tint", 0.8, { clips: ramp, expect: [down("green")] }),
  param(grade, "mix", 0.2, { with: { exposure: 1.5 }, expect: [down("luma")] }),
  param(grade, "lut", "teal & orange cinema", { clips: ramp }),
  param(grade, "lut_intensity", 0.2, { with: { lut: "teal & orange cinema" }, clips: ramp }),
  param(grade, "look", "black_and_white", { expect: [down("saturation")] }),
  param(grade, "reset", true, { setup: [{ tool: "color_grade_clip_tool", args: { timeline_clip_id: A, exposure: 1 } }], expect: [down("luma")] }),
  param(grade, "curves", { all: [[0, 0], [0.25, 0.1], [0.75, 0.9], [1, 1]] }, { clips: ramp, expect: [up("contrast")] }),
  param(grade, "curves", { red: [[0, 0], [0.5, 0.8], [1, 1]] }, { clips: ramp, label: "red", expect: [up("red")] }),
  param(grade, "wheels", { shadows: { color: "#2a6cff", amount: 0.8 } }, { clips: ramp, label: "shadows", expect: [up("blue")] }),
  param(grade, "wheels", { highlights: { color: "#ff8a2a", amount: 0.8 } }, { clips: ramp, label: "highlights", expect: [up("red")] }),
  param(grade, "wheels", { midtones: { color: "#ff2a2a", amount: 0.8 } }, { clips: ramp, label: "midtones", expect: [up("red")] }),
  param(grade, "wheels", { global: { color: "#2aff2a", amount: 0.8 } }, { clips: ramp, label: "global", expect: [up("green")] }),
  param(grade, "wheels", { midtones: { luma: 0.6 } }, { clips: ramp, label: "luma", expect: [up("luma")] }),

  // apply_color_tool: the Assistant's grade tool, string arguments like the backend sends.
  param(color, "exposure", "1", { expect: [up("luma")] }),
  param(color, "contrast", "0.8", { expect: [up("contrast")] }),
  param(color, "saturation", "0.6", { expect: [down("saturation")] }),
  param(color, "vibrance", "0.9", { clips: ramp, expect: [up("saturation")] }),
  param(color, "temperature", "0.8", { clips: ramp, expect: [up("red")] }),
  param(color, "tint", "0.8", { clips: ramp, expect: [down("green")] }),
  param(color, "highlights", "-0.8", { expect: [down("luma")] }),
  param(color, "shadows", "0.8", { expect: [up("luma")] }),
  param(color, "mix", "0.2", { with: { exposure: "1.5" }, expect: [down("luma")] }),
  param(color, "temperature_delta", "0.8", { clips: ramp, expect: [up("red")] }),
  param(color, "tint_delta", "0.8", { clips: ramp, expect: [down("green")] }),
  param(color, "exposure_delta", "1", { expect: [up("luma")] }),
  param(color, "vibrance_delta", "0.9", { clips: ramp, expect: [up("saturation")] }),
  param(color, "lut", JSON.stringify({ path: LUT }), { clips: ramp }),
  param(color, "lut_path", LUT, { clips: ramp }),
  param(color, "lut_intensity", "0.2", { with: { lut_path: LUT }, clips: ramp }),
  param(color, "wheels", JSON.stringify({ shadows: { color: "#2a6cff", amount: 0.8 } }), { clips: ramp, expect: [up("blue")] }),
  ...aliases(color, ["curve_all", "masterCurve"], JSON.stringify([[0, 0], [0.25, 0.1], [0.75, 0.9], [1, 1]]), { clips: ramp, expect: [up("contrast")] }),
  ...aliases(color, ["curve_red", "redCurve"], JSON.stringify([[0, 0], [0.5, 0.8], [1, 1]]), { clips: ramp, expect: [up("red")] }),
  ...aliases(color, ["curve_green", "greenCurve"], JSON.stringify([[0, 0], [0.5, 0.8], [1, 1]]), { clips: ramp, expect: [up("green")] }),
  ...aliases(color, ["curve_blue", "blueCurve"], JSON.stringify([[0, 0], [0.5, 0.8], [1, 1]]), { clips: ramp, expect: [up("blue")] }),
  param(color, "color", JSON.stringify({ exposure: 1 }), { expect: [up("luma")] }),
  param(color, "reset", "true", { setup: [{ tool: "apply_color_tool", args: { clipId: A, exposure: "1" } }], expect: [down("luma")] }),

  // apply_look_tool / apply_look_preset_tool.
  ...aliases(look, ["lookId", "look_id"], "bleach_bypass", { baseIsUncalled: true }),
  ...aliases(look, ["lutPath", "lut_path"], LUT, { clips: ramp, baseIsUncalled: true }),
  ...aliases(look, ["lutIntensity", "lut_intensity"], "0.2", { with: { lutPath: LUT }, clips: ramp }),
  param(look, "mix", "0.2", { with: { lookId: "bleach_bypass" } }),
  ...aliases(look, ["stackGrain", "stack_grain"], "true", { with: { lookId: "bleach_bypass" } }),
  ...aliases(look, ["grainPreset", "grain_preset"], "35mm_classic", { with: { lookId: "bleach_bypass" } }),
  param(preset, "look", "color_boost_color", { baseIsUncalled: true, label: "color_boost_color", expect: [up("saturation")] }),
  param(preset, "look", "film_grain_35mm_classic", { baseIsUncalled: true, label: "film_grain" }),
  param(preset, "look", "analog_tape_vhs", { baseIsUncalled: true, label: "analog_tape" }),
  param(preset, "look", "sharpen_strong", { baseIsUncalled: true, label: "sharpen", expect: [up("sharpness")] }),
  param(preset, "look", "blur_heavy", { baseIsUncalled: true, label: "blur", expect: [down("sharpness")] }),
  param(preset, "look", "glow_warm", { baseIsUncalled: true, label: "glow", clips: DISC, expect: [up("luma")] }),
  param(preset, "look", "shadow_strong", { baseIsUncalled: true, label: "shadow", clips: DISC_OVER }),

  // chroma_key_clip_tool: keying takes the green out; each control moves the matte.
  param(key, "key_color", "green", { baseIsUncalled: true, expect: [down("green")] }),
  param(key, "fuzz", 120, { with: { key_color: "green" } }),
  param(key, "halo", 120, { with: { key_color: "green" } }),
  param(key, "method", "hsv_hue", { with: { key_color: "green", fuzz: 8 }, base: "basic" }),
  param(key, "key_color", "#ff0000", { with: { fuzz: 60 }, base: "green", label: "#ff0000" }),
  param(keyOver, "background_clip_id", B, { baseIsUncalled: true, expect: [down("green")] }),

  // Vignette and shape masks.
  param(vignette, "amount", 0.9, { with: { amount: 0.4 }, base: 0.4, expect: [down("luma")] }),
  param(vignette, "feather", 1, { with: { amount: 0.6 }, base: 0.5, expect: [down("luma")] }),
  param(mask, "shape", "ellipse", { expect: [down("coverage")] }),
  param(mask, "x", 0.25, { with: { width: 0.4, height: 0.4 }, expect: [down("centroid_x")] }),
  param(mask, "y", 0.25, { with: { width: 0.4, height: 0.4 }, expect: [down("centroid_y")] }),
  param(mask, "width", 0.3, { expect: [down("coverage")] }),
  param(mask, "height", 0.3, { expect: [down("coverage")] }),
  param(mask, "feather", 0.5, { with: { width: 0.4, height: 0.4 } }),
  param(mask, "outside", true, { with: { width: 0.4, height: 0.4 } }),
  param(mask, "keyframes", [{ seconds: 0, grow: -0.5 }, { seconds: 1, grow: 0 }], { with: { width: 0.6, height: 0.6 }, expect: [down("coverage")] }),
  param(mask, "remove", true, { setup: [{ tool: "add_shape_mask_tool", args: { clip_ids: [A], width: 0.3, height: 0.3 } }], expect: [up("coverage")] }),

  // Speed and direction change which source frame shows at 0.5 s.
  param(speed, "speed", 0.5),
  param(speed, "factor", 0.5),
  // A reversed 1 s clip shows frame 15 at 0.5 s either way: probe off-centre.
  param(speed, "reverse", true, { probe: { kind: "picture", at: 0.2 } }),
  param(speed, "direction", "backward", { probe: { kind: "picture", at: 0.2 } }),
  param(speed, "target_duration_seconds", 2),
  param(speed, "absolute", true, { with: { speed: 2 }, setup: [{ tool: "set_clip_speed_tool", args: { timeline_clip_ids: [A], speed: 0.5, allow_overlap: true } }] }),
  param(speed, "reset", true, { setup: [{ tool: "set_clip_speed_tool", args: { timeline_clip_ids: [A], speed: 0.5, allow_overlap: true } }] }),
  param({ tool: "reverse_clip_tool", args: { timeline_clip_id: A }, probe: { kind: "picture", at: 0.2 } }, "mode", "reverse", { baseIsUncalled: true }),

  // Fades: the first frames are darker with a fade-in.
  param(fade, "fade_in_seconds", 0.5, { expect: [down("luma")] }),
  param({ ...fade, probe: { kind: "picture", at: 0.9 } }, "fade_out_seconds", 0.5, { expect: [down("luma")] }),
  param(fade, "video", false, { with: { fade_in_seconds: 0.5 }, base: true, expect: [up("luma")] }),

  // Titles over black.
  param(title, "text", "WIDE TRUTH TEXT", { base: "I" }),
  param(title, "template", "Gray_Box_4"),
  param(title, "text_color", "#ff0000", { expect: [up("red")] }),
  param(title, "background_color", "#00ff00", { expect: [up("green")] }),
  param(title, "font_scale", 2, { expect: [up("coverage")] }),
  param(title, "font_weight", "normal", { expect: [down("coverage")] }),
  param(title, "font_style", "italic"),
  param(title, "font", "Instrument Serif"),
  param(title, "subtitle", "and a second line", { with: { template: "Standard_4" } }),
  param(title, "lines", ["FIRST", "SECOND LINE"], { with: { template: "Standard_4" } }),
  param(title, "fade_in_seconds", 1, { expect: [down("luma")] }),
  param({ ...title, probe: { kind: "picture", at: 0.9 } }, "fade_out_seconds", 1, { expect: [down("luma")] }),
  param(title, "position_seconds", 0.8, { expect: [down("coverage")] }),
  param(title, "duration_seconds", 0.3, { expect: [down("coverage")] }),
  param(title, "fit_text", false, { with: { text: "A VERY VERY LONG TITLE THAT RUNS OFF THE FRAME", font_scale: 3 } }),

  // Emoji and timer overlays.
  param(emoji, "emoji", "blue heart", { expect: [up("blue")] }),
  param(emoji, "size", 0.6, { expect: [up("coverage")] }),
  param(emoji, "screen_position", "top_left", { expect: [down("centroid_x"), down("centroid_y")] }),
  param(emoji, "margin", 0.3, { with: { screen_position: "top_left" }, expect: [up("centroid_x")] }),
  param(emoji, "position_seconds", 0.8, { expect: [down("coverage")] }),
  param(emoji, "duration_seconds", 0.3, { expect: [down("coverage")] }),
  param(timer, "text_size", 0.3, { expect: [up("coverage")] }),
  param(timer, "text_color", "#ff0000", { expect: [down("green")] }),
  param(timer, "background", false, { expect: [down("coverage")] }),
  param(timer, "background_color", "#ff0000", { expect: [up("red"), down("blue")] }),
  param(timer, "background_opacity", 0.2, { expect: [down("blue")] }),
  param(timer, "screen_position", "top_left", { expect: [down("centroid_y")] }),
  param(timer, "margin_percent", 30, { expect: [down("centroid_y")] }),
  param(timer, "format", "hh:mm:ss", { expect: [up("width")] }),
  param(timer, "mode", "count_down", { with: { countdown_from_seconds: 99 }, base: "count_up" }),
  param(timer, "countdown_from_seconds", 500, { with: { mode: "count_down" }, base: 99 }),
  param(timer, "start_at_seconds", 4000),
  param(timer, "prefix", "T- ", { expect: [up("width")] }),
  param(timer, "suffix", " left", { expect: [up("width")] }),
  param(timer, "stroke_color", "#ff0000", { with: { stroke_width: 0.2, background: false }, expect: [up("red")] }),
  param(timer, "stroke_width", 0.3, { with: { background: false, stroke_color: "#ff0000" }, base: 0.03, expect: [up("red")] }),
  param(timer, "font", "Instrument Serif"),
  param(timer, "position_seconds", 0.8, { expect: [down("coverage")] }),
  param(timer, "duration_seconds", 0.3, { with: { duration_seconds: undefined }, base: 1, expect: [down("coverage")] }),

  // Kinetic titles.
  param(kinetic, "text", "a much longer kinetic line", { expect: [up("coverage")] }),
  param(kinetic, "style", "creator"),
  param(kinetic, "animation", "fade", { probe: { kind: "picture", at: 0.1 } }),
  param(kinetic, "stagger_seconds", 0.6, { probe: { kind: "picture", at: 0.4 } }),
  param(kinetic, "emphasis", ["real"], { with: { accent: "#00ff00" }, base: "none", expect: [up("green")] }),
  param(kinetic, "accent", "#00ff00", { with: { emphasis: ["real"] }, expect: [up("green")] }),
  param(kinetic, "ink", "#00ff00", { expect: [down("red")] }),
  param(kinetic, "background", "#0000ff", { expect: [up("blue")] }),
  param(kinetic, "text_size", 0.3, { expect: [up("coverage")] }),
  param(kinetic, "y", 0.15, { expect: [down("centroid_y")] }),
  param(kinetic, "avoid", [{ x: 0.5, y: 0.5, w: 1, h: 0.5 }]),
  param(kinetic, "position_seconds", 0.8, { probe: { kind: "picture", at: 0.5 }, expect: [down("coverage")] }),
  param(kinetic, "duration_seconds", 0.4, { expect: [down("coverage")] }),

  // Transitions at the cut.
  param(transitionBetween, "transition_name", "wipe left", { base: "fade" }),
  param(transitionBetween, "duration", "0.2"),
  param(transitionBetween, "placement", "start", { with: { clip2_id: undefined }, base: "end", probe: { kind: "picture", at: 0.1 } }),
  param(transition, "transition", "wipe left to right", { base: "common/fade" }),
  param(transition, "duration_seconds", 0.2, { probe: { kind: "picture", at: 1.1 } }),
  param(transition, "position_seconds", 0.4),
  param(transition, "direction", "out", { base: "in" }),
];
