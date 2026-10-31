---
id: cin-pd-pin-field-pullback
kind: technique
summary: "When coverage is the claim, a map pulls back to reveal dropping pins, then a card grows from the picked one."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, add_emoji_tool, set_clip_properties_tool, add_type_block_tool, add_title_tool, add_sfx_tool]
pace: medium
mood: [expansive, clear, product]
aspect: ["16:9", "1:1", "9:16"]
pairs_with: [t070, shot-source-hub-connect, cin-ui-anchor-point-spawn]
avoid_with: [cinematic-push-in]
needs: []
drawn: cinetic
---

# Pin field pull-back

cinetic `pd-pin-field-pullback` · Product demo · accent · energy medium · formats feature, launch, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A map pulls back from a close view to reveal a field of location pins that drop in as accent marks and relax to ink, then a card grows out of the pin the cursor picks.

Use when: Location, coverage, store-finder or delivery features; any everywhere claim backed by real places.

## Build it in Zenvi

1. Map as a clip: `add_clip_to_timeline_tool {"file_id": "<map>", "position_seconds": 0.0, "duration_seconds": 5.0, "track": "1"}` (or a `geo_map` block). Pull back from 2.2x to 1 over 50 f (0.83 s) about the focus point: `set_keyframes_tool {"timeline_clip_id": "<map>", "property": "scale_x", "points": [{"seconds": 0.0, "value": 2.2}, {"seconds": 0.83, "value": 1.0, "ease": "ease_out_cubic"}]}` (same for scale_y; set `origin_x`/`origin_y` at the focus).
2. Pins: `add_emoji_tool {"emoji": "round pushpin", "size": 0.04, "position_seconds": <t_i>, "duration_seconds": 4.0, "track": "<n>"}` for 6-12 pins, placed on the map with `set_clip_properties_tool`, `origin_y` at the pin base. Each pops scale 0 to 1 with `location_y` -12 px (0.011) to 0 over about 11 f (0.18 s) on `ease_out_cubic` (no visible overshoot: a field of pins is not a landing), staggered so the whole group lands within 30 f (0.5 s), 2-6 f (0.03-0.1 s) apart. Pin in the accent first, then crossfade to an ink pin over 24 f (0.4 s).
3. The cursor clicks one pin; its card grows from the pin tip, scale 0.6 to 1 over 12 f (0.2 s) on `ease_out_expo` with `origin` at the pin; the leader line draws over 8 f (0.13 s): `add_type_block_tool {"block": "write_on", "paths": ["M0 0 L1 0"], "duration_seconds": 0.4, "draw_seconds": 0.13}`; the label slides 25 px (0.023) over 12 f (0.2 s) on `ease_out_expo`: `add_title_tool {"text": "<place>", "position_seconds": <click>, "duration_seconds": 2.0, "fade_in_seconds": 0.13}`.
4. Camera keeps moving (the pull-back easing out) while the pins land; do not cut.
5. `add_sfx_tool {"recipe": "pop", "at_seconds": <t_i>, "gain_db": -26}` for the first, middle and last pin only.

## Timing & taste rules

- cinetic's timing (60 fps): Pull 50 f (0.83 s) on ease_out_cubic (first frame ≈ −7% scale per frame); pins ≈ 11 f (0.18 s) each on ease_out_cubic, the group within 30 f (2-6 f (0.10 s) apart); colour relax 24 f (0.40 s); card 12 f (0.20 s), leader 8 f (0.13 s), label 12 f (0.20 s).
- Pull-back 50 f (0.83 s) on ease_out_cubic, 2.2x to 1 (first frame about 7 % scale per frame).
- Pins about 11 f (0.18 s) each, the whole group inside 30 f (0.5 s), landing in accent and relaxing to ink over 24 f (0.4 s).
- Card 12 f (0.2 s), leader line 8 f (0.13 s), label slide 12 f (0.2 s).
- At least five pins, and the map style quiet enough that they read.

## Sound for it

Three soft pops (-26 dB) on the first, middle and last pin and a ui_tap at -22 dB on the click; one per pin would rattle.

## Common mistakes

- Fewer than about five locations, so there is no field to reveal.
- A map style so busy it hides the pins.
- A route arc already run on the same map.
- Avoid when: Fewer than about five locations; a map style busy enough to hide the pins; a route arc has already run on the same map.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`pd-pin-field-pullback`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
