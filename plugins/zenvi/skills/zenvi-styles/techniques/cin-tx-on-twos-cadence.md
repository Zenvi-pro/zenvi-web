---
id: cin-tx-on-twos-cadence
kind: technique
summary: "When a UI section or sting should feel mechanical: one layer updates every second frame against a smooth film."
categories: [cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [mechanical, precise, punchy]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [shot-on-threes-to-ones, crt-scanline-and-schematic-inserts, kinetic-typewriter]
avoid_with: [cin-tx-speed-gated-motion-blur, cinematic-push-in]
needs: []
drawn: cinetic
---

# Stepped cadence on twos

cinetic `tx-on-twos-cadence` · Texture and finish · accent · energy medium · formats sting, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

One designated layer or section updates only on every second frame, so its motion reads crisp, precise and slightly mechanical against an otherwise smooth 60 fps film.

Use when: Mechanical, developer or precision brands; a UI section that should feel like a live screen; a short sting that wants a punchy graphic cadence.

## Build it in Zenvi

1. The layer (a UI card, a type block) goes on its own track. Move it with constant-interpolation keyframes, one point every 2 f (0.033 s at 60 fps) so each pair holds still: `set_keyframes_tool {"timeline_clip_id": "<card>", "property": "location_y", "interpolation": "constant", "points": [{"seconds": 2.0, "value": 0.12}, {"seconds": 2.033, "value": 0.105}, {"seconds": 2.067, "value": 0.088}, {"seconds": 2.1, "value": 0.071}, ...]}` along the same curve you would use smooth (ease_out_expo over 24-40 f = 0.4-0.67 s), sampled every 0.033 s.
2. Same sampling on `scale_x`/`scale_y` and `alpha` of the layer. On a 30 fps project every frame is already a pair of 60 fps frames: step every 1 frame (0.033 s) instead.
3. Leave the camera, background and grain on the native frame. Apply to a whole act (a UI-precision section, a sting) or to the type layer only, and never switch it on and off inside a shot.
4. `add_sfx_tool {"recipe": "keyboard_key", "at_seconds": 2.0, "gain_db": -18}` is optional on the landing.

## Timing & taste rules

- cinetic's timing (60 fps): Steps every 2 f (30 Hz in a 60 fps file); moves of 60-150 px over 24-40 f (0.67 s) on ease_out_cubic or ease_out_quart evaluated at f2 (0.03 s), peaking at or under 24 px per step; at least one full shot or act long.
- Steps every 2 f (30 Hz inside a 60 fps file); moves of 60-150 px over 24-40 f (0.4-0.67 s) on an ease_out_expo or ease_in_out_sine curve sampled at the step.
- Keep every stepped element under 24 px per step (12 px per frame on average) and type under 20 px per step; a held frame cannot carry blur.
- At least one full shot or act long.
- Only the designated layer steps; everything else stays smooth.

## Sound for it

Small mechanical ticks (`keyboard_key`, -18 dB) on landings; no whooshes, a stepped move has no smooth motion to follow.

## Common mistakes

- Slow drifts and camera pushes: they judder when stepped.
- A few isolated stepped shots in a smooth film, which read as dropped frames.
- Moves bigger than 24 px per step.
- Avoid when: Slow drifts and camera pushes (they judder); moves that would exceed 24 px per step; a few isolated shots in a smooth film, where it reads as dropped frames.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tx-on-twos-cadence`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
