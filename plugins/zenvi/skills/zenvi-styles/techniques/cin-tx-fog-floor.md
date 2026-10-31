---
id: cin-tx-fog-floor
kind: technique
summary: "When a panel tilts back or recedes on a light stage: the bottom fifth lightens like a lit floor to dissolve into."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_title_tool, add_shape_mask_tool, set_keyframes_tool]
pace: calm
mood: [airy, spatial, soft]
aspect: ["16:9", "1:1"]
pairs_with: [shot-tilted-plane-glide, cin-tx-gobo-studio-shadows, shot-pullback-isolation]
avoid_with: [cin-cl-living-stage]
needs: [perspective-plane-showcase]
drawn: cinetic
---

# Fog floor

cinetic `tx-fog-floor` · Texture and finish · workhorse · energy calm · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The bottom fifth of the frame lightens toward the stage's brightest tone, as if the UI hovers above a softly lit floor that receding planes can sink into.

Use when: Light or pastel stages with 3D tilt-backs, lifts and recedes; any film that wants a horizon without drawing a floor.

## Build it in Zenvi

1. Floor on a track above the background and below the UI: `add_title_tool {"text": " ", "background_color": "#fdfdfd", "position_seconds": 0, "duration_seconds": 10, "track": "2"}` with `add_shape_mask_tool {"clip_ids": ["<floor>"], "shape": "rectangle", "x": 0.5, "y": 0.95, "width": 1.2, "height": 0.22, "feather": 0.12}` and `alpha` 0.6 via `set_keyframes_tool` (22 % of the frame height, fixed to the stage). On an ink stage the floor colour is the ink raised a little (about OKLCH 0.04).
2. Tilt-back of a panel (fake perspective with a squash): `set_keyframes_tool {"timeline_clip_id": "<panel>", "property": "scale_y", "points": [{"seconds": 3.0, "value": 1.0}, {"seconds": 3.6, "value": 0.55, "ease": "ease_in_cubic"}]}` and `location_y` 0 to 0.12 over the same 36 f (0.6 s).
3. Dissolve into the floor over the last 12 f (0.2 s): `set_keyframes_tool {"timeline_clip_id": "<panel>", "property": "alpha", "points": [{"seconds": 3.4, "value": 1}, {"seconds": 3.6, "value": 0, "ease": "ease_in_cubic"}]}`, with a second copy of the floor clip on a track above the panel so it dissolves into it.

Fallback: The tilt is a vertical squash plus a drop, not a true perspective tilt (rotateX 0 to 60 degrees at perspective 2000-2400 px). For a real perspective tilt use a 3D scene (device_mockup); otherwise keep the tilt small.

## Timing & taste rules

- cinetic's timing (60 fps): The floor band is 22% of frame height and fixed to the stage; tilt-backs 30-40 f (0.67 s) on ease_in_cubic with the fade over their last 12 f (0.20 s).
- The floor band is 22 % of the frame height and fixed to the stage.
- Tilt-backs take 30-40 f (0.5-0.67 s, ease_in_cubic) with the panel fading over their last 12 f (0.2 s).
- Floor tone is a near-white just above the stage in the same hue; stops at 0, 12 % and 22 % of the band.
- Only with depth moves in the shot.

## Sound for it

None; a tilt-back gets a soft `whoosh_fall` (-18 dB) if it is a hero move.

## Common mistakes

- Flat, front-on UI with no depth moves.
- Dark stages that already have a light pool.
- Vertical frames where captions sit in the bottom fifth.
- Avoid when: Flat, front-on UI with no depth moves; dark stages that already have a light pool; vertical frames where captions sit in the bottom fifth.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tx-fog-floor`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
