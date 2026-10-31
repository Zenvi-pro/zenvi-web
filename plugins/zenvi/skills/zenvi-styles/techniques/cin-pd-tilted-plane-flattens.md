---
id: cin-pd-tilted-plane-flattens
kind: technique
summary: "When a real screen is introduced, it lies tipped back in perspective, rises to the camera and turns flat."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_3d_scene_tool, add_clip_to_timeline_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [reveal, confident, spatial]
aspect: ["16:9", "1:1"]
pairs_with: [cin-pd-device-rise-on-cut, cin-pd-pin-field-pullback, t005]
avoid_with: [cinematic-push-in]
needs: [perspective-plane-showcase, focus-pull-between-planes]
drawn: cinetic
---

# Tilted product plane flattens

cinetic `pd-tilted-plane-flattens` · Product demo · signature · energy medium · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A real product page lies tipped back in perspective, rises toward the camera and rotates flat to face the viewer, landing the product as a frontal screen.

Use when: Introducing a real web page or app screen as the real thing while keeping the camera alive; the first frontal look at the product.

## Build it in Zenvi

1. Best look: a 3D plane. `add_3d_scene_tool {"scene": "device_mockup", "params": {"device": "laptop", "video": "<screen_recording>"}, "position_seconds": 0.0, "duration_seconds": 4.0}` and ask the scene for a tipped start (camera low, device tilted back about 25 degrees) that levels to about 8 degrees, then 0.
2. 2D fallback on the screen clip: `add_clip_to_timeline_tool {"file_id": "<screen>", "position_seconds": 0.0, "duration_seconds": 4.0, "track": "2"}`, with the tilt faked as a squash and shear: `set_keyframes_tool {"timeline_clip_id": "<screen>", "property": "scale_y", "points": [{"seconds": 0.0, "value": 0.82}, {"seconds": 1.13, "value": 1.0, "ease": "ease_out_expo"}]}` and `shear_y` easing a few degrees to 0 over the same 68 f (1.13 s).
3. Rise: `location_y` +0.25 (270 px) to -0.056 (-60 px) and scale 1 to 1.3 over 68 f (1.13 s) `ease_out_expo`, then drift linearly about 3.5 px/f (0.058 of height per second) and leave on `ease_in_cubic`.
4. Follow-through: the last 8 degrees to 0 on its own `ease_out_expo` over 20 f (0.33 s), starting 6 f (0.1 s) BEFORE the translation lands, so position and tilt settle at different moments.
5. Edge the screen with a 1.5 px solid hairline (a thin outline clip), not a lit rim. `add_sfx_tool {"recipe": "whoosh_medium", "at_seconds": 0.0, "gain_db": -16}`.

Fallback: No true perspective plane exists on a flat clip; squash plus shear gives a convincing tilt only up to about 20 degrees. For the hero version with banded depth of field, hold the tilt and skip the bands.

## Timing & taste rules

- cinetic's timing (60 fps): Rise 68 f (1.13 s) on ease_out_expo: top edge ≈ 35 px/f on the first frame, ≈ 12 px/f by f4 (0.07 s), ≈ 5.5 px/f by f8 (0.13 s), then ≈ 3.5 px/f drift and an exit at ≈ 5.5 px/f on ease_in_cubic; tilt follow-through 20 f (0.33 s), starting 6 f (0.10 s) before the position lands; hero de-skew: hold ≤ 34 f (0.57 s), then 80 f (1.33 s) on ease_out_cubic (peak edge speed ≈ 60-70 px/f at about 31%).
- Rise 68 f (1.13 s) on ease_out_expo: top edge about 35 px/f on the first frame, 12 px/f by f4, 5.5 px/f by f8, then a 3.5 px/f drift.
- Tilt 25 to 8 degrees with the rise, then 8 to 0 over 20 f (0.33 s) starting 6 f (0.1 s) early.
- Hero version: hold tilted at most 34 f (0.57 s), then de-skew over 80 f (1.33 s) on ease_in_out_sine, peak edge 60-70 px/f at about 31 %.
- Keep tilt under about 30 degrees; beyond that text shears and aliases. Do not read anything until it lands.

## Sound for it

One whoosh_medium at -16 dB peaking at the settle (about 1.1 s) and a soft impact_thud at -24 dB; none for the drift.

## Common mistakes

- The UI must be read during the move, or the tilt exceeds about 30 degrees.
- Running the same flatten within 10 s of itself.
- Settling position and tilt on the same frame: it looks mechanical.
- Avoid when: The UI must be read during the move; the plane would need more than about 30° of tilt (text shears and aliases); the same flatten ran within the last 10 s.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`pd-tilted-plane-flattens`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
