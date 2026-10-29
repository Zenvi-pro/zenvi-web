/**
 * Hand-written cases for the motion-design templates, script-timed kinetic
 * captions, placing media on the timeline, duplicating and repeating clips,
 * caption edits and the project's own frame settings.
 */

import type { TruthCase, TruthClip } from "../harness.js";
import { A, BARS, down, param, SOUND, up, type ToolSpec } from "./define.js";

const at = (seconds: number) => ({ kind: "picture" as const, at: seconds });
const NOTHING: TruthClip[] = [];

const template: ToolSpec = { tool: "add_motion_template_tool", args: { duration_seconds: 1, bpm: 240 }, clips: NOTHING, probe: at(0.9) };
const kineticType: ToolSpec = { ...template, args: { ...template.args, template: "kinetic_type", text: "make it truth" } };
const endCard: ToolSpec = { ...template, args: { ...template.args, template: "end_card", text: "TOOL TRUTH" } };
const scroll: ToolSpec = { ...template, args: { ...template.args, template: "word_scroll", words: ["one", "two", "three"] } };
const grid: ToolSpec = {
  ...template,
  args: { ...template.args, template: "grid", file_ids: ["@file:bars.mp4", "@file:rings.mp4", "@file:ramp.mp4", "@file:green.mp4"] },
};
const gridFiles = ["bars.mp4", "rings.mp4", "ramp.mp4", "green.mp4"] as const;
const withGridFiles = (c: TruthCase): TruthCase => ({ ...c, files: [...gridFiles] });

const cues = [{ start: 0, end: 1, text: "tool truth works" }];
const kinetic: ToolSpec = { tool: "kinetic_captions_tool", args: { cues, placement: "style", behind_subject: "none" }, clips: BARS, probe: at(0.8) };
const editCaptions: ToolSpec = {
  tool: "edit_captions_tool",
  args: { timeline_clip_id: A },
  setup: [{ tool: "add_captions_tool", args: { timeline_clip_id: A, cues: [{ start: 0, end: 1, text: "tool truth" }], time_base: "timeline" } }],
  needsChange: true,
};

const place: ToolSpec = { tool: "add_clip_to_timeline_tool", args: { file_id: "@file:bars.mp4", full_file: "true" }, clips: NOTHING, probe: at(0.3) };
const placeMany: ToolSpec = { tool: "add_clips_to_timeline_tool", args: { file_ids: ["@file:bars.mp4", "@file:rings.mp4"], allow_overlap: true }, clips: NOTHING, probe: at(0.9) };
const placeFiles = ["bars.mp4", "rings.mp4"] as const;
const withPlaceFiles = (c: TruthCase): TruthCase => ({ ...c, files: [...placeFiles] });
const duplicate: ToolSpec = { tool: "duplicate_clips_tool", args: { timeline_clip_ids: [A], allow_overlap: true }, probe: at(1.5) };
const repeat: ToolSpec = { tool: "repeat_clip_tool", args: { timeline_clip_ids: [A], allow_overlap: true }, probe: at(1.2) };
const settings: ToolSpec = { tool: "set_project_setting_tool", args: {}, needsChange: true };
const profile: ToolSpec = { tool: "set_project_profile_tool", args: {}, needsChange: true };
const av: ToolSpec = { tool: "set_clip_audio_video_tool", args: { timeline_clip_ids: [A] }, needsChange: true };

export const MORE_TOOL_CASES: readonly TruthCase[] = [
  // One case per motion template, then the arguments that style them.
  ...(["ui_cards", "type_search", "word_scroll", "crop_labels", "callout", "kinetic_type", "step_card", "grid_background", "end_card"] as const).map((id) => ({
    ...param({ ...template, args: { ...template.args, text: "tool truth", words: ["one", "two"], labels: ["one", "two"], file_ids: ["@file:bars.mp4"] } }, "template", id, {
      baseIsUncalled: true,
      label: id,
    }),
    files: ["bars.mp4" as const],
  })),
  withGridFiles(param(grid, "template", "grid", { baseIsUncalled: true, label: "grid" })),
  param(kineticType, "text", "a different headline here"),
  param(kineticType, "palette", "ui_dark", { base: "ui_light" }),
  // The accent colours kinetic_type's tag (the highlighter is the palette's second colour).
  param(kineticType, "accent", "#00ff00", { with: { tag: "NO. 01" }, expect: [up("green")] }),
  param(kineticType, "highlight", 2, { base: 0 }),
  param(kineticType, "align", "center", { base: "left", expect: [up("centroid_x")] }),
  param(kineticType, "position", "top", { base: "bottom", expect: [down("centroid_y")] }),
  param(kineticType, "tag", "NO. 01"),
  param(kineticType, "font_family", "anton", { base: "inter" }),
  param(kineticType, "position_seconds", 0.8, { expect: [down("coverage")] }),
  param(kineticType, "duration_seconds", 0.5, { expect: [down("coverage")] }),
  param(endCard, "subtitle", "and a subtitle"),
  param(endCard, "backdrop", false, { base: true }),
  param(endCard, "variant", "plain"),
  param(scroll, "words", ["alpha", "beta", "gamma", "delta"]),
  param(scroll, "bpm", 60, { base: 240 }),
  param(scroll, "beats", [0.1, 0.2, 0.3], { probe: at(0.4) }),
  param(scroll, "offset_seconds", 0.5, { probe: at(0.4) }),
  withGridFiles(param(grid, "layout", "strips_v", { base: "grid" })),
  withGridFiles(param(grid, "tiles", 2, { base: 4 })),
  withGridFiles(param(grid, "gutter", 40, { base: 0 })),
  withGridFiles(param(grid, "radius", 120, { base: 0 })),
  withGridFiles(param(grid, "reveal", "cut", { base: "pop", probe: at(0.2) })),
  withGridFiles(param(grid, "band", "21:9")),
  withGridFiles(param(grid, "drift", "out", { base: "in" })),
  withGridFiles(param(grid, "mirror", true, { with: { layout: "repeat", file_ids: ["@file:bars.mp4"] }, base: false })),
  withGridFiles(param(grid, "merge", true, { base: false })),
  withGridFiles(param(grid, "zoom_into", 1)),

  // Kinetic captions from script cues (no transcript needed).
  param(kinetic, "cues", [{ start: 0, end: 1, text: "a much longer caption for the truth" }]),
  param(kinetic, "style", "karaoke", { base: "creator" }),
  param(kinetic, "emphasis", "none", { base: "auto" }),
  param(kinetic, "accent", "#00ff00", { with: { emphasis: ["truth"] }, expect: [up("green")] }),
  param(kinetic, "ink", "#00ff00", { expect: [down("red")] }),
  param(kinetic, "text_size", 0.12),
  param(kinetic, "y", 0.2, { base: 0.8 }),
  param(kinetic, "animation", "fade", { base: "pop", probe: at(0.05) }),
  param(kinetic, "avoid", [{ x: 0.5, y: 0.8, w: 1, h: 0.4 }]),
  param(kinetic, "start_seconds", 0.6, { probe: at(0.3) }),
  param(kinetic, "end_seconds", 0.3, { probe: at(0.8) }),

  // Caption edits.
  param(editCaptions, "text_color", "#ff0000", { expect: [down("green")] }),
  param(editCaptions, "text_size", 0.15),
  param(editCaptions, "position", "top"),
  param(editCaptions, "style", "reels"),
  param(editCaptions, "uppercase", true),
  param(editCaptions, "font", "Instrument Serif"),
  param(editCaptions, "background_color", "#0000ff", { with: { background_opacity: 1 } }),
  param(editCaptions, "background_opacity", 1),
  param(editCaptions, "stroke_color", "#ff0000", { with: { stroke_width: 0.09 } }),
  param(editCaptions, "stroke_width", 0.09),
  param({ ...editCaptions, probe: at(0.05) }, "fade_seconds", 1),
  param(editCaptions, "find", "truth", { with: { replace: "TRUTH TOLD" }, baseIsUncalled: true }),
  param(editCaptions, "replace", "TRUTH TOLD", { with: { find: "truth" }, baseIsUncalled: true }),
  param(editCaptions, "shift_seconds", 0.8),
  param(editCaptions, "cue_edits", [{ index: 1, text: "edited caption" }]),
  param(editCaptions, "add_cues", [{ start: 0.2, end: 0.9, text: "another line" }]),
  param({ tool: "remove_captions_tool", args: { timeline_clip_id: A }, setup: editCaptions.setup }, "all_captions", true, { baseIsUncalled: true }),

  // Placing media.
  withPlaceFiles(param(place, "position_seconds", "0.5", { expect: [down("coverage")] })),
  withPlaceFiles(param(place, "start_seconds", "0.5", { with: { full_file: undefined } })),
  withPlaceFiles(param(place, "end_seconds", "0.2", { with: { full_file: undefined, start_seconds: "0" }, expect: [down("coverage")] })),
  withPlaceFiles(param(place, "full_file", "true", { baseIsUncalled: true, expect: [up("coverage")] })),
  withPlaceFiles(param(placeMany, "transition", "fade", { with: { transition_seconds: 0.4 }, base: "" })),
  withPlaceFiles(param(placeMany, "transition_seconds", 0.6, { with: { transition: "fade" }, base: 0.1, probe: at(0.7) })),
  withPlaceFiles(param(placeMany, "fade", "in_out", { with: { fade_seconds: 0.5 }, base: "none" })),
  withPlaceFiles(param(placeMany, "fade_seconds", 0.9, { with: { fade: "in_out" }, base: 0.1 })),
  withPlaceFiles(param(placeMany, "zoom", "in", { base: "none" })),
  withPlaceFiles(param(placeMany, "start_seconds", 0.5, { base: 0 })),
  withPlaceFiles(param(placeMany, "order", "name", { with: { file_ids: ["@file:rings.mp4", "@file:bars.mp4"] }, base: "as_given", probe: at(0.5) })),
  withPlaceFiles(param(placeMany, "items", [{ file_id: "@file:rings.mp4" }], { with: { file_ids: undefined }, base: [{ file_id: "@file:bars.mp4" }], probe: at(0.5) })),
  withPlaceFiles(param(placeMany, "fit_total_seconds", 1, { with: { min_clip_seconds: 0.1 } })),
  { ...param({ ...placeMany, args: { file_ids: ["@file:disc.png"] }, probe: at(0.5) }, "image_seconds", 0.3, { base: 1 }), files: ["disc.png"] },
  param(duplicate, "copies", 2, { probe: at(2.5) }),
  param(duplicate, "position_seconds", 1.5, { base: -1, probe: at(1.2) }),
  param(repeat, "times", 3, { probe: at(2.5) }),
  param(repeat, "pattern", "ping_pong", { base: "loop" }),
  param(repeat, "reverse", true, { base: false }),
  param(repeat, "delay_seconds", 0.5, { base: 0 }),
  param(repeat, "speed_ramp_percent", 100, { base: 0 }),

  // Clip switches and the project's frame.
  param(av, "video", "off", { expect: [down("luma")] }),
  param(settings, "width", 180, { expect: [down("coverage")] }),
  param(settings, "height", 320, { expect: [down("coverage")] }),
  param(settings, "orientation", "portrait"),
  param(settings, "profile", "HD Vertical 720p 30 fps"),
  param(settings, "preset", "instagram_reel"),
  // 0.58 s: frame 18 of 30 fps shows source frame 17, frame 6 of 10 fps source frame 15.
  param(settings, "fps", 10, { probe: at(0.58) }),
  param(settings, "fps_num", 10, { with: { fps_den: 1 }, baseIsUncalled: true, probe: at(0.58) }),
  param(settings, "fps_den", 2, { with: { fps_num: 30 }, baseIsUncalled: true, probe: at(0.58) }),
  param({ ...settings, probe: SOUND }, "sample_rate", 22050),
  param({ ...settings, probe: SOUND }, "channels", "mono", { expect: [up("rms_right")] }),
  param(settings, "reframe", "fill", { with: { orientation: "portrait" }, base: "keep" }),
  param(profile, "profile", "HD Vertical 720p 30 fps"),
  param(profile, "orientation", "portrait"),
  param(profile, "width", 180, { with: { height: 320 }, baseIsUncalled: true }),
  param(profile, "height", 180, { with: { width: 180 }, baseIsUncalled: true }),
  param(profile, "fps", 10, { probe: at(0.58) }),
  param(profile, "reframe", "fill", { with: { orientation: "portrait" }, base: "keep" }),
  { ...param(profile, "from_file_id", "@file:small.mp4"), files: ["small.mp4"] },
];

