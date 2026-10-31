---
id: cin-tx-surface-edge-finish
kind: technique
summary: "When any card or window floats: a 1 px edge plus one soft key shadow (or a top highlight on ink) makes it physical."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [apply_look_preset_tool, add_type_block_tool, add_shape_mask_tool, add_title_tool, set_keyframes_tool]
pace: calm
mood: [physical, clean, dimensional]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-key-light-edge-hairline, shot-contact-shadow-lift, cin-tx-gobo-studio-shadows]
avoid_with: [cin-cl-rim-light-sweep, cin-cl-hue-tinted-shadow]
needs: []
drawn: cinetic
---

# Hairline edge and key shadow

cinetic `tx-surface-edge-finish` · Texture and finish · workhorse · energy any · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Every floating surface gets a 1 px edge plus one soft key shadow on paper, or a top inner highlight on ink, so flat UI reads as a physical object in a lit space.

Use when: Any floating card, panel, modal or window, in every format.

## Build it in Zenvi

1. Paper stage: the card gets the soft shadow and a faint light border: `apply_look_preset_tool {"timeline_clip_id": "<card>", "look": "shadow_soft"}` (about 0 30 px 60 px at 12 %). Optionally under it a tight contact line from `shadow_subtle` on a duplicate.
2. Ink stage: no shadow; the card sits one luminance step above the stage (a data_table block with `plate: "solid"`), plus a top highlight: draw its outline in white at alpha 0.08 (`add_type_block_tool {"block": "write_on", "paths": ["<rounded-rect path>"], "stroke_width": 1, "ink": "#ffffff", "duration_seconds": 0.4}` masked to the top edge with `add_shape_mask_tool {"shape": "rectangle", "y": 0.05, "height": 0.1, "feather": 0.1}`).
3. When a card lifts, let the shadow follow: a soft dark ellipse clip under it (`add_title_tool` black at alpha 0.2 + `add_shape_mask_tool` ellipse) with `set_keyframes_tool` `location_y` 0 to 0.015 and `alpha` 0.20 to 0.10 over 14 f (0.23 s, ease_out_expo); on the drop reverse it over 10 f (0.17 s, ease_in_cubic).

Fallback: The shadow does not grow continuously with the card's height; the ellipse follows lift in two steps (rest, lifted). Keep lifts to a single 0-120 px move.

## Timing & taste rules

- cinetic's timing (60 fps): Static finish; shadow and highlight follow the element's z and tilt every frame (lift 14 f (0.23 s) on ease_out_expo, drop 10 f (0.17 s) on ease_in_cubic); highlight alpha changes by at most 0.04 over a tilt.
- Paper: 1 px line border, 0 30 px 60 px shadow at 12 %, optionally a tight 0 1 px 2 px contact at 6 %.
- Ink: no shadow, a card fill one luminance step above the stage, 1 px border, 8 % top highlight (12 % when a panel tilts).
- Lift 14 f (0.23 s, ease_out_expo), drop 10 f (0.17 s, ease_in_cubic); highlight alpha changes by at most 0.04 over a tilt.
- Every floating surface in the film gets the same finish.

## Sound for it

None.

## Common mistakes

- Flush full-bleed UI or gutterless grids whose cells should merge into one canvas.
- Swapping the finish for a glass panel or a coloured halo.
- Different shadow strengths on different cards.
- Avoid when: Flush full-bleed UI or gutterless grids whose cells should merge into one canvas; anything tempting a glass panel or a coloured halo instead.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tx-surface-edge-finish`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
