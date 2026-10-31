---
id: cin-d3-extruded-slab-orbit
kind: technique
summary: "When a product walkthrough needs to read as an object: the live UI on a thick slab, the camera yawing to show the edge."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_3d_scene_tool, rerender_3d_scene_tool, add_motion_block_tool, add_kinetic_title_tool, add_sfx_tool]
pace: medium
mood: [premium, spatial, product-led]
aspect: ["16:9", "1:1"]
pairs_with: [cin-lc-negative-space-caption, cin-ps-single-camera-journey, t005]
avoid_with: [cin-ps-locked-camera-holds, shot-tilted-plane-glide]
needs: []
drawn: cinetic
---

# Product on a thick extruded slab

cinetic `d3-extruded-slab-orbit` · Depth and 3D · workhorse · energy medium · formats launch, walkthrough, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The live interface sits on the front of a thick matte slab with rounded corners. When the camera orbits or yaws, the slab's solid edge appears, which turns a screen into an object and makes every angle readable.

Use when: A single-take product walkthrough or a feature film where the camera travels across one interface.

## Build it in Zenvi

1. The slab: `add_3d_scene_tool {"scene": "device_mockup", "params": {"device": "tablet", "file_id": "<ui_recording>", "move": "orbit", "body": "graphite", "shadow": true, "dof": false, "size": 0.7, "background": "dark"}, "position_seconds": 0, "duration_seconds": 6, "quality": "draft"}`. Draft first, then `rerender_3d_scene_tool` with `quality: "final"`.
2. Hero push: use `move: "push"` for a first beat, 60 f (1.0 s) with a push of 1 to 2.56x on ease_in_out_sine and yaw 0 to 30 deg landing the target panel in the right third so a void opens for the caption. The edge reads from 20 deg of yaw, clearly at 30-35 deg.
3. Cursor-led whip: a second scene or segment with yaw +/-30 deg, roll at most 11 deg, zoom x0.77 over 74 f (1.23 s) on ease_in_out_expo, the cursor leading by 4-6 f (0.07-0.1 s): `add_motion_block_tool {"block": "cursor_path", "position_seconds": 2.5, "duration_seconds": 3, "placement": "over_video", "params": {"points": [[0.6, 0.45], [0.35, 0.6]], "labels": ["Open"]}}`.
4. After each move the camera stops and the caption, cursor and UI micro-interactions carry the hold: `add_kinetic_title_tool {"text": "<caption>", "style": "documentary", "animation": "rise", "position_seconds": 1.2, "duration_seconds": 2.0, "y": 0.5}` in the void, building while the camera decelerates.
5. `add_sfx_tool {"recipe": "swish_airy", "at_seconds": 0.3, "gain_db": -18}`.

Fallback: The slab here is the generic rounded device model with a bezel, not a custom 16-24 slice rounded extrusion at the UI's exact aspect.

## Timing & taste rules

- cinetic's timing (60 fps): Slab depth 4-5% of its height; the edge reads from 20 deg of yaw and clearly at 30-35 deg. Hero push 60 f (1.00 s) ease_in_out_sine (peak about 47 px/f mid-move); whip orbit 74 f (1.23 s) ease_in_out_expo, roll at most 11 deg; the caption builds while the camera decelerates.
- Slab depth 4-5 % of its height; the edge shows from 20 deg of yaw and clearly at 30-35 deg.
- Hero push 60 f (1.0 s) on ease_in_out_sine; whip orbit 74 f (1.23 s) on ease_in_out_expo, roll at most 11 deg.
- Add a 2 % breath if nothing moves within 48 f (0.8 s).
- The camera moves, not the slab; the caption builds while the camera decelerates.

## Sound for it

A soft swish_airy on each camera move at -18 dB; cursor clicks get mouse_click at -18 dB.

## Common mistakes

- A flat 2D film: the edge never shows and the build is wasted.
- A camera that never yaws.
- Moving the slab instead of the camera: the lighting breaks.
- Avoid when: The film is flat 2D throughout, or the camera never yaws (the edge never shows and the build is wasted).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`d3-extruded-slab-orbit`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
