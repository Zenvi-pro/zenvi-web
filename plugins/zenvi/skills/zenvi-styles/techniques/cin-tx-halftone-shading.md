---
id: cin-tx-halftone-shading
kind: technique
summary: "When a flat mark needs volume without 3D: a one-colour dot field, dots large in shadow, small toward a moving light."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, apply_fx_tool, add_shape_mask_tool]
pace: calm
mood: [print, graphic, dimensional]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [shot-riso-misregistration, cin-tx-dot-matrix-silhouette, cinematic-duotone]
avoid_with: [cin-tx-scanline-transmute]
needs: []
drawn: cinetic
---

# Halftone shading

cinetic `tx-halftone-shading` · Texture and finish · accent · energy calm · formats launch, sting, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A flat hero shape gains volume from a single-colour halftone dot field whose dots swell in the shadow side and shrink toward a slowly moving light.

Use when: Flat marks, icons or objects that need volume without 3D; technical or print-minded brands; alongside other dot-matrix devices.

## Build it in Zenvi

1. The shading source: a soft light-to-dark field that moves slowly, `add_motion_block_tool {"block": "gradient_field", "position_seconds": 0, "duration_seconds": 6, "params": {"style": "orbs", "colors": ["#f4efe6", "#4a4a4a"], "speed": 0.1, "grain": false}}`.
2. Turn it into dots, sized by darkness, 12 px pitch, ink on paper: `apply_fx_tool {"clip_id": "<field>", "effects": [{"effect": "halftone", "amount": 1, "params": {"cell": 12, "ink": "#111111", "paper": "#f4efe6"}}]}`. (Dots under 0.8 px are dropped by the FX so nothing aliases.)
3. Clip it to the shape: `add_shape_mask_tool {"clip_ids": ["<field>"], "shape": "ellipse", "x": 0.5, "y": 0.5, "width": 0.45, "height": 0.45, "feather": 0.003}` (a polygon with `points` for other marks).
4. Reveal as a diagonal wave over 36 f (0.6 s): the mask grows from nothing to the shape, `keyframes` `[{"seconds": 1.0, "grow": -0.5}, {"seconds": 1.6, "grow": 0}]`, or `alpha` 0 to 1 over 0.6 s with ease_out_expo.
5. The light point drifts under 0.5 px per frame (the field's slow `speed`), so the shading breathes while the shape stays the hero.

Fallback: Dots appear as a mask-grown reveal rather than each dot growing from 0 in a diagonal stagger (a 24 f stagger plus 12 f per dot). Keep the reveal at 36 f for the same total.

## Timing & taste rules

- cinetic's timing (60 fps): Reveal 36 f (0.60 s) (a 24 f (0.40 s) diagonal stagger plus 12 f (0.20 s) per dot on ease_out_expo); light point drift under 0.5 px/f; holds as long as the shape stays the hero.
- Dot pitch 12 px at 1080p, radius up to 5.5 px, in ink on paper or white on ink.
- Reveal 36 f (0.6 s): a 24 f (0.4 s) diagonal stagger plus 12 f (0.2 s) per dot on ease_out_expo.
- Light point drift under 0.5 px per frame; holds as long as the shape is the hero.
- Drop dots under 0.8 px so nothing aliases.

## Sound for it

None, or one soft `sparkle` (-18 dB) as the last dots land.

## Common mistakes

- Shapes under about 200 px, where the dots turn to mush.
- Photographic or 3D scenes, or busy UI behind the shape.
- A fast-moving light, which makes the dots swim.
- Avoid when: Shapes under ~200 px, where the dots turn to mush; photographic or 3D scenes; busy UI behind the shape.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tx-halftone-shading`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
