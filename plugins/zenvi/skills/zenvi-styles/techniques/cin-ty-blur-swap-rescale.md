---
id: cin-ty-blur-swap-rescale
kind: technique
summary: "When a giant word must become the full sentence: it blurs out and re-forms smaller with no rubbery size tween."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [sharp, continuous]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-ty-oversize-blur-slide-in, kinetic-emphasis-scale]
avoid_with: [cin-ty-staggered-word-roll]
needs: []
drawn: cinetic
---

# Blur-swap rescale

cinetic `ty-blur-swap-rescale` · Typography in motion · workhorse · energy medium · formats launch, feature, sting, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A big word blurs out and instantly re-forms smaller as the start of the full line, so the type changes scale without a rubbery size tween.

Use when: Going from one or two giant words to the full readable sentence; right after tr-giant-word-punch-out; any big-to-small type handoff inside one continuous take.

## Build it in Zenvi

1. Old layer: `add_kinetic_title_tool {"text": "SHIP", "style": "stack", "animation": "slam", "text_size": 0.28, "position_seconds": 1.0, "duration_seconds": 1.3}`.
2. New layer from 0.033 s before the old one ends: `add_kinetic_title_tool {"text": "Ship the film today.", "style": "editorial", "animation": "fade", "text_size": 0.09, "position_seconds": 2.23, "duration_seconds": 2.5}`. Never scale one font: two clips.
3. Old out over 6 f (0.1 s): `set_keyframes_tool {"timeline_clip_id": "<old>", "property": "scale_x", "ease": "ease_in_cubic", "points": [{"seconds": 2.2, "value": 1.0}, {"seconds": 2.3, "value": 0.85}]}` (same on `scale_y`) and `alpha` 1 to 0.
4. New in over 14 f (0.23 s): `scale_x/y` 1.25 to 1 `ease_out_expo`, `alpha` 0 to 1 over 0.1 s.
5. `apply_fx_tool` blur: `{"clip_id": "<old>", "effects": [{"effect": "directional_blur", "amount": 0.5, "start": 2.2, "end": 2.3}]}` and on the new layer for its first 0.1 s.

## Timing & taste rules

- cinetic's timing (60 fps): Old out 6 f (0.10 s) (ease_in_cubic, blurOut 12 px); new in 14 f (0.23 s) from +2 f (0.03 s) (ease_out_expo, blurIn 12 px, scale 1.25 -> 1, edges of a 1000 px line about 51 px/f on frame 1); 4 f (0.07 s) overlap; typical cap-height change -35%; tracking collapse 16 f (0.27 s) ease_out_expo.
- Old layer out 6 f (0.1 s) ease_in_cubic, blur to 12 px, scale 1 to 0.85; new layer in 14 f (0.23 s) ease_out_expo from 1.25x, blur 12 px to 0.
- The layers overlap by 4 f (0.07 s); more than 10 f (0.17 s) reads as a dissolve.
- Typical cap-height change is -35 %; carry any drift so both layers move at the same px/f.
- Optional tracking collapse: letter spacing +0.25 em to normal over 16 f (0.27 s).

## Sound for it

One hit_transient at -14 dB on the frame the new line is readable, or none.

## Common mistakes

- Using it as a default between unrelated lines; it is not a crossfade substitute.
- Small-to-small swaps, where the scale change is invisible.
- Overlaps over 10 f, which read as a dissolve.
- Avoid when: As a default between unrelated lines (it is not a crossfade substitute); small-to-small swaps; overlaps longer than 10 f, which read as a dissolve.

## Verified

2026-10-31, `~/zenvi-motion/fleet/artifacts/x2-cinetic/verify/cin-ty-blur-swap-rescale.mp4` (1280x720p60, stack SHIP (slam, 1.0-2.3 s) swapped for the editorial line Ship the film today. (stagger 0, 2.23 s) over a flat card: old scale 1 to 0.85 plus alpha 1 to 0 and Blur 0 to 12 over 2.2-2.3 s, new four word-clips scale 1.25 to 1 about the line centre ease_out_expo over 0.23 s with alpha over 0.1 s and Blur 12 to 0): SHIP is gone by 2.30 s and the sentence appears at 2.30 s oversize and soft and is settled by 2.38-2.47 s, a swap rather than a dissolve; watch judge 3.0/10 (stand-in background).

Found when rendering it (apply before building):

- Step 5: apply_fx_tool refuses title clips (Error: clip ... is not video footage; FX render video clips). Blur a title with add_effect_tool {"timeline_clip_ids": [<every word clip>], "effect": "Blur", "properties": {"horizontal_radius": [{"time": 2.2, "value": 0, "interpolation": "linear"}, {"time": 2.3, "value": 12, "interpolation": "linear"}], "vertical_radius": <same>}} (times are timeline seconds; the new layer runs 12 to 0).
- Step 2: add stagger_seconds 0 to the new line, otherwise its words (one clip each, g0w0-g0w3) enter 0.12 s apart and the swap is not one layer.
- Steps 3-4: a title is one clip per word, each placed by absolute location_x/location_y (gravity Top Left) and scaled about its own top-left corner. Scaling the clips to 0.85 / 1.25 would scatter the words. For each word keyframe scale_x/scale_y to S*f and location_x/location_y to C + f*(loc - C), where C is the pivot (the word's own centre loc + S/2 for a one-word layer, the line centre such as (0.5, 0.70) for a phrase). Read base values with get_clip_properties_tool (SHIP: scale 0.6705 at 0.0143, 0.1533; words: scale 0.12-0.14 at y 0.6704).
- Steps 3-4: points need timeline_seconds (seconds count from the clip start), and mode replace_range so the baked slam/fade keyframes outside the window survive.
- Step 3: ease_in_cubic over 0.1 s moves almost nothing in the first 0.05 s (about 1 % of the 0.85 shrink at 2.22 s), so the old layer reads mostly as a fade plus blur; use ease_in_quad if the shrink must be seen.

Translated from cinetic's technique library (`ty-blur-swap-rescale`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
