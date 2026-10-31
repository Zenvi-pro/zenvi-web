/**
 * Every clip property libopenshot's Clip::PropertiesJSON lists
 * (libopenshot/src/Clip.cpp, the engine's LIBOPENSHOT_CLIP_PROPERTIES), set
 * through set_clip_properties_tool the way the Assistant sets it: by key,
 * with choice names and colours. The ledger's CLIP_PROPERTY_EXEMPT lists the
 * keys the tool refuses or that do nothing on their own.
 */

import { clipId, type Args, type Expectation, type Probe, type TruthCase, type TruthClip } from "../harness.js";

const A = clipId("A");
const PICTURE: Probe = { kind: "picture", at: 0.5 };
const SOUND: Probe = { kind: "sound" };
const BARS: TruthClip[] = [{ fixture: "bars.mp4", id: "A" }];
/** The clip over another shot, for blend modes. */
const OVER: TruthClip[] = [
  { fixture: "rings.mp4", id: "B", track: 1 },
  { fixture: "bars.mp4", id: "A", track: 2 },
];
const SMALL: TruthClip[] = [{ fixture: "small.mp4", id: "A" }];
/** A half-size picture-in-picture, so placement properties have room to move it. */
const PIP: Args = { scale_x: 0.5, scale_y: 0.5 };

interface PropCase {
  value: unknown;
  context?: Args;
  clips?: TruthClip[];
  probe?: Probe;
  expect?: Expectation[];
  /** Case id suffix when one key has several cases. */
  label?: string;
}

const up = (metric: Expectation["metric"]): Expectation => ({ metric, direction: "up" });
const down = (metric: Expectation["metric"]): Expectation => ({ metric, direction: "down" });

/** Clip keys with no case, and why. */
export const CLIP_PROPERTY_EXEMPT: ReadonlyMap<string, string> = new Map([
  ["id", "read-only: set_clip_properties_tool refuses it"],
  ["duration", "read-only: set_clip_properties_tool refuses it"],
  ["position", "refused here (move_clip_tool / move_clips_tool position_seconds cases cover it)"],
  ["start", "refused here (trim_clip_tool start_seconds and trim_clips_tool cases cover it)"],
  ["end", "refused here (trim_clip_tool end_seconds and trim_clips_tool cases cover it)"],
  ["layer", "refused here (move_clip_tool track covers it)"],
  ["time", "refused here: time remapping belongs to the speed tools (set_clip_speed_tool, speed_ramp_tool cases)"],
  ["parentObjectId", "an id: attaches the clip to a tracked object, which needs the desktop's OpenCV Tracker"],
]);

/** key → the cases proving it. */
export const CLIP_PROPERTY_CASES: Readonly<Record<string, readonly PropCase[]>> = {
  alpha: [{ value: 0.3, expect: [down("luma")] }],
  channel_filter: [{ value: 1, probe: SOUND, expect: [down("rms_left")] }],
  channel_mapping: [{ value: 1, context: { channel_filter: 0 }, probe: SOUND, expect: [up("balance")] }],
  composite: [
    { value: "Multiply", clips: OVER, expect: [down("luma")], label: "Multiply" },
    { value: "Screen", clips: OVER, expect: [up("luma")], label: "Screen" },
    { value: "Difference", clips: OVER, label: "Difference" },
  ],
  corner_radius: [{ value: 0.3, expect: [down("coverage")] }],
  display: [{ value: "Clip" }],
  gravity: [{ value: "Top Left", context: PIP, expect: [down("centroid_x"), down("centroid_y")] }],
  has_audio: [{ value: "Off", probe: SOUND, expect: [down("rms")] }],
  has_video: [{ value: "Off", expect: [down("luma")] }],
  location_x: [{ value: 0.3, context: PIP, expect: [up("centroid_x")] }],
  location_y: [{ value: 0.3, context: PIP, expect: [up("centroid_y")] }],
  margin: [{ value: 0.2, context: { ...PIP, gravity: "Top Left" }, expect: [up("centroid_x"), up("centroid_y")] }],
  mixing: [
    {
      value: "Reduce",
      clips: [
        { fixture: "rings.mp4", id: "B", track: 1 },
        { fixture: "bars.mp4", id: "A", track: 2 },
      ],
      probe: SOUND,
      expect: [down("rms")],
    },
  ],
  origin_x: [{ value: 0, context: { ...PIP, rotation: 45 } }],
  origin_y: [{ value: 0, context: { ...PIP, rotation: 45 } }],
  rotation: [{ value: 30, expect: [down("coverage")] }],
  scale: [
    { value: "Crop", clips: SMALL, expect: [up("width")], label: "Crop" },
    { value: "Stretch", clips: SMALL, expect: [up("width")], label: "Stretch" },
    { value: "None", clips: SMALL, expect: [down("height")], label: "None" },
  ],
  scale_x: [{ value: 0.5, expect: [down("width")] }],
  scale_y: [{ value: 0.5, expect: [down("height")] }],
  shear_x: [{ value: 0.4, context: PIP }],
  shear_y: [{ value: 0.4, context: PIP }],
  volume: [{ value: 0.3, probe: SOUND, expect: [down("rms")] }],
  wave_color: [{ value: "#ff0000", context: { waveform: "Yes" }, expect: [up("red")] }],
  waveform: [{ value: "Yes" }],
  waveform_mode: [{ value: "Bars", context: { waveform: "Yes" } }],
};

export function clipPropertyCases(): TruthCase[] {
  const cases: TruthCase[] = [];
  for (const [key, list] of Object.entries(CLIP_PROPERTY_CASES)) {
    for (const c of list) {
      cases.push({
        id: `set_clip_properties_tool properties.${key}${c.label ? `=${c.label}` : ""}`,
        tool: "set_clip_properties_tool",
        param: `properties.${key}`,
        clips: c.clips ?? BARS,
        setup: c.context ? [{ tool: "set_clip_properties_tool", args: { timeline_clip_ids: [A], properties: c.context } }] : [],
        base: null,
        variant: { timeline_clip_ids: [A], properties: { [key]: c.value } },
        probe: c.probe ?? PICTURE,
        expect: c.expect,
      });
    }
  }
  return cases;
}
