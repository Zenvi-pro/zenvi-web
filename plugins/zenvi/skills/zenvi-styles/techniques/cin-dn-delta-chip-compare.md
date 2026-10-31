---
id: cin-dn-delta-chip-compare
kind: technique
summary: "When a claim is before and after: the old figure steps back small and grey, the new one counts in, a delta chip pops."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_title_tool, add_type_block_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [proof, satisfying]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kinetic-counter, circular-problem-to-proof-bookend]
avoid_with: [cin-dn-count-glyph-swap]
needs: []
drawn: cinetic
---

# Before-to-after with a delta chip

cinetic `dn-delta-chip-compare` · Data and numbers · accent · energy medium · formats launch, feature, vertical, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The old figure steps back to a small grey 'before', the new figure counts in at hero size, and a delta chip ('-38%') pops in the accent on the landing frame.

Use when: Improvements such as cost down, speed up or errors falling from 412 to 3; before-and-after claims.

## Build it in Zenvi

1. Hero count from the old to the new value: `add_motion_block_tool {"block": "counter", "position_seconds": 1.0, "duration_seconds": 3.5, "placement": "full_frame", "params": {"values": ["412", "3"], "label": "errors per week", "style": "count"}}` (the count runs 36 f, 0.6 s, with a quad-out feel).
2. The small "before": `add_title_tool {"text": "412", "template": "Standard_1", "text_color": "#8a8f98", "font_scale": 0.5, "position_seconds": 1.2, "duration_seconds": 3.3, "track": "5"}` rising into the upper-left with `location_y` 0.03 to 0 over 0.5 s `ease_out_expo`, so the two values never crossfade in one place.
3. Strike across it over 10 f (0.17 s): `add_type_block_tool {"block": "write_on", "paths": ["M0 5 H100"], "stroke_width": 2, "ink": "#8a8f98", "width": 0.09, "x": 0.3, "y": 0.22, "draw_seconds": 0.17, "position_seconds": 1.8, "duration_seconds": 2.7}`.
4. On the count's landing frame (about 2.05 s) the chip: `add_title_tool {"text": "-99%", "template": "Standard_1", "text_color": "#ffffff", "background_color": "#00000000", "position_seconds": 2.05, "duration_seconds": 2.45, "track": "6"}` with `scale_x/y` 0.6 to 1 over 0.2 s `ease_out_cubic` from its left edge (`origin_x` 0).
5. `add_sfx_tool {"recipe": "pop", "at_seconds": 2.05, "gain_db": -12}`.

## Timing & taste rules

- cinetic's timing (60 fps): Old figure exits over 12 f (0.20 s) on ease_in_cubic. 'Before' MaskRise 30 f (0.50 s). New count 36 f (0.60 s) on ease_out_cubic. Strike 10 f (0.17 s) on ease_out_expo. Chip on the landing frame (ease_out_cubic, no overshoot), fill relaxes over 20 f (0.33 s). Hold at least 36 f (0.60 s) under a breath.
- Old figure leaves over 12 f (0.2 s) ease_in_cubic, 0.3 em up; "before" rises over 30 f (0.5 s).
- New count 36 f (0.6 s), strike 10 f (0.17 s), chip lands exactly on the count's final frame with no overshoot.
- Chip fill relaxes from accent to a darker tone with accent text over 20 f (0.33 s).
- Hold at least 36 f (0.6 s) under a breath.

## Sound for it

One pop at -12 dB on the chip landing; the count ticks come from the block.

## Common mistakes

- A small or noisy change that does not deserve a delta chip.
- A story with no real before state to show.
- Crossfading the two values in one place.
- Avoid when: The change is small or noisy; the story has no real 'before' state to show.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`dn-delta-chip-compare`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
