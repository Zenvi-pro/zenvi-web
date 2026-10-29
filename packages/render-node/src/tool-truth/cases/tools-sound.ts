/**
 * Hand-written cases for the tools whose arguments change the sound: clip
 * levels and automation, EQ, dynamics, space, pan, audio presets and
 * synthesised sound effects. Measured on the mix render-node exports.
 */

import type { TruthCase, TruthClip } from "../harness.js";
import { A, B, down, param, SOUND, up, type ToolSpec } from "./define.js";

const NOISE: TruthClip[] = [{ fixture: "noise.wav", id: "A" }];
const TONE: TruthClip[] = [{ fixture: "bars.mp4", id: "A" }];
/** A bed (noise, A) under a tone (B) on the track above. */
const BED: TruthClip[] = [
  { fixture: "noise.wav", id: "A", track: 1 },
  { fixture: "bars.mp4", id: "B", track: 2, position: 0.2, start: 0, end: 0.2 },
];

const volume: ToolSpec = { tool: "set_clip_volume_tool", args: { timeline_clip_id: A }, clips: NOISE, probe: SOUND, needsChange: true };
const fade: ToolSpec = { tool: "fade_clip_tool", args: { clip_id: A }, clips: TONE, probe: SOUND, needsChange: true };
const gain: ToolSpec = { tool: "set_audio_gain_tool", args: { clip_ids: [A] }, clips: NOISE, probe: SOUND, needsChange: true };
const automate: ToolSpec = { tool: "automate_volume_tool", args: { clip_ids: [A] }, clips: NOISE, probe: SOUND };
const eq: ToolSpec = { tool: "eq_tool", args: { clip_ids: [A] }, clips: NOISE, probe: SOUND };
// Pink noise at about -28 dBFS: the voice preset's -20 dB threshold never engages, so the cases lower it.
const comp: ToolSpec = { tool: "compress_tool", args: { clip_ids: [A], preset: "voice", threshold_db: -45 }, clips: NOISE, probe: SOUND };
const space: ToolSpec = { tool: "space_tool", args: { clip_ids: [A] }, clips: [{ fixture: "clicks.wav", id: "A" }], probe: SOUND };
const pan: ToolSpec = { tool: "pan_tool", args: { clip_ids: [A] }, clips: NOISE, probe: SOUND, needsChange: true };
const preset: ToolSpec = { tool: "apply_audio_effect_tool", args: { timeline_clip_id: A }, clips: NOISE, probe: SOUND };
const duck: ToolSpec = { tool: "duck_tool", args: { bed: A, under: B }, clips: BED, probe: SOUND };
const sfx: ToolSpec = { tool: "add_sfx_tool", args: { recipe: "impact_punch", kit: "synth", at_seconds: 0.2, align: "start" }, clips: [], probe: SOUND };
const av: ToolSpec = { tool: "set_clip_audio_video_tool", args: { timeline_clip_ids: [A] }, clips: TONE, probe: SOUND, needsChange: true };

export const SOUND_TOOL_CASES: readonly TruthCase[] = [
  // set_clip_volume_tool: every spelling of the level, and the window.
  param(volume, "level_db", "-12", { expect: [down("rms")] }),
  param(volume, "level", "0.25", { expect: [down("rms")] }),
  param(volume, "volume", "0.25", { expect: [down("rms")] }),
  param(volume, "gain", "0.25", { expect: [down("rms")] }),
  param(volume, "db", "-12", { expect: [down("rms")] }),
  param(volume, "start_seconds", "0.5", { with: { level_db: "-30", end_seconds: "1" }, expect: [up("rms")] }),
  param(volume, "end_seconds", "0.3", { with: { level_db: "-30", start_seconds: "0" }, expect: [up("rms")] }),
  param(volume, "fade_ms", "400", { with: { level_db: "-30", start_seconds: "0.3", end_seconds: "0.7" } }),
  param(volume, "mode", "scale", { with: { level_db: "-6" }, setup: [{ tool: "set_clip_volume_tool", args: { timeline_clip_id: A, level_db: "-6" } }], expect: [down("rms")] }),

  // Fades on the sound.
  param(fade, "fade_in_seconds", 0.8, { expect: [down("rms")] }),
  param(fade, "fade_out_seconds", 0.8, { expect: [down("rms")] }),
  param(fade, "audio", false, { with: { fade_in_seconds: 0.8 }, base: true, expect: [up("rms")] }),

  // Mix tools.
  param(gain, "gain_db", -12, { expect: [down("rms")] }),
  param(automate, "shape", "dip", { with: { start_seconds: 0.2, end_seconds: 0.8, db: -20 }, baseIsUncalled: true, expect: [down("rms")] }),
  param(automate, "points", [{ t: 0, db: 0 }, { t: 1, db: -30 }], { with: { shape: "points" }, baseIsUncalled: true, expect: [down("rms")] }),
  param(automate, "db", -30, { with: { shape: "dip", start_seconds: 0.2, end_seconds: 0.8 }, base: -6, expect: [down("rms")] }),
  param(automate, "start_seconds", 0.05, { with: { shape: "dip", end_seconds: 0.9, db: -20 }, base: 0.6, expect: [down("rms")] }),
  param(automate, "end_seconds", 0.95, { with: { shape: "dip", start_seconds: 0.1, db: -20 }, base: 0.3, expect: [down("rms")] }),
  param(automate, "fade_ms", 300, { with: { shape: "dip", start_seconds: 0.3, end_seconds: 0.7, db: -30 } }),
  param(automate, "at_seconds", 0.8, { with: { shape: "suck_out", length_ms: 300 }, base: 0.3 }),
  param(automate, "hit_times", [0.4, 0.8], { with: { shape: "suck_out", length_ms: 200 }, base: [0.4], expect: [down("rms")] }),
  param(automate, "length_ms", 600, { with: { shape: "suck_out", at_seconds: 0.8 }, base: 100, expect: [down("rms")] }),
  param(automate, "curve", "bezier", { with: { shape: "ramp", start_seconds: 0, end_seconds: 1, db: -30 }, base: "linear" }),
  param(automate, "mode", "absolute", { with: { shape: "dip", start_seconds: 0, end_seconds: 1, db: 0 }, setup: [{ tool: "set_clip_volume_tool", args: { timeline_clip_id: A, level_db: "-12" } }], base: "relative", expect: [up("rms")] }),
  param(eq, "bands", [{ type: "low_pass", freq: 300 }], { baseIsUncalled: true, expect: [down("brightness")] }),
  param(eq, "preset", "muffle", { baseIsUncalled: true, expect: [down("brightness")] }),
  param(comp, "threshold_db", -50, { base: -20, expect: [down("rms")] }),
  param(comp, "ratio", 20, { expect: [down("rms")] }),
  param(comp, "attack_ms", 200, { with: { threshold_db: -45, ratio: 10 } }),
  param(comp, "release_ms", 2000, { with: { threshold_db: -45, ratio: 10 } }),
  param(comp, "makeup_db", 12, { expect: [up("rms")] }),
  param(comp, "preset", "limit", { label: "limit" }),
  param(space, "space", "hall", { baseIsUncalled: true }),
  param(space, "mix", 0.5, { with: { space: "hall" } }),
  param(pan, "pan", 1, { expect: [up("balance")] }),
  param(pan, "points", [{ t: 0, pan: -1 }, { t: 1, pan: -1 }], { expect: [down("balance")] }),
  param(preset, "preset", "voice_compressor", { baseIsUncalled: true }),
  param(preset, "properties", { level: 90 }, { with: { preset: "add_noise" } }),
  param(duck, "depth_db", -30, { base: -6 }),
  param(duck, "attack_ms", 1500, { with: { depth_db: -30 }, base: 10 }),
  param(duck, "hold_ms", 1500, { with: { depth_db: -30 }, base: 0 }),
  param(duck, "release_ms", 3000, { with: { depth_db: -30 }, base: 50 }),
  param(duck, "lookahead_ms", 900, { with: { depth_db: -30 }, base: 0 }),

  // Synthesised sound effects: each shaping control changes the sound.
  param(sfx, "recipe", "whoosh_short", { base: "impact_punch" }),
  param(sfx, "gain_db", -30, { base: -8, expect: [down("rms")] }),
  param(sfx, "duration", 0.3, { base: 0.7, expect: [down("tail")] }),
  param(sfx, "pitch", 12, { expect: [up("brightness")] }),
  param(sfx, "brightness", 1, { base: 0, expect: [up("brightness")] }),
  param(sfx, "intensity", 1, { base: 0 }),
  param(sfx, "pan", 1, { expect: [up("balance")] }),
  param(sfx, "seed", 7, { base: 1 }),
  param(sfx, "at_seconds", 0.6, { expect: [up("onset")] }),
  param(sfx, "align", "peak", { with: { recipe: "whoosh_short" }, base: "start" }),

  // Clip switches.
  param(av, "audio", "off", { expect: [down("rms")] }),
];
