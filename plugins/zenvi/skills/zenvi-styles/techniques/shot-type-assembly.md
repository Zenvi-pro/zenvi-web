---
id: shot-type-assembly
kind: technique
summary: "When a brand or title name should arrive like a ritual: letters drift in blurred from all sides and lock one by one."
categories: [kinetic-type-motion-design, brand-story-corporate, product-launch-film, movie-game-trailer, fashion-beauty-ad]
tools: [add_kinetic_title_tool, get_clip_properties_tool, set_keyframes_tool, add_effect_tool, add_sfx_tool]
pace: medium
mood: [ceremonial, premium, mysterious]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-3d-title, kinetic-title-sequence, shot-blur-slide]
avoid_with: [kinetic-letter-cascade, kinetic-word-pop, kinetic-mask-reveal]
needs: []
---

# Drift assembly (letters gather into the title)

## What it is
Letters of a name start scattered 260-360 px away in random directions, turned up to 24 degrees, enlarged and blurred, drift in
staggered and lock in one by one with a short darkening pulse; the finished word breathes once. The motion path itself is the
show: the title is built out of elsewhere rather than changing in place. Brand names and film-style titles.
Two siblings on the same card are already covered: a rise out of a baseline clip (split-text stagger) is kinetic-mask-reveal; letters
flowing along a curve and settling into a title is kinetic-text-on-path.

## Build it in Zenvi
`animation: "letters"` makes every letter its own native clip (the receipt lists `created_clip_ids` and the word's `box`); then each
letter gets keyframes from a scattered pose to rest.
```json
add_kinetic_title_tool {"text": "Shotcraft", "style": "editorial", "animation": "fade", "emphasis": "none", "ink": "#111111", "background": "#f4f1ea",
  "text_size": 0.2, "y": 0.5, "position_seconds": 0, "duration_seconds": 4, "stagger_seconds": 0}
(re-run with animation "letters" if the receipt does not list one clip per letter)
set_keyframes_tool {"timeline_clip_id": "<letter i>", "property": "location_x", "ease": "ease_out_cubic", "points": [{"seconds": 0.1, "value": <x0 + dx_i>}, {"seconds": 1.6, "value": <x0>}]}
(location_y with dy_i, rotation from r_i to 0, scale_x / scale_y from 1.22 s0 to s0, alpha from 0.35 to 1 - all on the same 0.1 + 0.1 i s to 1.6 + 0.1 i s window)
add_effect_tool {"timeline_clip_id": "<letter i>", "effect": "Blur", "properties": {"horizontal_radius": [{"time": 0.1, "value": 8}, {"time": 1.6, "value": 0}], "vertical_radius": [same]}}
add_sfx_tool {"recipe": "whoosh_rise", "at_seconds": 0.2, "gain_db": -16}
add_sfx_tool {"recipe": "impact_thud", "at_seconds": 2.7, "gain_db": -12}
```
Pick dx_i, dy_i from a seeded list (direction around the circle, 0.2-0.28 of the frame), r_i within +-24 degrees. If the clip scales from its top-left corner
(it does, for titles) compensate position with the scale, as in shot-lead-word-zoom-assemble. Lock pulse: darken the letter's ink and a 3 px outline 8 frames at its arrival.

## Timing & taste rules
- Each letter drifts 45 frames (1.5 s) on one ease-out cubic shared by position, rotation, depth scale, blur (8 px to 0) and opacity (0.35 to 1); separate curves leave a letter "arrived but still soft".
- Stagger 3 frames (0.1 s) between letters; a nine-letter word takes about 2.2 s to complete.
- Lock pulse 8 frames; on a light ground use darkening and a thin stroke, never glow. Then the whole word breathes to 1.04 and back.
- Letters in the rest position for the final 30 frames or more: no movement at all.
- The camera must be still while letters fly; no other high-attention move in the same frame.
- One title entrance family per film, two at the very most.

## Sound for it
A soft riser under the drift (-16 dB) ending on a low thud as the last letter locks (-12 dB).

## Common mistakes
- Different curves for the channels; the same offsets for every letter (reads as a single slide).
- Camera move during the flight, or a second big entrance nearby.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/typography/type-assembly-moves.md` (Apache-2.0; see ../NOTICE).
