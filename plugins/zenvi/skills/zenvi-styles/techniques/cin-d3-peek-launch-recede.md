---
id: cin-d3-peek-launch-recede
kind: technique
summary: "When a hero device needs anticipation: it peeks from the bottom edge, pauses, shoots to centre and settles back."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, apply_fx_tool, add_3d_scene_tool, add_sfx_tool]
pace: fast
mood: [anticipatory, powerful, sleek]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-slam-entrance, shot-magician-card-flourish, kinetic-3d-title]
avoid_with: [shot-attention-bounce, cin-d3-impact-morph-stretch]
needs: []
drawn: cinetic
---

# Peek, hover, launch and recede

cinetic `d3-peek-launch-recede` · Depth and 3D · accent · energy high · formats launch, feature, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A device or product panel barely rises from the bottom edge, pauses, then shoots up to centre. It is tipped back as it rises, faces camera as it arrives, and slowly settles away from camera.

Use when: Introducing hardware or a hero product surface, where anticipation makes the main move feel powerful.

## Build it in Zenvi

1. Object clip at its final size and place, starting off-frame below: `add_clip_to_timeline_tool {"file_id": "<device>", "position_seconds": 0, "duration_seconds": 3, "track": 2}`.
2. Peek, hover, launch, recede on `location_y`: `set_keyframes_tool {"timeline_clip_id": "<device>", "property": "location_y", "mode": "replace", "points": [{"seconds": 0, "value": 0.75}, {"seconds": 0.23, "value": 0.6, "ease": "ease_out_expo"}, {"seconds": 0.3, "value": 0.6}, {"seconds": 0.87, "value": 0.0, "ease": "ease_in_out_expo"}]}`. Peek 170 px (0.16 of the height) over 14 f (0.23 s), hover 4 f (0.07 s), launch over 34 f (0.57 s) with travel at most 640 px (0.6 of the height) so the peak stays under 70 px/f.
3. Tip back while rising: `shear_y` or `scale_y` 0.94 to 1.0 over the last 20 f (0.33 s) of the launch with `ease_out_cubic` (a 10 deg rotateX approximation).
4. Recede: `scale_x/y` 1.0 to 0.93 over 60 f (1.0 s), `ease_in_out_sine`; its ground shadow tightens in the image.
5. Blur the launch: `apply_fx_tool {"clip_id": "<device>", "effects": [{"effect": "directional_blur", "amount": 0.6, "start": 0.3, "end": 0.87}]}`.
6. For a true tipped device use `add_3d_scene_tool {"scene": "device_mockup", "params": {"file_id": "<video>", "move": "hero"}, "duration_seconds": 3}`. `add_sfx_tool {"recipe": "whoosh_rise", "at_seconds": 0.3, "gain_db": -10}` and `{"recipe": "impact_thud", "at_seconds": 0.87, "gain_db": -8}`.

## Timing & taste rules

- cinetic's timing (60 fps): Peek 170 px over 14 f (0.23 s) ease_out_expo (peak about 64 px/f); hover 4 f (0.07 s); launch of up to 640 px over 34 f (0.57 s) ease_in_out_expo; tilt 10 to 0 deg over the last 20 f (0.33 s) on ease_out_cubic; recede x0.93 over 60 f (1.00 s) ease_in_out_sine.
- Peek 170 px over 14 f (0.23 s) on ease_out_expo (peak about 64 px/f); hover 4 f (0.07 s); launch up to 640 px over 34 f (0.57 s) on ease_in_out_expo.
- Tilt 10 deg to 0 over the last 20 f (0.33 s); recede x0.93 over 60 f (1.0 s) on ease_in_out_sine.
- Peak launch speed is about 3.7x the mean speed; lengthen the launch for longer travel.
- The hover is what makes the launch read as powerful.

## Sound for it

A rising whoosh into the launch and a low thud when it lands at centre.

## Common mistakes

- A film that already used anticipation twice.
- Small UI as the object: it reads as a bounce.
- Skipping the hover: the launch loses its wind-up.
- Avoid when: The film has already used anticipation twice, or the object is small UI (it reads as a bounce).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`d3-peek-launch-recede`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
