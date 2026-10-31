---
id: cin-cam-hero-push-yaw
kind: technique
summary: "When one panel is the film's peak: a single 2.5x push from the whole app turns it toward the viewer, caption beside it."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [set_keyframes_tool, add_kinetic_title_tool, add_3d_scene_tool, add_sfx_tool]
pace: fast
mood: [cinematic, dimensional, hero]
aspect: ["16:9"]
pairs_with: [t005, shot-tilted-plane-glide, shot-station-flythrough]
avoid_with: [cin-cam-push-dutch-roll, cin-cam-cursor-whip-orbit]
needs: [perspective-plane-showcase]
drawn: cinetic
---

# Hero push with a 3D turn

cinetic `cam-hero-push-yaw` · Camera · signature · energy high · formats launch, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

From a wide view of the whole app, one continuous move pushes 2.5x into a single panel while yawing, so the panel turns toward the viewer and an empty side of the frame opens for the caption.

Use when: The film's energy peak: the one feature that needs both spatial orientation and close-up legibility, or a scene change inside a single-take film.

## Build it in Zenvi

1. The app recording on track 1. Push 2.5x into the panel (panel on the right of frame, so the empty side is the left for the caption): `set_keyframes_tool {"timeline_clip_id": "<app>", "property": "scale_x", "mode": "replace", "points": [{"seconds": <a>, "value": 1.0}, {"seconds": <a+1.0>, "value": 2.56, "ease": "ease_in_out_sine"}]}` (and `scale_y`), 60 f (1.0 s); `location_x` / `location_y` keyframed so the panel centre lands at 0.67 of the width: `-(panel_x - 0.67) * 2.56` on the same ease.
2. The turn toward the viewer (yaw 24-30 degrees, pitch ~5): `shear_x` 0 to -0.12 (approximating the yaw) on the same ease. For a true 3D turn, render the panel on a device instead: `add_3d_scene_tool {"scene": "device_mockup", "params": {"device": "tablet", "video_file_id": "<app>", "motion": "push_in"}, "position_seconds": <a>, "duration_seconds": 2.0}`.
3. Caption in the void at f45 (0.75 s, the last 25 % of the move): `add_kinetic_title_tool {"text": "Everything in *one* view", "position_seconds": <a+0.75>, "duration_seconds": 2.5, "style": "editorial", "animation": "rise", "y": 0.5}`.
4. Hold alive with a +2.5 % breath: `scale_x/scale_y` `[{"seconds": <a+1.0>, "value": 2.56}, {"seconds": <a+2.5>, "value": 2.62, "ease": "ease_in_out_sine"}]`.
5. Check the panel's smallest meaningful text is >= 22 px on screen at 2.56x. Add `motion_blur` on any motion block. `add_sfx_tool {"recipe": "whoosh_long", "at_seconds": <a+0.15>, "gain_db": -12}`.

Fallback: A real yaw (perspective) needs the panel as a 3D plane; shear_x on a flat recording is a poor stand-in and best kept to a few percent. Use the device_mockup 3D scene when the turn is the point.

## Timing & taste rules

- cinetic's timing (60 fps): 60 f (1.00 s) on ease_in_out_sine, 10-90% of progress between 29% and 71% of the move, peak about 4.5%/f scale (around 47 px/f on screen) at 50%. Zoom 1 -> 2.56; yaw 0 -> 24-30 deg and pitch 0 -> 5 deg on the same curve. Caption starts at 75% of the move. Hold breath +2.5%.
- 60 f (1.0 s) on a smooth ease; 10-90 % of the progress between 29 % and 71 % of the move; peak about 4.5 % scale per frame (~47 px/f on screen) at 50 %.
- Zoom 1 to 2.56; yaw 0 to 24-30 degrees and pitch 0 to 5 degrees on the same curve.
- Caption starts at 75 % of the move (f45 / 0.75 s), so the word reveal and the settle read as one gesture.
- Hold breath +2.5 % (never a dead lock).
- Once per film; each act on its own rotation axis.

## Sound for it

One long `whoosh_long` under the push, a soft `sub_drop` as it settles; the caption has none.

## Common mistakes

- More than once per film, or on a lone card with no surrounding app (the turn needs a world to orient against) (avoid_when).
- Text on the panel smaller than ~22 px on screen at the end.
- Starting the caption before the last quarter of the move.
- Avoid when: More than once per film, or on a lone card with no surrounding app (the turn needs a world to orient against). Keep each act on its own rotation axis.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cam-hero-push-yaw`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
