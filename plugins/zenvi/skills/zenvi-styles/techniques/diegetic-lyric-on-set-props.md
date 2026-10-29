---
id: diegetic-lyric-on-set-props
kind: technique
summary: "For a lyric video insert: print one sung line on an object in the shot (a record label) so the type belongs to the set."
categories: [music-lyric-video]
tools: [add_title_tool, import_files_tool, add_clip_to_timeline_tool, set_clip_properties_tool, set_keyframes_tool, apply_look_tool, set_audio_gain_tool, master_audio_tool]
pace: calm
mood: [playful, intimate, nostalgic]
aspect: ["16:9", "9:16"]
pairs_with: [lyric-text-timed-to-vocals, reset-inside-the-vocal-rest, one-hue-treatment-with-glow-silhouette]
avoid_with: [persistent-frame-mask-over-whole-video]
needs: [planar-surface-track-overlay]
---

# Diegetic lyric on set props

## What it is

One lyric line appears printed on a physical object in the frame (a record
label, a sign, a mug) for the 2-3 s that line is sung, in the object's own
perspective, moving with it. It is mostly a shoot-time idea; in the edit
it works on a locked-off insert where the surface is flat and its motion
is simple (a turning label).

## Build it in Zenvi

A clip's transform scales before it rotates, so a squashed (perspective)
text clip spins as a flat ellipse of letters, not as print on a tilted
disc. Precompose instead: (a) render the flat label art, (b) render it
turning, (c) squash that render into the label's ellipse and multiply it
on. Each stage is its own project (one .zvn per folder).

```json
add_title_tool {"text": "say my name", "template": "Standard_1", "position_seconds": 0, "duration_seconds": 5, "background_color": "#ffffff", "text_color": "#202020", "font": "Georgia", "font_scale": 1.4}
import_files_tool {"paths": ["<stage a render>"]}
add_clip_to_timeline_tool {"file_id": "<stage a>", "position_seconds": 0, "start_seconds": 0.6, "end_seconds": 4.6, "track": "2"}
add_title_tool {"text": " ", "position_seconds": 0, "duration_seconds": 4, "background_color": "#ffffff", "track": "1"}
set_clip_properties_tool {"timeline_clip_ids": ["<stage a clip>"], "properties": {"location_y": -0.15, "origin_y": 0.65}}
set_keyframes_tool {"timeline_clip_id": "<stage a clip>", "property": "rotation", "points": [{"timeline_seconds": 0, "value": -35}, {"timeline_seconds": 4, "value": 35}], "interpolation": "linear"}
add_clip_to_timeline_tool {"file_id": "<record insert>", "position_seconds": 0, "start_seconds": 2, "end_seconds": 6, "track": "1"}
set_clip_properties_tool {"scope": "all", "properties": {"scale": "Crop", "volume": 0}}
import_files_tool {"paths": ["<stage b render>"]}
add_clip_to_timeline_tool {"file_id": "<stage b>", "position_seconds": 0, "start_seconds": 0, "end_seconds": 4, "track": "2"}
set_clip_properties_tool {"timeline_clip_ids": ["<label>"], "properties": {"composite": "multiply", "scale_x": 1.0, "scale_y": 0.39, "location_x": -0.3125, "location_y": 0.417, "volume": 0}}
apply_look_tool {"clipIds": "<record insert id>", "look_id": "duotone #02060f #9cc3ff"}
```

Stage a and b are 720x720 at the main fps. `location_y -0.15` lifts the
line above the spindle; `origin_y 0.65` keeps the pivot on the spindle.
The label numbers come from a frame grab: ellipse centre (240, 660) px of
1280x720, radii 360 x 140 px, so `location = (centre - frame centre) /
frame size` and `scale_y = 140 / 360`. White multiplies to nothing, so the
square edges vanish. Grade only the footage (`clipIds` takes a string id
or "all", not an array), never the white label layer.

Missing: `planar-surface-track-overlay` (corner-pin or planar track a
layer onto a moving surface). Without it this only works on a locked-off
shot. Fallback for a handheld or moving prop: a plain caption
(`lyric-text-timed-to-vocals`) over the insert.

## Timing & taste rules

- One line per prop, shown for the whole sung line, 2-4 s.
- Text height on the label about 8-12 % of the frame height after the
  squash; smaller reads as a texture, not a lyric.
- Turn it slowly through a readable arc (about 70 degrees in 4 s). A true
  33 1/3 rpm spin (200 degrees per second) turned the line upside down and
  the judge called it illegible.
- Dark ink (#202020) with multiply so the label's light and grain show
  through; no glow, no shadow.

## Sound for it

The vocal line it prints, on top (-15 LUFS); bed 8-12 LU under. Vinyl
crackle and a needle drop at -30 to -34 LUFS sell the object.

## Common mistakes

- Putting a squashed text clip on the label and rotating it (wrong
  transform order: the letters shear instead of turning in perspective).
- Grading the white label layer, which turns its square visible.
- A camera move on the insert with no track; the print slides off.
- Cutting away mid-line.

## Verified

2026-10-28. 4 s at 1280x720/24, Pexels turntable insert, three-stage
build in `~/zenvi-motion/fleet/artifacts/sk4-cinematic-story/techniques/diegetic-lyric-on-set-props.build.sh`
(`a/`, `b/`, main). Frame grabs show the line printed on the label in the
shot's perspective, above the spindle, turning with it. Judge 3.09/10
with the full 33 rpm spin (illegible upside down), then 2.91/10 with the
slow turn: the legibility note went away and the judge called the label
lock "a great idea"; the remaining notes were the one-shot test, the
abrupt end mid-line and no vinyl foley. Artifacts:
`~/zenvi-motion/fleet/artifacts/sk4-cinematic-story/techniques/diegetic-lyric-on-set-props.*`.
