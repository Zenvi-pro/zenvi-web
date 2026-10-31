---
id: cin-tr-tip-back-exit
kind: technique
summary: "When a UI section hands over to a statement: the scene tips away like a sheet, dims into the next stage colour."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [set_keyframes_tool, apply_motion_transition_tool, add_kinetic_title_tool, add_sfx_tool]
pace: medium
mood: [tidy, deliberate, editorial]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-overhead-tilt-drop, shot-bottom-push-chapters, kinetic-mask-reveal]
avoid_with: [cin-tr-cover-wipe, cin-tr-subtract-reveal]
needs: [perspective-plane-showcase]
drawn: cinetic
---

# Tip-back exit

cinetic `tr-tip-back-exit` · Transition · workhorse · energy medium · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The outgoing scene tips away from camera like a sheet laid onto a table, or flips up into a line, speeding up and fading into the next stage colour, and the next element lands on the clean field.

Use when: Ending a UI section to hand over to a statement or an alert, when the next beat needs an empty stage for big type.

## Build it in Zenvi

1. Tip-back (30 f / 0.5 s): the outgoing scene's `scale_y` 1.0 to 0.62 about the bottom edge and `location_y` 0 to +0.10 on `ease_in_out_sine`: `set_keyframes_tool {"timeline_clip_id": "<scene>", "property": "scale_y", "mode": "replace", "points": [{"seconds": <t>, "value": 1.0}, {"seconds": <t+0.5>, "value": 0.62, "ease": "ease_in_out_sine"}]}` with `origin_y` fixed at 1.0 (the bottom edge); a slight `shear_y` mimics the 40 degree tip.
2. Dim into the next stage colour over the last 12 f (0.2 s): a plate of the next stage colour above it with `alpha` 0 to 0.9: `add_title_tool {"text": " ", "background_color": "#101218", "position_seconds": <t>, "duration_seconds": 0.5, "track": 3}` and `set_keyframes_tool {"timeline_clip_id": "<plate>", "property": "alpha", "mode": "replace", "points": [{"seconds": <t+0.3>, "value": 0}, {"seconds": <t+0.5>, "value": 0.9}]}`.
3. Fast version: `scale_y` 1.0 to 0.03 with `origin_y` 0 and `location_y` 0 to -0.37 over 20 f (0.33 s, `ease_in_cubic`; last frame ~70 px/f), so the scene flattens into a line at the top edge.
4. Quick preset for the flat version: `apply_motion_transition_tool {"preset": "tilt", "direction": "down", "duration": 0.33}`.
5. The next element lands on the frame the exit clears, or 1 f before: `add_kinetic_title_tool {"text": "Zero wait.", "position_seconds": <t+0.5>, "duration_seconds": 2.0, "animation": "rise"}`. `add_sfx_tool {"recipe": "paper", "at_seconds": <t>, "gain_db": -18}`.

Fallback: No true 3D tip (rotateX with perspective) exists; the squash toward a pinned edge plus dim is the stand-in. A real perspective tilt needs the perspective-plane showcase.

## Timing & taste rules

- cinetic's timing (60 fps): Tip-back: 30 f (0.50 s) on ease_in_out_sine (rotateX 40 deg). Flip to a line: 20 f (0.33 s) on ease_in_cubic. Crop collapse: 24 f (0.40 s) on ease_in_cubic. Dim overlay 0 → 0.9 over the last 12 f (0.20 s). The next element starts 0-1 f (0.02 s) after the exit clears.
- Tip-back 30 f (0.5 s) on a smooth ease, to ~40 degrees.
- Flip to a line: 20 f (0.33 s) on an ease-in, last frame ~70 px/f.
- Dim overlay 0 to 0.9 over the last 12 f (0.2 s) into the next act's stage colour, never to black and back.
- Crop-collapse (flat) version 24 f (0.4 s) on an ease-in, cut on its fastest frame.
- Next element starts 0-1 f after the exit clears.

## Sound for it

A faint `paper` or `cloth` laying-down sound as the tip starts; nothing on the dim.

## Common mistakes

- The next act opens on the same pose (use a relay), or the dim goes to black and back up, a dip, instead of into the next stage colour (avoid_when).
- Letting the scene stay lit as it tips: it must sink into the stage.
- Starting the next element 6+ frames late: the stage sits empty.
- Avoid when: The next act opens on the same pose (use a relay instead), or the dim would go to black and back up (a dip) instead of into the next stage colour.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tr-tip-back-exit`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
