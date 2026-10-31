---
id: cin-cam-cursor-whip-orbit
kind: technique
summary: "When a cursor leads to a distant panel: the camera whips across the product, yawing and rolling slightly."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, apply_motion_transition_tool, apply_fx_tool]
pace: fast
mood: [dynamic, dimensional, guided]
aspect: ["16:9"]
pairs_with: [shot-cursor-flyover, t005, cin-cam-hero-push-yaw]
avoid_with: [cin-cam-push-dutch-roll]
needs: [perspective-plane-showcase]
drawn: cinetic
---

# Cursor-led whip orbit

cinetic `cam-cursor-whip-orbit` · Camera · accent · energy high · formats walkthrough, feature, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Following a cursor that leads the way to the next panel, the camera swings fast across the product, yawing to show the slab's thick edge and rolling slightly.

Use when: Moving between two distant panels of one product in a single-take or walkthrough film, where a cut would lose the spatial relationship.

## Build it in Zenvi

1. The cursor leads: `add_motion_block_tool {"block": "cursor_path", "position_seconds": <a-0.08>, "duration_seconds": 1.4, "placement": "over_video", "params": {"points": [[0.25,0.5],[0.75,0.45]], "clicks": true, "zoom": 1.0}}`; it starts 5 f (0.08 s) before the camera and leads by 4-6 f.
2. The whip over 74 f (1.23 s): `set_keyframes_tool {"timeline_clip_id": "<screen>", "property": "location_x", "mode": "replace", "points": [{"seconds": <a>, "value": 0}, {"seconds": <a+1.23>, "value": -0.4, "ease": "ease_in_out_expo"}]}` with `scale_x/scale_y` 1.0 to 0.77, `rotation` 0 to -10 (degrees) and `shear_x` 0 to -0.1 for the yaw, same ease.
3. Smear the peak (~47 px/f): `apply_fx_tool {"clip_id": "<screen>", "effects": [{"effect": "directional_blur", "amount": 0.6, "params": {"angle": 0}, "start": <a+0.3>, "end": <a+0.8>}]}`; or `apply_motion_transition_tool {"preset": "whip", "direction": "right", "duration": 0.4}` between two crops.
4. Add a 24-40 px darker side face to the panel (a thin dark strip clip along its right edge) so the yaw reveals thickness.
5. True 3D version: `add_3d_scene_tool {"scene": "device_mockup", "params": {"motion": "orbit"}}`.

Fallback: A true yaw with a visible side edge needs the 3D plane; on flat footage the whip, a few degrees of roll and a faint shear sell most of it. Use the device_mockup scene when the thickness matters.

## Timing & taste rules

- cinetic's timing (60 fps): 74 f (1.23 s) on ease_in_out_expo, peak about 47 px/f at around 40% of the move. Yaw 0 -> 24 deg, roll 0 -> -10 deg, zoom x0.77. The cursor leads by 4-6 f (0.10 s).
- 74 f (1.23 s) on a whip ease, peak about 47 px/f at around 40 % of the move.
- Yaw 0 to 24 degrees, roll 0 to -10 degrees, zoom x0.77.
- The cursor leads the camera by 4-6 f (0.07-0.10 s).
- 24-40 px side face on the slab, hinged on the right edge.
- Needs motion blur at the peak.

## Sound for it

A `whip` (SFX recipe) peaking with the move, panned with the cursor; a click when the cursor lands.

## Common mistakes

- No cursor or lead to motivate the whip, or yaw already used for something else in the act (avoid_when).
- A cursor that arrives after the camera: it must lead.
- No blur at the peak: the whip reads as a slide.
- Avoid when: There is no cursor or other lead to motivate it (an unmotivated whip reads as a flourish), or the act already uses yaw for something else.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cam-cursor-whip-orbit`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
