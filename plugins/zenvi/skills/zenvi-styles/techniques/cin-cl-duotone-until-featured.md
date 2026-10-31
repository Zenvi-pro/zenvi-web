---
id: cin-cl-duotone-until-featured
kind: technique
summary: "When one item of a grid is the subject at a time: all stay two-tone until their beat, then colour irises out."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [color_grade_clip_tool, duplicate_clips_tool, add_shape_mask_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [curated, selective, graphic]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-context-palette-shift, shot-bento-light-up, shot-icon-field-colorize]
avoid_with: [cin-cl-mono-one-accent, cinematic-duotone]
needs: []
drawn: cinetic
---

# Duotone until featured

cinetic `cl-duotone-until-featured` · Colour and light · accent · energy medium · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Screenshots and photos sit in a two-tone grade until their beat. Then full colour opens out from the point of interaction, and the previous item returns to duotone.

Use when: Grids of integrations, galleries, template pickers, and multi-cell layouts where one item at a time is the subject.

## Build it in Zenvi

1. Two-tone every media layer in the grid: `color_grade_clip_tool {"timeline_clip_ids": ["<tile_1>", "<tile_2>", "<tile_3>", "<tile_4>"], "look": "black_and_white", "contrast": 0.1}`.
2. For the featured tile, a full-colour copy above it: `duplicate_clips_tool {"timeline_clip_ids": ["<tile_2>"], "to_track": "<above>"}` then `color_grade_clip_tool {"timeline_clip_id": "<copy>", "reset": true}`.
3. Iris the colour out from the interaction point (click at 0.62, 0.40) over 18 f (0.3 s): `add_shape_mask_tool {"clip_ids": ["<copy>"], "shape": "ellipse", "x": 0.62, "y": 0.4, "width": 0.4, "height": 0.4, "feather": 0.02, "keyframes": [{"seconds": 2.0, "grow": -1}, {"seconds": 2.3, "grow": 1.5}]}`.
4. When focus moves on, return the tile to two-tone over 20 f (0.33 s): `set_keyframes_tool {"timeline_clip_id": "<copy>", "property": "alpha", "points": [{"seconds": 4.0, "value": 1}, {"seconds": 4.33, "value": 0, "ease": "ease_in_out_sine"}]}`. Only one tile is ever in colour; on a cut, swap copies in 0 f.
5. `add_sfx_tool {"recipe": "pop", "at_seconds": 2.0, "gain_db": -16}` on the click.

## Timing & taste rules

- cinetic's timing (60 fps): The colour iris takes 18 f (0.30 s) on ease_out_expo from the interaction point. The return to duotone takes 20 f (0.33 s) on ease_in_out_sine. A swap on a cut takes 0 f (0.00 s).
- Colour iris 18 f (0.3 s, ease_out_expo) from the interaction point to 150 % of the tile.
- Return to two-tone 20 f (0.33 s, ease_in_out_sine); on a cut the swap is 0 f.
- Exactly one tile in full colour at any time.
- Branded duotone: shadows to ink, highlights to a pale tint of the accent.

## Sound for it

One soft `pop` or `ui_tap` (-16 dB) on the click that starts the iris; the return to two-tone is silent.

## Common mistakes

- Only one hero screenshot on screen: there is nothing to contrast with.
- A product whose colourful UI is the selling point in every frame.
- Two tiles in colour at once, which breaks the one-subject rule.
- Avoid when: Only one hero screenshot is on screen (nothing to contrast with), or the UI's colours are its selling point in every frame.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-duotone-until-featured`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
