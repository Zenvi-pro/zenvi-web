---
id: cin-cl-tilt-linked-sheen
kind: technique
summary: "When a card or device tilts in 3D and settles: a faint highlight band slides across its face with the angle, then parks."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_3d_scene_tool, add_title_tool, add_shape_mask_tool, set_keyframes_tool]
pace: calm
mood: [tactile, premium, glossy]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-key-light-edge-hairline, shot-tilted-plane-glide]
avoid_with: [cin-cl-rim-light-sweep]
needs: [rotation-linked-sheen]
drawn: cinetic
---

# Tilt-linked sheen

cinetic `cl-tilt-linked-sheen` · Colour and light · accent · energy calm · formats launch, feature, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

As a card or device tilts in 3D, a faint highlight band slides across its face in step with the angle, so the surface reads as a real material catching a key light.

Use when: Perspective UI tilt-ups, cards flipping or settling out of 3D, device turns, and logo tiles yawing.

## Build it in Zenvi

1. The tilting surface: `add_3d_scene_tool {"scene": "device_mockup", "params": {"device": "laptop", "video_file_id": "<ui_clip>"}, "position_seconds": 0, "duration_seconds": 3}`, or a flat card whose tilt settles from 12 degrees to 0 over 40 f (0.67 s, ease_out_expo).
2. The sheen is a faint white band on a track above: `add_title_tool {"text": " ", "background_color": "#ffffff2e", "position_seconds": 0, "duration_seconds": 3, "track": "<above>"}` (alpha about 0.18 on dark UI, 0.10 on light) plus `add_shape_mask_tool {"clip_ids": ["<sheen>"], "shape": "polygon", "points": [{"x": 0.42, "y": 0}, {"x": 0.56, "y": 0}, {"x": 0.46, "y": 1}, {"x": 0.32, "y": 1}], "feather": 0.04}`.
3. Slide it in step with the tilt, parking when the tilt parks: `set_keyframes_tool {"timeline_clip_id": "<sheen>", "property": "location_x", "points": [{"seconds": 0, "value": 0.3}, {"seconds": 0.67, "value": 0, "ease": "ease_out_expo"}]}` (about 30 % travel) and `alpha` 0.18 to 0 only on the way into the settle, so a flat card is clean.

Fallback: The band is a separate layer keyed by hand to the tilt; it does not read the 3D rotation, and a 3D scene's inside is not maskable. If the tilt is a rendered scene, time the band to its keyframes by eye and keep the opacity at 0.10.

## Timing & taste rules

- cinetic's timing (60 fps): It follows the tilt move: for example, rotateY going from 12° to 0 over 40 f (0.67 s) on ease_out_expo moves the band about 30% and parks it. Peak overlay opacity is 0.18 on dark UI and 0.10 on light UI.
- One key light for the whole film, 45 degrees camera-left; every card catches it from the same side.
- Band moves about 30 % of the card width while the tilt settles from 12 degrees to 0 in 40 f (0.67 s, ease_out_expo), then parks.
- Peak overlay opacity 0.18 on dark UI, 0.10 on light UI; opacity scales with the tilt so a flat card is clean.
- Band sits inside the card face, above content and below the border.

## Sound for it

None; the sheen is quiet. The settle itself may carry one soft `ui_tap` (-20 dB) on the last frame.

## Common mistakes

- Flat 2D layouts with no rotation: use the one-shot specular sweep instead.
- A band that keeps sliding after the card has stopped turning.
- A different key-light side on different cards.
- Avoid when: Flat 2D layouts with no rotation (use the one-shot specular sweep instead).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-tilt-linked-sheen`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
