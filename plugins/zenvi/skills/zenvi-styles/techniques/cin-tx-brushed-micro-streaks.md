---
id: cin-tx-brushed-micro-streaks
kind: technique
summary: "When a hero object is shown big and should feel machined: fine directional streaks and satin grain across its face."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [generate_image_and_add_to_timeline_tool, add_shape_mask_tool, set_keyframes_tool, add_3d_scene_tool]
pace: calm
mood: [metallic, tactile, premium]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-tilt-linked-sheen, cin-cl-key-light-edge-hairline, kinetic-3d-title]
avoid_with: [cin-tx-global-grain]
needs: [overlay-blend-mode]
drawn: cinetic
---

# Brushed micro-streaks

cinetic `tx-brushed-micro-streaks` · Texture and finish · accent · energy calm · formats launch, feature, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Fine directional streaks and a satin grain across a hero object's face make it read as machined material instead of flat vector.

Use when: Hero objects shown big enough for micro detail (coins, cards, devices, extruded marks); hardware and finance brands with a physical metaphor.

## Build it in Zenvi

1. Bake the texture once: `generate_image_and_add_to_timeline_tool {"prompt": "seamless brushed aluminium texture, fine horizontal streaks 1-2 px wide, neutral mid-grey, flat lighting, no objects", "position_seconds": 2.0, "duration_seconds": 3, "track": "5"}`.
2. Mask it to the hero's face: `add_shape_mask_tool {"clip_ids": ["<texture>"], "shape": "ellipse", "x": 0.5, "y": 0.5, "width": 0.45, "height": 0.45, "feather": 0.01}` (use `shape: "polygon"` with `points` for a card or device face).
3. Faint, 6-10 % on top of the hero: `set_keyframes_tool {"timeline_clip_id": "<texture>", "property": "alpha", "points": [{"seconds": 2.0, "value": 0.08}, {"seconds": 4.6, "value": 0.08}, {"seconds": 4.8, "value": 0, "ease": "ease_in_out_sine"}]}` (fade out over 10-14 f = 0.17-0.23 s before the object shrinks).
4. As the hero turns, slide the texture along its streak axis in proportion: `set_keyframes_tool {"timeline_clip_id": "<texture>", "property": "location_x", "points": [{"seconds": 2.0, "value": -0.03}, {"seconds": 4.5, "value": 0.03, "ease": "ease_in_out_sine"}]}`.
5. For a real 3D object, `add_3d_scene_tool {"scene": "logo_extrude", "params": {}, "position_seconds": 2.0, "duration_seconds": 3, "quality": "final"}` carries its own material; use the texture only on flat 2D faces.

Fallback: No overlay blend mode exists, so the texture is a plain low-alpha grey layer; it reads as a faint veil, not a satin that catches light. Keep alpha under 0.08 and apply only to flat hero faces at 30 % of the frame height or more.

## Timing & taste rules

- cinetic's timing (60 fps): Constant while the object is at hero scale (at least 30% of frame height); fade it out over 10-14 f (0.23 s) on ease_in_out_sine before the object shrinks below that.
- Streaks 1-2 px wide, noise sigma about 6 levels around mid-grey, overlay at 6-10 % opacity (here plain alpha 0.06-0.08).
- Constant while the object is at hero scale (at least 30 % of the frame height); fade out over 10-14 f (0.17-0.23 s) before it shrinks below that.
- Bake the texture at 2x the on-screen size.
- Slide the texture along the streak axis in proportion to the object's rotation.

## Sound for it

None.

## Common mistakes

- Small or minified objects, where 1 px streaks alias and crawl.
- Soft, friendly brands, or flat UI.
- Texture that keeps running after the object has shrunk.
- Avoid when: Small or minified objects, where 1 px streaks alias and crawl; soft, friendly brands; flat UI.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tx-brushed-micro-streaks`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
