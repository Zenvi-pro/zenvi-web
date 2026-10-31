---
id: cin-d3-spotlit-tilted-object
kind: technique
summary: "When a card or device should feel like an object in a room: tilted on a dark ground under one soft pool of light."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_3d_scene_tool, add_clip_to_timeline_tool, set_keyframes_tool, add_shape_mask_tool, add_vignette_tool]
pace: calm
mood: [moody, premium, low-key]
aspect: ["16:9", "1:1"]
pairs_with: [shot-spotlight-hero-card, t005, shot-light-sweep]
avoid_with: [shot-tilted-plane-glide, cinematic-teal-orange]
needs: [perspective-plane-showcase]
drawn: cinetic
---

# Tilted object on a spotlit ground

cinetic `d3-spotlit-tilted-object` · Depth and 3D · workhorse · energy calm · formats launch, feature, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A real card or device lies in perspective on a dark surface under one soft pool of light. Most of the frame falls to black, and a slow drift slides the light across the object's face.

Use when: A single notification, card or device should feel like an object in a room, not on a slide, especially in a dark, low-key film.

## Build it in Zenvi

1. Best result, real perspective: `add_3d_scene_tool {"scene": "device_mockup", "params": {"file_id": "<ui_video>", "device": "tablet", "move": "orbit"}, "position_seconds": 0, "duration_seconds": 3, "quality": "final"}` on a near-black stage; its camera yaw of 0.1 deg/f (6 deg/s) is the orbit.
2. If it must stay in 2D: the card on its ground plate, both about 0.55 of the frame width, centre-right: `add_clip_to_timeline_tool {"file_id": "<card>", "position_seconds": 0, "duration_seconds": 3, "track": 2}`; apply `set_keyframes_tool` `rotation` +4 and `shear_x` -0.15 to suggest the tilt, and a drift `location_x` 0 to -0.026 over the shot (-0.5 px/f is about -30 px/s), `interpolation: "linear"`, eased in from rest over about 60 f (1.0 s).
3. The pool of light: a soft ellipse over the object, 35-40 % of the frame, at 60 %/55 %, as a mask on a white title card at 12 % opacity: `add_shape_mask_tool {"clip_ids": ["<light_card>"], "shape": "ellipse", "x": 0.6, "y": 0.55, "width": 0.7, "height": 0.7, "feather": 0.4}` and `set_keyframes_tool` `alpha` 0.12. Fixed in screen space while the object drifts.
4. Edges to black: `add_vignette_tool {"clip_ids": ["<stage>"], "amount": 0.4, "feather": 0.7}`.
5. Soft contact shadow under the card (blur 36 px, alpha 0.35) offset away from the pool: bake it into the card's PNG. The card is solid, not frosted; let its content change state over 10-14 f (0.17-0.23 s) while the plane drifts.

Fallback: Without Blender, the tilt is only a rotation and shear approximation, not a true perspective plane; say so.

## Timing & taste rules

- cinetic's timing (60 fps): Shot 30-84 f (1.40 s). Drift 0.5 px/f linear (eased in from rest over about 60 f (1.00 s) at a seam), plus yaw 0.03 deg/f or an orbit of 0.1 deg/f. Pool radius about 35-40% of the frame. Content state changes over 10-14 f (0.23 s) on ease_in_out_cubic.
- Shot 30-84 f (0.5-1.4 s) in the original, 3 s here to let the light travel.
- Drift 0.5 px/f linear, eased in from rest over about 60 f (1.0 s); yaw +0.03 deg/f, or an orbit of 0.1 deg/f for a device.
- Pool radius about 35-40 % of the frame; edge vignette 35-40 %.
- Content state changes over 10-14 f (0.17-0.23 s).

## Sound for it

None, or one soft room_tone bed at -30 dB; a content change gets one quiet ui_tap.

## Common mistakes

- Tilting things on this axis when the act already does; or a bright flat film.
- A bare screenshot without ground and shadow: it reads as a slide.
- A frosted card: fill it solid so the light lands on a surface.
- Avoid when: The same act already tilts things on this axis, or the film is bright and flat; never on a bare screenshot without ground and shadow.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`d3-spotlit-tilted-object`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
