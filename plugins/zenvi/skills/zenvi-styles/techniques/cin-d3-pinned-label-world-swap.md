---
id: cin-d3-pinned-label-world-swap
kind: technique
summary: "When a place matters: a pin and data tag follow a 3D scene, then the world flips to a flat map under the same tag."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, pin_to_track_tool, add_kinetic_title_tool, set_keyframes_tool]
pace: medium
mood: [informative, precise, spatial]
aspect: ["16:9", "1:1"]
pairs_with: [kinetic-tracked-label, t070, t071]
avoid_with: [t005, shot-tilted-plane-glide]
needs: [tracked-point-callout-pin]
drawn: cinetic
---

# Pinned label over a swapping world

cinetic `d3-pinned-label-world-swap` · Depth and 3D · accent · energy medium · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A pin pops on a 3D-rendered place and a short data tag on a leader line tracks that point as the camera orbits. On a cut, the world underneath switches between 3D and flat while the tag holds its screen position.

Use when: Location or geography matters ('this happens in a real place'), or a flat diagram should be revealed as a real object, and back.

## Build it in Zenvi

1. World layer: a pre-rendered 3D plate (a globe or city orbit) and a flat map movie on the same track, back to back: `add_clip_to_timeline_tool {"file_id": "<plate_3d>", "position_seconds": 0, "duration_seconds": 1.5, "track": 1}` then `{"file_id": "<flat_map>", "position_seconds": 1.5, "duration_seconds": 1.17, "track": 1}` (3D segment about 90 f, flat about 70 f).
2. Pin and tag follow the place in the 3D plate: `pin_to_track_tool {"footage_clip_id": "<plate_3d>", "point": {"x": 0.58, "y": 0.52}, "time": 0.3, "label": "LISBON", "mono": true, "follow": "position", "label_offset": {"x": 0.1, "y": -0.1}, "start": 0.3, "duration": 2.5}`. Pin scales 0 to 1 over 8 f (0.13 s), leader draws 8 f from +4 f (0.07 s), name slides 25 px (0.023) over 12 f (0.2 s) from +12 f (0.2 s).
3. The tag is a value or a status, typed on (`text_scramble` or `add_kinetic_title_tool` with `animation: "typewriter"`), not a decorative kicker.
4. Swap on the zoom's velocity peak: the second clip begins already zooming, with its pin at the same screen position: `set_keyframes_tool {"timeline_clip_id": "<flat_map>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 1.5, "value": 1.8}, {"seconds": 2.0, "value": 1.0, "ease": "ease_out_expo"}]}` (and `scale_y`; the same point sits about 1.8x larger and keeps shrinking, decelerating, a 30 f, 0.5 s settle), and a second `pin_to_track_tool` call on the flat map; the overlay keeps animating untouched.
5. Flat-to-3D version: a shrinking flat mark cuts to its 3D twin at the same screen position, starting 8x large and pulling back to 1x over 18 f (0.3 s) on ease_out_expo.

Fallback: Real projection of a world point through the 3D camera needs the pin tracked in the plate's footage (as above); a hand-keyframed pin drifts from the surface.

## Timing & taste rules

- cinetic's timing (60 fps): Pin 8 f (0.13 s) ease_out_expo; leader 8 f (0.13 s) from +4 f (0.07 s); name 25 px over 12 f (0.20 s) ease_out_expo from +12 f (0.20 s); orbit yaw 0.1-0.2 deg/f linear. 3D segment about 90 f (1.50 s), flat segment about 70 f (1.17 s); cut on the zoom's velocity peak, zoomHandoff settle 30 f (0.50 s). Flat-to-3D: 8x to 1x over 18 f (0.30 s) ease_out_expo (fastest per-frame ratio about 0.65 at frame 2), settled by f22 (0.37 s).
- Pin 8 f (0.13 s) ease_out_expo; leader 8 f from +4 f; name 25 px over 12 f from +12 f; orbit yaw 0.1-0.2 deg/f linear.
- 3D segment about 90 f (1.5 s), flat segment about 70 f (1.17 s); cut on the zoom's velocity peak, settle 30 f (0.5 s).
- Flat-to-3D: 8x to 1x over 18 f (0.3 s), settled by f22 (0.37 s).
- The tag leans with the ground (a small shear of about 0.15x the camera yaw).

## Sound for it

A tiny ui_tap on the pin pop (-18 dB) and a soft whoosh on the world swap; none for the tag.

## Common mistakes

- No real 3D plate or scene to anchor to: a tag over a flat screenshot gains nothing.
- A decorative kicker as the tag instead of a value or status.
- Cutting the world layer off the zoom's velocity peak: the swap shows.
- Avoid when: There is no real 3D plate or scene to anchor to; a tag floating over a flat screenshot gains nothing from projection.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`d3-pinned-label-world-swap`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
