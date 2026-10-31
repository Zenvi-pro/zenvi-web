---
id: cin-cl-living-stage
kind: technique
summary: "When a card or end card would sit still over 1.5 s: soft pools of colour behind it breathe or drift slowly."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_title_tool, add_motion_block_tool, set_keyframes_tool, apply_look_preset_tool]
pace: calm
mood: [alive, subtle, ambient]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-one-hue-light-ramp, cin-tx-global-grain, shot-gradient-type-shift]
avoid_with: [cin-cl-mono-one-accent, shot-spotlight-hero-card]
needs: []
drawn: cinetic
---

# Living gradient stage

cinetic `cl-living-stage` · Colour and light · accent · energy calm · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Behind static cards the background never freezes: soft pools of colour at the corners breathe in brightness or drift slowly, like light through water.

Use when: Holds, end cards and statement cards that would otherwise sit still for more than 48 f.

## Build it in Zenvi

1. Flat stage for UI beats: `add_title_tool {"text": " ", "background_color": "#0b0c0f", "position_seconds": 0, "duration_seconds": 10, "track": "1"}`.
2. The living stage, dark tints of one allowed hue (never violet, warm brown or a multi-hue mesh): `add_motion_block_tool {"block": "gradient_field", "position_seconds": 6.0, "duration_seconds": 4, "params": {"style": "orbs", "colors": ["#12233a", "#1a3350"], "speed": 0.15, "dots": false, "grain": true}, "track": "2"}`.
3. Brand beats raise it, UI beats drop back to flat ink: `set_keyframes_tool {"timeline_clip_id": "<living_stage>", "property": "alpha", "points": [{"seconds": 6.0, "value": 0}, {"seconds": 6.83, "value": 1, "ease": "ease_out_expo"}, {"seconds": 9.87, "value": 1}, {"seconds": 10.0, "value": 0, "ease": "ease_in_cubic"}]}` (rise 50 f = 0.83 s, drain 8 f = 0.13 s).
4. Breathe: lay a second copy on track 3 with `alpha` keyframes between 0.85 and 1.0 on a 162 f (2.7 s) period, the second half a period out of phase.
5. Card or type goes on a higher track, and the pools never sit centred behind it. Finish with `apply_look_preset_tool {"look": "film_grain_35mm_fine", "scope": "all"}`.

## Timing & taste rules

- cinetic's timing (60 fps): The breathe period is 162 f (2.70 s). Drift loops run 360-660 f (11.00 s), at under 1 px/f. On brand beats the stage rises over 50 f (0.83 s) on ease_out_expo (translateY +40% to 0) and drains to flat in 8 f (0.13 s).
- Two or three huge pools (radius about 55-60 % of the frame) at the corners, never centred behind type or a card.
- Breathe: opacity 0.85-1.0 on a 162 f (2.7 s) period, no translation (about plus/minus 15 % luma). Drift: centres move plus/minus 6 % of the frame on 360-660 f (6-11 s) loops, under 1 px per frame.
- On brand beats the stage rises over 50 f (0.83 s, ease_out_expo) and drains to flat in 8 f (0.13 s).
- Keep 1.5-2 % grain over it so the gradients do not band.

## Sound for it

None; ambient colour has no sound. A room-tone bed is the music's job.

## Common mistakes

- Busy UI shots where background motion competes; use the flat stage.
- Putting it behind a product window or readable type, where it reads as haze or a generic gradient backdrop; a flat stage with one tonal step is the stronger default.
- Using it on light stages, where the pools read as smudges.
- Avoid when: Busy UI shots where any background motion competes, or films built on a hard flat-stage look. Behind a product window or readable type, where soft pools read as a generic gradient backdrop or as haze; light stages, where they read as smudges. A flat stage with one tonal step is the stronger default.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-living-stage`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
