---
id: cin-tr-drift-matched-angle-cut
kind: technique
summary: "When a calm shot needs a new angle with no jolt: hard cut while the slow push or pull runs at the same rate."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [set_keyframes_tool, apply_matched_dissolve_tool, add_sfx_tool]
pace: calm
mood: [serene, premium, continuous]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cinematic-push-in, cinematic-match-on-action]
avoid_with: [cin-tr-velocity-handoff-cut, cin-tr-scale-through-cut]
needs: []
drawn: cinetic
---

# Angle change on a shared drift

cinetic `tr-drift-matched-angle-cut` · Transition · workhorse · energy calm · formats launch, feature, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A hard cut jumps to a new angle or the next state of the same object (front to top-down, open to closed) while the slow zoom or pan carries on at exactly the same rate, so a calm shot changes viewpoint with no jolt and no speed ramp.

Use when: Calm films and product beauty shots where a velocity ramp would be too loud: showing an object's second side or its next state within one continuous gesture.

## Build it in Zenvi

1. Shot A (angle 1) and shot B (angle 2, at least 30 degrees away, or the object's next state: lid open to closed) share the subject's on-screen centre within +/-40 px and apparent size within +/-15 %.
2. One drift curve, written across both: A `scale_x/scale_y` `[{"seconds": 0, "value": 1.10}, {"seconds": <T>, "value": 1.04, "ease": "ease_out_cubic"}]` with the cut `T` 8-16 f (0.13-0.27 s) into the drift, at -0.26 to -0.36 % scale per frame.
3. B continues the curve at the same slope: `{"seconds": <T>, "value": 1.04}, {"seconds": <T+1.0>, "value": 1.0, "ease": "ease_out_cubic"}` (settles 40-80 f / 0.67-1.3 s after the cut). A pan carries the same way: `location_x` slope matched at 2-4 px/f.
4. When the subject itself acts (a lid closes), drive the action from one progress and cut at 35-55 % of it so it finishes in the new angle (36-60 f / 0.6-1.0 s on `ease_in_out_sine`).
5. Same stage colour and light, no ghost frame, cut in 0 f. For a softer variant, `apply_matched_dissolve_tool {"clip1_id": "<A>", "clip2_id": "<B>", "duration": 0.5, "drift": "pull_out", "speed": 0.03}`.

## Timing & taste rules

- cinetic's timing (60 fps): Drift 96 f (1.60 s) on ease_out_cubic from 1.10x (or a 2-4 px/f pan). Cut 8-16 f (0.27 s) in, at −0.26 to −0.36% scale per frame (about 3 px/f at the frame edge); the drift settles 40-80 f (1.33 s) after the cut. Angle change at least 30 deg, centre offset at most 40 px, size change at most 15%. Optional subject action 36-60 f (1.00 s) on ease_in_out_sine, cut at 35-55% of it. Cut in 0 f (0.00 s).
- Drift 96 f (1.6 s) on an ease-out from 1.10x, or a 2-4 px/f pan.
- Cut 8-16 f in (0.13-0.27 s), while the frame still changes ~0.3 % per frame (about 3 px/f at the edge).
- Angle change at least 30 degrees, centre offset 40 px at most, size change 15 % at most.
- Optional subject action 36-60 f (0.6-1.0 s) on a smooth ease, cut at 35-55 % of it.
- No ghost frame, no flash.

## Sound for it

None on the cut; a quiet room tone or music bed runs through. A soft `cloth` or `paper` if the object itself moves.

## Common mistakes

- Two angles under ~30 degrees apart: it reads as a jump cut; or the size/position jumps; or one side static (avoid_when).
- Resetting the drift at the cut: the rate must be continuous.
- Using it for a lift in energy: that is the velocity handoff.
- Avoid when: The two angles look alike (under about 30 deg it reads as a jump cut), the subject's size or position jumps, or one side is static. For a lift in energy, use a velocity handoff instead.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tr-drift-matched-angle-cut`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
