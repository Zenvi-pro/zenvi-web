---
id: fire-superimposition-ramp
kind: technique
summary: "For a trailer's act-two peak: fire fades up over a held face for ~4.5 s, then smash to black and silence."
categories: [movie-game-trailer]
tools: [add_clip_to_timeline_tool, set_clip_properties_tool, set_clip_speed_tool, set_keyframes_tool, color_grade_clip_tool, add_kinetic_title_tool, set_audio_gain_tool, automate_volume_tool, add_sfx_tool, master_audio_tool]
pace: medium
mood: [dramatic, ominous, epic]
aspect: ["2.39:1", "16:9"]
pairs_with: [blackout-and-dead-silence-pause, restrained-title-card-on-black, single-accent-palette-grade, white-flash-or-light-leak-join]
avoid_with: [cuts-on-audio-transients, accelerating-cut-length-ramp]
needs: []
---

# Fire superimposition ramp

## What it is

A static close-up of a face is held 5-6 s while an explosion shot, shot on
black, fades up over it with a screen (additive-looking) blend until fire
fills the frame; on the peak the film smash-cuts to black and the sound
drops to nothing. It turns one held face into the trailer's turn: the
character's inner state becomes the fire. Works only once per trailer.

## Build it in Zenvi

Face on track 1, fire on track 2. The fire must be at its brightest at the
smash, so pick the source window that ends on the peak and retime it to the
ramp length (stock explosions often burn out a second before their end).

```json
add_clip_to_timeline_tool {"file_id": "<face close-up>", "position_seconds": 0, "start_seconds": 8, "end_seconds": 13, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<explosion on black>", "position_seconds": 0.5, "start_seconds": 0, "end_seconds": 3.6, "track": "2"}
set_clip_speed_tool {"timeline_clip_ids": ["<fire>"], "target_duration_seconds": 4.5}
set_clip_properties_tool {"scope": "all", "properties": {"scale": "Crop", "volume": 0}}
color_grade_clip_tool {"timeline_clip_ids": ["<face>"], "saturation": 0.6, "contrast": 0.2, "shadows": -0.3}
set_clip_properties_tool {"timeline_clip_ids": ["<fire>"], "properties": {"composite": "screen"}}
set_keyframes_tool {"timeline_clip_id": "<fire>", "property": "alpha", "points": [{"timeline_seconds": 0.5, "value": 0}, {"timeline_seconds": 4.5, "value": 1}], "ease": "ease_in_quad"}
set_keyframes_tool {"timeline_clip_id": "<face>", "property": "scale_x", "points": [{"timeline_seconds": 0, "value": 1}, {"timeline_seconds": 5.0, "value": 1.08}]}
set_keyframes_tool {"timeline_clip_id": "<face>", "property": "scale_y", "points": [{"timeline_seconds": 0, "value": 1}, {"timeline_seconds": 5.0, "value": 1.08}]}
set_keyframes_tool {"timeline_clip_id": "<fire>", "property": "scale_x", "points": [{"timeline_seconds": 0.5, "value": 1}, {"timeline_seconds": 5.0, "value": 1.2}]}
set_keyframes_tool {"timeline_clip_id": "<fire>", "property": "scale_y", "points": [{"timeline_seconds": 0.5, "value": 1}, {"timeline_seconds": 5.0, "value": 1.2}]}
add_clip_to_timeline_tool {"file_id": "<music bed>", "position_seconds": 0, "start_seconds": 30, "end_seconds": 35, "track": "5"}
set_audio_gain_tool {"clip_ids": ["<bed>"], "gain_db": 6}
automate_volume_tool {"clip_ids": ["<bed>"], "shape": "ramp", "start_seconds": 1.0, "end_seconds": 4.95, "db": 6}
add_sfx_tool {"recipe": "riser_tonal", "at_seconds": 5.0, "duration": 4.0, "gain_db": -10}
add_sfx_tool {"recipe": "impact_boom", "at_seconds": 5.0, "gain_db": -6}
add_kinetic_title_tool {"text": "<SHORT LINE>", "position_seconds": 6.5, "duration_seconds": 2.0, "style": "documentary", "animation": "fade", "emphasis": "none", "text_size": 0.045, "background": "#000000", "stagger_seconds": 0}
add_sfx_tool {"recipe": "sub_drop", "kit": "synth", "at_seconds": 6.5, "gain_db": -8}
master_audio_tool {"target_lufs": -16, "true_peak_dbtp": -1.5, "balance": "keep"}
```

The black is simply nothing on any track from 5.0 to 6.5 s; the bed clip
ends on the smash frame. No missing tool: blend modes (`composite`) ship.

## Timing & taste rules

- Hold the face 5-6 s with no cut; the ramp is 4-4.5 s of it.
- Alpha 0 to 1 with `ease_in_quad`: the first 2 s are a faint glow, the
  last second is the burn. A linear ramp shows the stock edges early.
- Fire scales 1.0 to 1.2 over the ramp, the face 1.0 to 1.08: two
  speeds give depth.
- Smash on the fire's brightest frame (measure YAVG per 0.5 s with
  ffmpeg signalstats if unsure). Black holds 1.2-1.8 s, then a small card.
- Desaturate the face (saturation 0.6) so the fire is the only warm thing.

## Sound for it

The bed builds under the ramp (+6 dB `ramp`, about -25 to -18 LUFS
short-term), a tonal riser (-10 dB) ends on the smash, one boom on the cut
frame (hero, momentary about -10 LUFS), then nothing: bed and riser end on
the same frame. A sub drop on the card re-opens the sound.

## Common mistakes

- The fire peaks and dies before the smash (the stock clip's own end).
- Normal blend at alpha 1 hides the face; screen keeps it reading through.
- A whoosh or reverb tail running into the black; silence must be real.
- Boosting the bed with `set_audio_gain_tool` and then ramping it: the
  ramp hits the volume ceiling (+2.3 dB) and the tool warns. Keep the
  ramp within the headroom or boost less.

## Verified

2026-10-28. 8.5 s at 1280x720/24: Pexels face in a light slit plus a
fireball on black (0.0-3.6 s retimed to 4.5 s, 0.796x), screen blend,
smash to black at 5.0 s, card at 6.5 s. Contact sheet: glow from 1.5 s,
fire fills the right half by 4 s, peak on the last frame before black.
The first build used the clip's 0.3-4.8 s window and the fire burned out
before the smash; the retimed peak window fixed it. Judge 6.36/10
(structure 8, ending 7): "builds tension with a classic crescendo and
hard smash cut into silence"; its fixes were a warm grade on the face as
the fire rises and grain on the card. Artifacts:
`~/zenvi-motion/fleet/artifacts/sk4-cinematic-story/techniques/fire-superimposition-ramp.*`.
