---
id: cin-d3-coin-edge-to-face
kind: technique
summary: "When a mark must be revealed decisively: a thin edge-on sliver snaps open to face-on, then its face catches the light."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_3d_scene_tool, add_clip_to_timeline_tool, set_keyframes_tool, add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [decisive, tactile, polished]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [t061, t069, kinetic-3d-title]
avoid_with: [cin-d3-cube-turn-face]
needs: []
drawn: cinetic
---

# Edge-on sliver snaps face-on

cinetic `d3-coin-edge-to-face` · Depth and 3D · accent · energy medium · formats launch, sting, feature, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A thin edge-on sliver snaps open into a full face-on coin or badge. Most of the turn happens in the first frame, then it eases into place as its face catches the light.

Use when: Revealing a token, coin, badge or mark decisively, or turning a physical object into the logo at the close.

## Build it in Zenvi

1. Full look, real thickness: `add_3d_scene_tool {"scene": "logo_extrude", "params": {"svg": "<logo.svg>", "style": "matte", "animation": "tumble", "depth": 0.9, "bevel": 0.6, "background": "dark"}, "position_seconds": 0, "duration_seconds": 2.5}`. The tumble ends square to the camera; edge-on first for 4 f (0.07 s).
2. 2D snap if Blender is missing: `add_clip_to_timeline_tool {"file_id": "<coin_face>", "position_seconds": 0, "duration_seconds": 2.5, "track": 2}` and `set_keyframes_tool {"timeline_clip_id": "<coin>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 0, "value": 0.03}, {"seconds": 0.067, "value": 0.03}, {"seconds": 0.233, "value": 1.0, "ease": "ease_out_expo"}]}`: edge hold 4 f, snap over 10 f (0.17 s), about 37 % of the turn in the first frame. Put a darker 24 px (0.022) wide rectangle (a title card at `scale_x` 0.03) under it for the edge.
3. Brightness follows the angle: a black card above the coin with `set_keyframes_tool` `alpha` 0.25 to 0 over the snap (0.75 to 1.0 brightness, a tonal sheen with no bloom).
4. Calmer reveal: turn over 22 f (0.37 s) with `ease_out_cubic` to a 10 deg three-quarter rest while `location_y` rises 0.2 of the height on `ease_out_cubic`.
5. Logo close: hard-cut on the frame after it settles to the flat logotype, with its mark at exactly the emblem's screen position and size: `add_motion_block_tool {"block": "logo_reveal_end", "position_seconds": 0.4, "duration_seconds": 2.5, "params": {"brand": "<name>"}}`.
6. `add_sfx_tool {"recipe": "impact_thud", "at_seconds": 0.07, "gain_db": -8}`.

Fallback: Without Blender the thickness is a flat dark strip; it reads as a sliver, not a solid.

## Timing & taste rules

- cinetic's timing (60 fps): Edge hold 4 f (0.07 s). Snap 10 f (0.17 s) ease_out_expo: frames 1-9 reach about 37, 48, 56, 61, 68, 77, 88, 94 and 100% of the turn. Calm form: 22 f (0.37 s) ease_out_cubic to 10 deg with a 0.2H rise. Match cut on the first settled frame.
- Edge hold 4 f (0.07 s). Snap 10 f (0.17 s) on ease_out_expo: frames 1-9 reach about 37, 48, 56, 61, 68, 77, 88, 94 and 100 % of the turn.
- Calm form: 22 f (0.37 s) to a 10 deg rest with a 0.2 of the frame height rise.
- Edge about 24 px thick (12 slices of 2 px); perspective about 4x the diameter.
- Match cut on the first settled frame.

## Sound for it

One thud on the edge-on frame as it snaps open; tail_bloom at -20 dB as it settles if it closes the film.

## Common mistakes

- Flat UI icons without thickness: the edge-on frame becomes an invisible line.
- A film that already has several flips.
- Easing the snap in: most of the turn must happen in the first frame.
- Avoid when: Flat UI icons without thickness (the edge-on frame becomes an invisible line), or the film already has several flips.

## Verified

2026-10-31, `~/zenvi-motion/fleet/artifacts/x2-cinetic/verify/cin-d3-coin-edge-to-face.mp4` (1280x720p60, add_3d_scene_tool logo_extrude (svg a local circle file, style matte, animation tumble, depth 0.9, bevel 0.6, dark background, 2.5 s draft, 26 s render) with impact_thud at 0.07 s): the extruded coin appears small and edge-on at 0.08 s with visible thickness, turns through three-quarter view at 0.25 s and faces the camera by 0.42 s, then holds; the render came out orange rather than the SVG's gold fills; the 2D snap fallback and logo_reveal_end hard cut were not built; watch judge 2.7/10.

Found when rendering it (apply before building):

- Step 1: logo_extrude works as written with params.svg set to a local file path (an absolute path to a 100x100 viewBox SVG was accepted); the coin rendered orange, not the SVG's gold, so the SVG's fills are not used (the scene's color/secondary/accent params exist but were not tried).
- Step 1: the tumble reaches face-on in about 0.4 s, not edge-on for 4 f then a 10 f snap; the first rendered frame (0.08 s) is already tilted, small and off-centre. If an exact 4 f edge hold matters, use the 2D snap fallback ; draft quality takes about 26 s for 2.5 s.
- Step 5: logo_reveal_end block and the hard-cut match were not tested here.

Translated from cinetic's technique library (`d3-coin-edge-to-face`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
