---
id: cin-tx-gobo-studio-shadows
kind: technique
summary: "When a light-stage UI should feel photographed: huge, very soft diagonal shadows drift across an off-white backdrop."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_title_tool, add_shape_mask_tool, set_keyframes_tool, apply_look_preset_tool]
pace: calm
mood: [airy, studio, tactile]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-tx-surface-edge-finish, cin-cl-hue-tinted-shadow, soft-bloom-lifted-shadow-grade]
avoid_with: [cin-cl-living-stage, cin-tx-global-grain]
needs: []
drawn: cinetic
---

# Gobo-lit studio backdrop

cinetic `tx-gobo-studio-shadows` · Texture and finish · workhorse · energy calm · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The UI floats over an off-white studio backdrop crossed by huge, very soft diagonal shadows, like window light through leaves, so flat screens feel photographed.

Use when: Light-stage product films and walkthroughs that need depth and physicality without glass, colour or a 3D set.

## Build it in Zenvi

1. Cool off-white stage: `add_title_tool {"text": " ", "background_color": "#f7f7f7", "position_seconds": 0, "duration_seconds": 12, "track": "1"}`.
2. Three to five shadow bands, each a black clip masked to a diagonal band and very soft: `add_title_tool {"text": " ", "background_color": "#000000", "position_seconds": 0, "duration_seconds": 12, "track": "2"}` with `add_shape_mask_tool {"clip_ids": ["<band_1>"], "shape": "polygon", "points": [{"x": 0.2, "y": 0}, {"x": 0.45, "y": 0}, {"x": 0.25, "y": 1}, {"x": 0.0, "y": 1}], "feather": 0.18}` and `set_keyframes_tool {"timeline_clip_id": "<band_1>", "property": "alpha", "points": [{"seconds": 0, "value": 0.06}]}` (alpha 0.05-0.08, angles 30-40 degrees; vary the polygon per band).
3. Let each band drift on its own axis, 40-80 px over a 10-15 s sine: `set_keyframes_tool {"timeline_clip_id": "<band_1>", "property": "location_x", "ease": "ease_in_out_sine", "points": [{"seconds": 0, "value": 0}, {"seconds": 5, "value": 0.04}, {"seconds": 10, "value": 0}]}`; stagger the phases between bands.
4. UI cards above, with `apply_look_preset_tool {"timeline_clip_id": "<card>", "look": "shadow_soft"}`.
5. Use the same bands, unchanged, in every light shot of the act.

## Timing & taste rules

- cinetic's timing (60 fps): Band drift under 0.5 px/f on sines with 600-900 f (15.00 s) periods and spread phases; present in every light shot of the act, unchanged between shots.
- Band alpha 0.05-0.08 (grey shapes blurred 100-150 px at 8-15 % opacity), across 10-18 % of the gradient line.
- Each band drifts 40-80 px on a sine with a 600-900 f (10-15 s) period and spread phases: under 0.5 px per frame.
- Cards get a soft 30 px / 60 px shadow at 12 % and a 1 px light border.
- Present in every light shot of the act, unchanged between shots.

## Sound for it

None.

## Common mistakes

- Dark stages, where the shadows disappear.
- Dense UI filling the frame edge to edge, which hides the backdrop.
- Strongly flat graphic brands.
- Avoid when: Dark stages; dense UI that fills the frame edge to edge; strictly flat graphic brands.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tx-gobo-studio-shadows`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
