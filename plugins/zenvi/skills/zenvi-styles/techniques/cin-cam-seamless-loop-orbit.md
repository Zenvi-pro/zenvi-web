---
id: cin-cam-seamless-loop-orbit
kind: technique
summary: "When a clip must loop with no seam: the camera drifts on a slow closed figure-eight and ends where it began."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop]
tools: [set_keyframes_tool]
pace: calm
mood: [hypnotic, ambient, loopable]
aspect: ["9:16", "16:9", "1:1"]
pairs_with: [shot-gradient-type-shift, t057, cinematic-push-in]
avoid_with: [cin-cam-breathing-zoom]
needs: []
drawn: cinetic
---

# Seamless loop drift

cinetic `cam-seamless-loop-orbit` · Camera · workhorse · energy calm · formats loop, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

In a looping clip the camera drifts along a slow, closed figure-eight (a little sideways, a little up, breathing in and out) and returns exactly to its first frame, so the loop has no seam.

Use when: Feature loops, background clips and vertical loops that replay endlessly.

## Build it in Zenvi

1. Loop length L = 6 s (360 f) on the background clip or hero. Sideways sine, one cycle: `set_keyframes_tool {"timeline_clip_id": "<hero>", "property": "location_x", "mode": "replace", "points": [{"seconds": 0, "value": 0}, {"seconds": 0.75, "value": 0.0118}, {"seconds": 1.5, "value": 0.0167}, {"seconds": 2.25, "value": 0.0118}, {"seconds": 3.0, "value": 0}, {"seconds": 3.75, "value": -0.0118}, {"seconds": 4.5, "value": -0.0167}, {"seconds": 5.25, "value": -0.0118}, {"seconds": 6.0, "value": 0}], "ease": "ease_in_out_sine"}` (about 32 px at 1080p).
2. Vertical figure-eight term at twice the frequency: `location_y` `[{"seconds": 0, "value": 0}, {"seconds": 0.75, "value": 0.0111}, {"seconds": 1.5, "value": 0}, {"seconds": 2.25, "value": -0.0111}, {"seconds": 3.0, "value": 0}, {"seconds": 3.75, "value": 0.0111}, {"seconds": 4.5, "value": 0}, {"seconds": 5.25, "value": -0.0111}, {"seconds": 6.0, "value": 0}]` (about 12 px).
3. Breathing zoom of +/-3 %, phase-shifted: `scale_x` and `scale_y` `[{"seconds": 0, "value": 1.028}, {"seconds": 0.75, "value": 1.028}, {"seconds": 1.5, "value": 1.011}, {"seconds": 2.25, "value": 0.988}, {"seconds": 3.0, "value": 0.972}, {"seconds": 3.75, "value": 0.973}, {"seconds": 4.5, "value": 0.989}, {"seconds": 5.25, "value": 1.012}, {"seconds": 6.0, "value": 1.028}]`.
4. For a 3D product add a +/-3 degree yaw (`rotation` is the nearest). Make the first and last value identical so frame L equals frame 0 and every term finishes a whole number of cycles.
5. Time the content's own loop to L or a divisor of it (a `gradient_field` background of the same length).

## Timing & taste rules

- cinetic's timing (60 fps): Loop L = 240-480 f (8.00 s). Amplitudes 24-40 px sideways and 10-16 px vertically (at twice the frequency), zoom +-3%, yaw +-3 deg. Peak speed about 0.5-0.8 px/f.
- Loop L = 240-480 f (4-8 s); never under ~4 s, where the drift becomes a visible wobble.
- Amplitudes 24-40 px sideways and 10-16 px vertical (twice the frequency), zoom +/-3 %, yaw +/-3 degrees.
- Peak speed about 0.5-0.8 px/f; the motion never stops.
- Every term completes whole cycles in L; first and last keyframes identical.
- Content's own loop is L or a divisor of it.

## Sound for it

A seamless pad or ambience loop of the same length; no hits.

## Common mistakes

- Linear films with cuts (use a living hold instead), or loops shorter than ~4 s (avoid_when).
- Last frame slightly different from the first: the seam shows once per loop.
- Content loop length not a divisor of L: the picture re-syncs visibly.
- Avoid when: Linear films with cuts (use a living hold instead), or loops shorter than about 4 s, where the drift turns into a visible wobble.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cam-seamless-loop-orbit`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
