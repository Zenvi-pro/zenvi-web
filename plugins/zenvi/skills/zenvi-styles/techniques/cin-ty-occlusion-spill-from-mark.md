---
id: cin-ty-occlusion-spill-from-mark
kind: technique
summary: "When an icon should deliver the message: the mark slides aside and the words shoot out from behind it."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_title_tool, add_shape_mask_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [slick, purposeful]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [shot-type-to-pill, kinetic-lower-third]
avoid_with: [cin-le-mark-slide-name-follow]
needs: [edge-following-reveal-mask]
drawn: cinetic
---

# Words spill out from behind a mark

cinetic `ty-occlusion-spill-from-mark` · Typography in motion · workhorse · energy medium · formats launch, feature, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A glyph or icon slides aside and the words shoot out from behind it, clipped at its edge, as if the mark were delivering the message.

Use when: An icon-led claim mid-film, or an opening line pushed out by the mark already in motion; a feature icon that introduces its own line; a mark or number that says the sentence.

## Build it in Zenvi

1. Words: `add_title_tool {"text": "Sync across every device", "template": "Standard_1", "position_seconds": 2.0, "duration_seconds": 2.5, "track": "3"}`; mark on top: `add_clip_to_timeline_tool {"file_id": "<logo>", "position_seconds": 2.0, "duration_seconds": 2.5, "track": "4"}`.
2. Mask the words at the mark's moving edge: `add_shape_mask_tool {"clip_ids": ["<words>"], "shape": "rectangle", "x": 0.6, "y": 0.5, "width": 0.7, "height": 0.2, "feather": 0, "keyframes": [{"seconds": 2.0, "grow": -0.7}, {"seconds": 2.33, "grow": 0}]}`, so only what has cleared the mark shows.
3. Mark: `set_keyframes_tool {"timeline_clip_id": "<mark>", "property": "location_x", "ease": "ease_out_expo", "points": [{"seconds": 2.0, "value": 0}, {"seconds": 2.33, "value": 0.135}]}` (260 px over 20 f).
4. Words: `location_x` +0.167 to 0 over 24 f (0.4 s), starting 1 f after the mark, `ease_out_expo`, `alpha` 0 to 1 over 0.1 s, then `apply_fx_tool` directional_blur on the first 0.1 s.
5. `add_sfx_tool {"recipe": "whoosh_short", "at_seconds": 2.0, "gain_db": -14}`.

Fallback: If the mask will not follow the mark edge, fade the words in at 20 % of frame offset behind the mark with the mark on a higher track; the occlusion is faked by track order only.

## Timing & taste rules

- cinetic's timing (60 fps): Mark 260 px over 20 f (0.33 s) ease_out_expo (peak about 73 px/f, blurred master); words 320 px over 24 f (0.40 s) ease_out_expo (76 px/f on frame 1, under 20 by frame 6), 1 f (0.02 s) after the mark; opacity 6 f (0.10 s); hold at least 54 f (0.90 s) with a drift.
- Mark 260 px over 20 f (0.33 s) ease_out_expo, peak about 73 px/f; words 320 px over 24 f (0.4 s), 1 f later, readable once under 20 px/f around f6 (0.1 s).
- Opacity 0 to 1 over 6 f (0.1 s); hold at least 54 f (0.9 s) with a drift.
- The mark must be at least as tall as the cap height or there is nothing to hide behind.
- Keep spills under about 360 px (0.19 of width).

## Sound for it

One whoosh_short at the mark moving, -14 dB; the words get none.

## Common mistakes

- Using it for the end lockup, which belongs to the end card.
- Marks smaller than the cap height.
- Spills longer than about 360 px.
- Avoid when: The end lockup (it appears once and belongs to the end card); marks smaller than the cap height (nothing to hide behind); spills longer than about 360 px.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ty-occlusion-spill-from-mark`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
