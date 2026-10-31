---
id: telephoto-scale-jump-with-riser-to-hit
kind: technique
summary: "For a travel montage's chapter turn: a wide pushes into one tower as a riser builds, a hit lands on the cut in."
categories: [travel-cinematic-montage]
tools: [add_clip_to_timeline_tool, set_clip_properties_tool, set_keyframes_tool, apply_fx_tool, unify_grade_tool, color_grade_clip_tool, add_sfx_tool, automate_volume_tool, fade_clip_tool, master_audio_tool]
pace: fast
mood: [epic, energetic, awe]
aspect: ["16:9", "2.39:1"]
pairs_with: [zoom-through-scene-chain, scale-jump-cut-on-sub-bass-hit, beat-staggered-tile-and-slice-build, tighten-then-release-into-held-payoff]
avoid_with: [vector-switch-chapters, held-orbit-or-ascending-reveal]
needs: [stills-hyperlapse-zoom]
---

# Telephoto scale jump with riser-to-hit

## What it is

A wide aerial or skyline shot zooms in (accelerating) toward one building
for 4-7 s while a riser builds; on the riser's peak the film hard-cuts to
that building, or an interior, at close scale, and a hit or sub drop lands
on the cut. It turns a change of place into one continuous plunge.

## Build it in Zenvi

There is no optical zoom: the push is a digital scale keyframe, so the wide
must be high resolution (see rules). Keep the target centred as it grows
with `location = -(target - 0.5) * scale` (target as 0-1 of the frame).

```json
add_clip_to_timeline_tool {"file_id": "<skyline wide>", "position_seconds": 0, "start_seconds": 3, "end_seconds": 7.5, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<tower close>", "position_seconds": 4.5, "start_seconds": 6, "end_seconds": 9, "track": "1"}
set_clip_properties_tool {"scope": "all", "properties": {"scale": "Crop", "volume": 0}}
set_keyframes_tool {"timeline_clip_id": "<wide>", "property": "scale_x", "points": [{"timeline_seconds": 0, "value": 1}, {"timeline_seconds": 4.5, "value": 2.5}], "ease": "ease_in_quart"}
set_keyframes_tool {"timeline_clip_id": "<wide>", "property": "scale_y", "points": [{"timeline_seconds": 0, "value": 1}, {"timeline_seconds": 4.5, "value": 2.5}], "ease": "ease_in_quart"}
set_keyframes_tool {"timeline_clip_id": "<wide>", "property": "location_x", "points": [{"timeline_seconds": 0, "value": 0}, {"timeline_seconds": 4.5, "value": -0.3}], "ease": "ease_in_quart"}
set_keyframes_tool {"timeline_clip_id": "<wide>", "property": "location_y", "points": [{"timeline_seconds": 0, "value": 0}, {"timeline_seconds": 4.5, "value": 0.25}], "ease": "ease_in_quart"}
apply_fx_tool {"clip_id": "<wide>", "effects": [{"effect": "radial_blur", "amount": 0.6, "params": {"center_x": 0.5, "center_y": 0.45}, "start": 4.1, "end": 4.5}]}
set_keyframes_tool {"timeline_clip_id": "<tower>", "property": "scale_x", "points": [{"timeline_seconds": 4.5, "value": 1.06}, {"timeline_seconds": 7.5, "value": 1.0}], "ease": "ease_out_cubic"}
set_keyframes_tool {"timeline_clip_id": "<tower>", "property": "scale_y", "points": [{"timeline_seconds": 4.5, "value": 1.06}, {"timeline_seconds": 7.5, "value": 1.0}], "ease": "ease_out_cubic"}
unify_grade_tool {"look": "warm_cinema", "look_intensity": 0.4}
color_grade_clip_tool {"timeline_clip_ids": ["<tower>"], "temperature": -0.15, "exposure": -0.3, "saturation": 0.8, "highlights": -0.2}
add_clip_to_timeline_tool {"file_id": "<music bed>", "position_seconds": 0, "start_seconds": 0.836, "end_seconds": 8.336, "track": "5"}
add_sfx_tool {"recipe": "riser_noise", "at_seconds": 4.5, "duration": 2.5, "gain_db": -14}
add_sfx_tool {"recipe": "impact_thud", "at_seconds": 4.5, "gain_db": -8}
add_sfx_tool {"recipe": "sub_drop", "kit": "synth", "at_seconds": 4.5, "gain_db": -8}
automate_volume_tool {"clip_ids": ["<bed>"], "shape": "suck_out", "at_seconds": 4.5}
master_audio_tool {"target_lufs": -16, "true_peak_dbtp": -1.5, "balance": "keep"}
```

Missing: `stills-hyperlapse-zoom` (a true multi-plate or stills zoom with
detail at every scale). Fallback: shoot or source the wide at 4K+ and keep
the digital push at or under 2x the delivery size; or start the push on a
real drone push-in so only the last 1.5x is digital.

## Timing & taste rules

- Push 4-7 s, scale 1 to 2-2.5. Easing: `ease_in_quart`. `ease_in_expo`
  holds still for 3.5 s and then jumps; `ease_in_cubic` reads as linear.
- Source pixels: final crop must be at least the delivery width. A 960 px
  wide source pushed 2.5x is about 380 px of picture: visibly pixelated.
- Same time of day and light on both sides of the cut (dusk into dusk);
  grade the second shot toward the first (exposure, temperature).
- Zoom blur only on the last 0.3-0.5 s, centred on the target.
- The landing shot holds 2.5-4 s with a slight settle (1.06 to 1.0), not a
  cut to black.

## Sound for it

Riser 2-3 s ending exactly on the cut (`at_seconds` is the cut), -14 dB,
under the bed until the last second. A 200 ms `suck_out` on the bed before
the hit, then a thud plus synth sub (hero, momentary about -10 LUFS, 0 to
+3 LU over the bed) on the cut frame, and let the sub ring 1-2 s.

## Common mistakes

- Pushing low-resolution stock: the plunge turns to mush.
- Day wide into a night interior (or the reverse) with no grade bridge.
- Riser ending before or after the cut; the hit must be on the cut frame.
- Using it more than about 3 times in 60 s.

## Verified

2026-10-28. 7.5 s at 1280x720/24: Pexels dusk skyline wide pushed 1 to 2.5
over 4.5 s into a midday towers aerial, riser, suck-out, thud + sub on the
cut. Judge 3.55/10 (cubic ease, no grade match), then 3.73/10 with
`ease_in_quart`, a grade match and the radial blur. Both passes: the
sound timing worked ("riser into an impact hit establishes the concept"),
but the picture pixelated because the bench clips are 960x506 previews,
and dusk-vs-midday still mismatched; first try with `ease_in_expo` showed
no visible push until the last 0.5 s. Artifacts:
`~/zenvi-motion/fleet/artifacts/sk4-cinematic-story/techniques/telephoto-scale-jump-with-riser-to-hit.*`.
