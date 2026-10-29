---
id: white-flash-or-light-leak-join
kind: technique
summary: "For a scene or act boundary: 4-12 frames of white or a warm leak hide the join, often into a darker shot."
categories: [movie-game-trailer, wedding-event-film]
tools: [apply_motion_transition_tool, list_motion_transitions_tool, apply_fx_tool, list_fx_tool, color_grade_clip_tool, add_sfx_tool, master_audio_tool]
pace: medium
mood: [dramatic, luminous, romantic]
aspect: ["16:9", "2.39:1", "9:16"]
pairs_with: [fire-superimposition-ramp, scale-jump-cut-on-sub-bass-hit, soft-bloom-lifted-shadow-grade, diegetic-sound-carries-the-cut]
avoid_with: [value-inversion-jump-cut, monochrome-to-colour-hit-flash]
needs: []
---

# White flash or light-leak join

## What it is

The frame blows out to white (or a warm optical leak washes over it) for
4-12 frames exactly on a cut, and the next shot comes up out of it. In a
trailer it is hard: 4-6 frames, a boom under it, and the next shot is a
dark, underexposed insert so the flash reads twice as bright. In a wedding
film it is soft: about 12 frames of bloom or a warm leak, no boom, joining
an interior to a sunny exterior or hiding an angle change.

## Build it in Zenvi

The cut must be frame-exact (at 24 fps use multiples of 1/24 s). The flash
is a motion transition on the cut; the leak is a Zenvi FX rendered onto the
first 0.3-0.5 s of the incoming clip (CLI/local only, needs ffmpeg).

```json
add_clip_to_timeline_tool {"file_id": "<bright wide>", "position_seconds": 0, "start_seconds": 2, "end_seconds": 5.5, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<dark insert>", "position_seconds": 3.5, "start_seconds": 4, "end_seconds": 6.5, "track": "1"}
set_clip_properties_tool {"scope": "all", "properties": {"scale": "Crop", "volume": 0}}
color_grade_clip_tool {"timeline_clip_ids": ["<dark insert>"], "exposure": -0.2, "shadows": -0.35, "contrast": 0.2}
apply_motion_transition_tool {"preset": "flash_white", "clip1_id": "<bright wide>", "clip2_id": "<dark insert>", "duration": 0.25}
add_sfx_tool {"recipe": "riser_tonal", "at_seconds": 3.5, "duration": 2.0, "gain_db": -16}
add_sfx_tool {"recipe": "impact_boom", "at_seconds": 3.5, "gain_db": -4}
apply_fx_tool {"clip_id": "<next shot>", "effects": [{"effect": "light_leak", "amount": 0.8, "params": {"style": "leak", "color": "#ffb36b"}, "start": 0, "end": 0.5}]}
add_sfx_tool {"recipe": "whoosh_short", "at_seconds": 6.0, "gain_db": -14}
master_audio_tool {"target_lufs": -16, "true_peak_dbtp": -1.5, "balance": "keep"}
```

Wedding version: `flash_white` with `"duration": 0.5` and `"intensity": 0.6`,
or the `light_leak` FX alone, and no boom. Where `apply_fx_tool` is not
available (web editor without local ffmpeg), use `flash_white` at
intensity 0.5-0.7 as the soft join.

## Timing & taste rules

- Trailer: 4-6 frames (0.17-0.25 s at 24 fps). Wedding: 10-12 frames (0.4-0.5 s).
- The flash peaks on the cut frame; the incoming shot is visible again by
  frame 3 after the cut.
- The shot after a trailer flash is darker than the one before (exposure
  -0.2 to -0.6), but must still show something: sparks, a rim, an eye.
  A pitch-black insert after the flash reads as a dead frame.
- Leak colour follows the incoming shot: amber `#ffb36b` on warm footage,
  pale gold on daylight. A saturated pink leak on a red shot clashes.
- At most one flash per scene boundary, about 1 per 20-30 s. Seven in 90 s
  was judged overused in the reference wedding film.

## Sound for it

Trailer: a short riser (-16 dB) ending on the cut, and one boom on the
flash frame, hero level (momentary about -9 to -11 LUFS, 0 to +3 LU over
the bed). Wedding: no impact; the song carries it, at most a soft
`whoosh_short` 6-10 dB under the bed, or a breath of crowd/room tone.

## Common mistakes

- Flashing every cut; it stops being a scene boundary.
- Crushing the next shot to pure black, so the flash lands on nothing.
- A leak whose colour fights the grade on either side.
- A hard boom under a wedding leak; the soft join wants no impact.
- Placing the flash on a cut that is not frame-exact (the tool refuses a
  gap or overlap).

## Verified

2026-10-28. 8.5 s at 1280x720/24: Pexels desert drone wide, 6-frame
`flash_white` with riser and boom into a dark spark insert at 3.5 s, then a
`light_leak` FX join into a sunset silhouette at 6.0 s. Frames 84-92 show
white, then grey-over-sparks, then the insert. First pass 2.91/10: the
original insert (exposure -0.6 on an already dark shot) was pitch black.
Swapped to a spark shot with exposure -0.2 and re-rendered: 4.09/10,
transitions 6/10 ("the flash with the low sub boom works effectively");
remaining notes are about the test's slow opener and abrupt ending, not the
join. Artifacts: `~/zenvi-motion/fleet/artifacts/sk4-cinematic-story/techniques/white-flash-or-light-leak-join.*`,
build `~/zenvi-motion/fleet/artifacts/sk4-cinematic-story/techniques/white-flash-or-light-leak-join.build.sh`.
