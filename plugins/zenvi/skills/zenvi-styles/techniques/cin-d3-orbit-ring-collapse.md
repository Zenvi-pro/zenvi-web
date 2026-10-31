---
id: cin-d3-orbit-ring-collapse
kind: technique
summary: "When an ecosystem surrounds one core: icons orbit a tilted ellipse, then the ring speeds up and collapses into the mark."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, add_effect_tool, update_effect_tool, add_sfx_tool]
pace: medium
mood: [clever, tidy, conceptual]
aspect: ["16:9", "1:1"]
pairs_with: [shot-orbit-ring-title-open, shot-ui-to-brand-morph, kcut-assemble]
avoid_with: [shot-carousel-ring]
needs: [orbit-ring-carousel]
drawn: cinetic
---

# Depth orbit ring that collapses into the mark

cinetic `d3-orbit-ring-collapse` · Depth and 3D · accent · energy medium · formats launch, feature, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Small icons orbit the central mark on a tilted ellipse: they grow and pass in front as they come near and shrink behind it as they go far. Then the ring speeds up and contracts into the mark.

Use when: Showing an ecosystem of integrations or inputs around one core in about 1.5 s, without words.

## Build it in Zenvi

1. The core mark centred on a top track: `add_clip_to_timeline_tool {"file_id": "<mark>", "position_seconds": 0, "duration_seconds": 3, "track": 8}`.
2. 6-8 icon clips on tracks 2-7, scaled about 0.1, one clip each. Per icon i the ellipse path is x = 0.35 cos(theta), y = 0.2 sin(theta), theta = theta0 + i x 360/n + 40 deg/s x t: `set_keyframes_tool {"timeline_clip_id": "<icon_i>", "property": "location_x", "mode": "replace", "points": [...]}` with a keyframe every 0.1 s (about 30 points over 50 f, 0.83 s, plus the contraction), the same for `location_y`; `interpolation: "linear"` during the orbit.
3. Depth: `scale_x/y` = 0.7 + 0.6 x (sin(theta)+1)/2 and `alpha` 0.6 to 1 from the same keyframes; put icons that are nearer the camera on tracks above the mark and those behind it below (the sort cannot change per frame, so split each icon in two clips, one in front and one behind, and swap at theta crossing 0 and 180 deg).
4. Soften the near icons: `add_effect_tool {"effect": "Blur", "timeline_clip_id": "<icon_i>"}` at about 6 px for the nearest and `update_effect_tool` to ramp it.
5. Contract: from 0.83 s multiply the ellipse radii and icon scale by 1.0 to 0.3 over 34 f (0.57 s) on `ease_in_cubic` while the angular speed doubles to 80 deg/s; fade each icon over its last 8 f (0.13 s) as it passes behind the mark. The mark punches 1.0, 1.03, 1.0 on the frame the ring closes.
6. `add_sfx_tool {"recipe": "pop", "at_seconds": 1.4, "gain_db": -10}` on the close.

Fallback: Per-frame depth sorting of icons around the mark needs many clips and keyframes; with 6-8 icons keep each as one clip and accept a fixed order, or use fewer icons.

## Timing & taste rules

- cinetic's timing (60 fps): Orbit omega = 0.67 deg/f (40 deg/s) linear for about 50 f (0.83 s); contraction 34 f (0.57 s) on ease_in_cubic (ring x0.3, omega x2); icon fade over the last 8 f (0.13 s); mark punch hitPulse(t, 2, 6) x 0.03.
- Orbit 0.67 deg/f (40 deg/s) linear for about 50 f (0.83 s); contraction 34 f (0.57 s) on ease_in_cubic (ring x0.3, speed x2).
- Icon fade over the last 8 f (0.13 s); mark punch 3 % on the closing frame.
- 6-8 icons: scale 0.7-1.3x, brightness 0.6-1 by depth; near icons softened to 6 px blur.
- More than 8 icons turns into noise.

## Sound for it

One soft pop when the ring closes into the mark; the orbit is silent.

## Common mistakes

- Icons that must be read or named.
- A film that already used an orbit.
- More than 8 icons.
- Avoid when: The icons must be read or named, or the film already used an orbit; more than 8 icons turns into noise.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`d3-orbit-ring-collapse`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
