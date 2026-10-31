---
id: cin-cl-key-light-edge-hairline
kind: technique
summary: "When dark cards melt into black: a hairline edge, bright on the key-light side, fades to nothing opposite."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_type_block_tool, add_shape_mask_tool, copy_clip_keyframes_tool]
pace: calm
mood: [refined, dimensional, dark]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-tilt-linked-sheen, cin-cl-one-hue-light-ramp, shot-tilted-plane-glide]
avoid_with: [cin-cl-rim-light-sweep]
needs: [rotation-linked-edge-angle]
drawn: cinetic
---

# Key-light edge hairline

cinetic `cl-key-light-edge-hairline` · Colour and light · workhorse · energy calm · formats launch, feature, walkthrough, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Every card, device bezel and bevelled shape on a dark stage carries a hairline edge that is bright on the side facing one fixed key light and fades to nothing on the far side, so surfaces separate from black without shadows or halos.

Use when: Dark UI films with flat cards, panels, device bezels or bevelled brand shapes on near-black, where a drop shadow disappears and a glow is off-limits.

## Build it in Zenvi

1. The card on a near-black stage, e.g. `add_motion_block_tool {"block": "data_table", "position_seconds": 0, "duration_seconds": 6, "params": {"title": "Pipeline", "columns": ["Name", "Status"], "rows": ["Render|Done"], "plate": "solid"}}`.
2. Draw its outline as a white 1.5 px hairline: `add_type_block_tool {"block": "write_on", "paths": ["M 120 80 H 1800 Q 1840 80 1840 120 V 960 Q 1840 1000 1800 1000 H 120 Q 80 1000 80 960 V 120 Q 80 80 120 80 Z"], "view_box": "0 0 1920 1080", "stroke_width": 1.5, "ink": "#ffffff", "position_seconds": 0.2, "duration_seconds": 0.4}` then fade the clip to 0.4 alpha.
3. Light only the top-left, fading to nothing by 65 % of the way across: `add_shape_mask_tool {"clip_ids": ["<outline>"], "shape": "polygon", "points": [{"x": 0, "y": 0}, {"x": 0.65, "y": 0}, {"x": 0, "y": 0.65}], "feather": 0.3}` (alpha 0.40 at the corner, 0.10 at 35 %).
4. When the card tilts or lands, ride its own move: copy the card's `scale_x`/`location_y` keyframes to the outline with `copy_clip_keyframes_tool {"source_clip_id": "<card>", "timeline_clip_ids": ["<outline>"]}`.

Fallback: The lit side is fixed by the mask; it does not rotate with the object (cinetic recomputes the angle every frame as the light direction minus the object's rotation). On turning objects keep tilt under about 15 degrees or drop the hairline once it spins.

## Timing & taste rules

- cinetic's timing (60 fps): Static styling with no clock of its own: it rides every entrance and move of its surface. Lit-edge alpha is 0.40 at the light corner, 0.10 at 35% of the gradient line and 0 by 65%. The inner top highlight is 0.06. The angle is recomputed every frame as LIGHT - rotateZ. Tilt gain is 0.04 per degree, clamped to 0.6-1.4x. On a tilt resolve (for example rotateX 25 deg to 0 over 68 f (1.13 s) on ease_out_expo), the edge brightness settles on the same curve.
- One light direction for the whole film (top-left, 135 degrees) shared with the tilt sheen.
- Lit-edge alpha 0.40 at the light corner, 0.10 at 35 % of the gradient line, 0 by 65 %; inner top highlight 0.06.
- Edge brightens about 4 % per degree turned toward the light, clamped to 0.6-1.4x.
- No blur and no outer halo; on light stages use a 1.5 px white top edge and a faint bottom line instead.
- Facet fills of bevelled marks stay within 2-4 % luma of the stage.

## Sound for it

None; static styling.

## Common mistakes

- Light-mode shots, where a white hairline vanishes on paper.
- Putting it on cards that already carry the travelling rim streak.
- Dense layouts where every lit edge turns the frame into wireframe noise.
- Avoid when: Light-mode shots, where a white hairline vanishes on paper. Also avoid it on cards that already carry cl-rim-light-sweep's travelling streak, and on layouts so dense that every lit edge turns the frame into wireframe noise.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-key-light-edge-hairline`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
