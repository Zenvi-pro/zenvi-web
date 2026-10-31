/**
 * Hand-written cases for mastering, automatic sound design and the
 * remaining timeline edits (aligning, closing gaps, copying effects and
 * keyframes, swapping shots, edge-anchored sound effects).
 */

import type { TruthCase, TruthClip } from "../harness.js";
import { A, B, BARS, CUT, down, param, SOUND, up, type ToolSpec } from "./define.js";

const at = (seconds: number) => ({ kind: "picture" as const, at: seconds });
/** Two shots with a gap (A 0–1, B 1.5–2.5). */
const GAP: TruthClip[] = [
  { fixture: "bars.mp4", id: "A", position: 0 },
  { fixture: "rings.mp4", id: "B", position: 1.5 },
];
const NOISE: TruthClip[] = [{ fixture: "noise.wav", id: "A" }];

const master: ToolSpec = { tool: "master_audio_tool", args: { music_clip_ids: [A], balance: "keep", score: false }, clips: NOISE, probe: SOUND };
const sound: ToolSpec = { tool: "auto_sound_design_tool", args: { sources: "procedural", kit: "synth" }, clips: CUT, probe: SOUND };
const gaps: ToolSpec = { tool: "remove_gaps_tool", args: { track: "1" }, clips: GAP, probe: at(1.2) };
const keyframed = [{ tool: "set_keyframes_tool", args: { timeline_clip_id: A, property: "alpha", points: [{ seconds: 0, value: 1 }, { seconds: 1, value: 0 }] } }];
const unkey: ToolSpec = { tool: "remove_keyframes_tool", args: { timeline_clip_ids: [A] }, setup: keyframed, probe: at(0.5) };
const copyFx: ToolSpec = {
  tool: "copy_effects_tool",
  args: { source_clip_id: A, timeline_clip_ids: [B] },
  clips: CUT,
  setup: [
    { tool: "add_effect_tool", args: { timeline_clip_id: A, effect: "Negate" } },
    { tool: "add_effect_tool", args: { timeline_clip_id: A, effect: "Pixelate" } },
  ],
  probe: at(1.5),
};
const copyKeys: ToolSpec = {
  tool: "copy_clip_keyframes_tool",
  args: { source_clip_id: A, timeline_clip_ids: [B] },
  clips: CUT,
  setup: [
    { tool: "set_keyframes_tool", args: { timeline_clip_id: A, property: "alpha", points: [{ seconds: 0, value: 0.2 }] } },
    { tool: "set_keyframes_tool", args: { timeline_clip_id: A, property: "scale_x", points: [{ seconds: 0, value: 0.4 }] } },
  ],
  probe: at(1.5),
};
// Its own (moving) file at another moment: rings.mp4 is a still pattern.
const swap: ToolSpec = { tool: "swap_shot_tool", args: { clip_id: A, file_id: "@file:bars.mp4" }, clips: [{ fixture: "bars.mp4", id: "A", end: 0.5 }], probe: at(0.3) };
const sfxEdge: ToolSpec = {
  tool: "add_sfx_tool",
  args: { recipe: "impact_punch", kit: "synth", clip_id: A, align: "start" },
  clips: [
    { fixture: "noise.wav", id: "A", position: 0, end: 0.4 },
    { fixture: "ramp.mp4", id: "B", position: 0, track: 2 },
  ],
  probe: SOUND,
};

export const FINISH_TOOL_CASES: readonly TruthCase[] = [
  // Mastering a bed to a loudness target.
  param(master, "preset", "broadcast", { base: "social", expect: [down("rms")] }),
  param(master, "target_lufs", -30, { base: -14, expect: [down("rms")] }),
  param(master, "true_peak_dbtp", -9, { with: { target_lufs: -10 }, base: 0, expect: [down("rms")] }),
  param(master, "limit", true, { with: { target_lufs: -8, true_peak_dbtp: -6 }, base: false }),

  // Automatic sound design over a cut.
  param(sound, "intensity", "hype", { base: "subtle" }),
  param(sound, "seed", 9, { with: { intensity: "hype" }, base: 1 }),
  param(sound, "climax_seconds", 1.6, { with: { intensity: "hype" } }),

  // Timeline edits.
  param(gaps, "from_seconds", 1.6, { base: 0 }),
  param(gaps, "only_first", true, { clips: [...GAP, { fixture: "ramp.mp4", id: "C", position: 3 }], probe: at(2.2), base: false }),
  param(unkey, "properties", ["alpha"], { baseIsUncalled: true, expect: [up("luma")] }),
  param(unkey, "end_seconds", 0.4, { with: { properties: ["alpha"] } }),
  param(copyFx, "effects", ["Negate"], { baseIsUncalled: true }),
  param(copyFx, "mode", "replace", {
    setup: [...copyFx.setup!, { tool: "add_effect_tool", args: { timeline_clip_id: B, effect: "Negate" } }],
    base: "append",
  }),
  param(copyKeys, "groups", ["alpha"], { baseIsUncalled: true, expect: [down("luma")] }),
  param(swap, "start_seconds", 0.4, { base: 0.1 }),
  param({ tool: "trim_clip_tool", args: { clip_id: A }, probe: at(0.8) }, "edge", "right", { with: { at_seconds: 0.5 }, base: "left" }),
  param({ tool: "trim_clip_tool", args: { clip_id: A, edge: "right" }, probe: at(0.8) }, "at_seconds", 0.5, { baseIsUncalled: true, expect: [down("coverage")] }),
  param({ tool: "split_clip_tool", args: { clip_id: A, keep: "left" }, probe: at(0.7) }, "at_seconds", 0.5, { base: 0.9, expect: [down("coverage")] }),
  param({ tool: "slice_clips_tool", args: { timeline_clip_ids: [A], keep: "left" }, probe: at(0.7) }, "at_seconds", 0.5, { base: 0.9, expect: [down("coverage")] }),
  param({ tool: "apply_motion_transition_tool", args: { preset: "whip", track: "1" }, clips: CUT, probe: at(0.92) }, "time", 1, { baseIsUncalled: true }),
  param({ tool: "remove_track_tool", args: { track: "2" }, clips: [...BARS, { fixture: "rings.mp4", id: "B", track: 2 }] }, "with_clips", true, { baseIsUncalled: true }),
  param(sfxEdge, "edge", "end", { base: "start" }),
];
