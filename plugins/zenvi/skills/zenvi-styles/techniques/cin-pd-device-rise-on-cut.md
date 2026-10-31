---
id: cin-pd-device-rise-on-cut
kind: technique
summary: "When the first product shot follows a type card, the device rises already moving on the cut and slows into place."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, color_grade_clip_tool, add_3d_scene_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [confident, smooth, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-pd-hard-swap-on-cause, cin-pd-tilted-plane-flattens, cin-pd-pin-field-pullback]
avoid_with: [cin-ui-shell-first-build, cinematic-push-in]
needs: []
drawn: cinetic
---

# Device rises already moving

cinetic `pd-device-rise-on-cut` · Product demo · workhorse · energy medium · formats launch, feature, walkthrough, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A phone or app window enters from below already travelling on the cut frame and decelerates into place near centre while the whole shot slowly scales down.

Use when: The first product shot after a type card or a photo, when the previous shot's energy should carry straight into the product.

## Build it in Zenvi

1. Backdrop, a photo kept grey so the device is the only colour: `add_clip_to_timeline_tool {"file_id": "<photo>", "position_seconds": 0.0, "duration_seconds": 4.0, "track": "1"}` then `color_grade_clip_tool {"timeline_clip_id": "<photo>", "saturation": 0, "contrast": 1.1, "exposure": -0.5}`.
2. Device (a screen recording in a phone frame, or `add_3d_scene_tool {"scene": "device_mockup", "params": {"video": "<recording>"}, "duration_seconds": 4.0}`): `add_clip_to_timeline_tool {"file_id": "<device>", "position_seconds": 0.0, "duration_seconds": 4.0, "track": "2"}`.
3. Rise already moving on the cut frame: `set_keyframes_tool {"timeline_clip_id": "<device>", "property": "location_y", "points": [{"seconds": 0.0, "value": 0.14}, {"seconds": 0.73, "value": 0, "ease": "ease_out_expo"}]}` (140-160 px at 1080p = 0.13-0.15 of height over 44 f = 0.73 s; first frame about 20 px/f). No fade-in.
4. The whole shot scales down 1 to 0.9 over 48 f (0.8 s): `scale_x` and `scale_y` points `{"seconds": 0.0, "value": 1.0}` to `{"seconds": 0.8, "value": 0.9, "ease": "ease_out_cubic"}` on both clips.
5. Peek variant: rise 170 px (0.157) in 14 f (0.23 s) `ease_out_expo`, hover 4 f (0.07 s), then the rest in 40 f (0.67 s) on `ease_in_out_expo`, scale drift 1 to 0.93 over 60 f (1.0 s).
6. `add_sfx_tool {"recipe": "whoosh_short", "at_seconds": 0.0, "gain_db": -18}`.

## Timing & taste rules

- cinetic's timing (60 fps): On a cut: 140-160 px over 44 f (0.73 s) on ease_out_expo, first frame ≈ 6.2 × rise / 44 (about 20-23 px/f), 75% of the travel by f9 (0.15 s), settled by f44 (0.73 s); shot scale 1 → 0.9 over 48 f (0.80 s) on ease_out_cubic. Over a title: ≈ 1,000 px in 48 f (0.80 s) on ease_out_cubic, title fade 36 f (0.60 s) starting 16 f (0.27 s) early. Peek variant: 14 f (0.23 s) peek, 4 f (0.07 s) hover, 40 f (0.67 s) launch on ease_in_out_expo, 60 f (1.00 s) scale drift.
- 140-160 px over 44 f (0.73 s) on ease_out_expo; 75 % of the travel done by f9 (0.15 s), settled by f44; first frame about 20-23 px/f.
- Shot scale 1 to 0.9 over 48 f (0.8 s) on ease_out_cubic under the rise.
- Rise from a full frame height over 48 f (0.8 s) only when pushing a title away; fade the title from 16 f (0.27 s) before.
- Backdrop desaturated so the device is the only colour; its shadow travels with it.

## Sound for it

A whoosh_short at -18 dB peaking on the cut frame, a soft impact_thud at -26 dB as it settles (0.73 s); nothing when the device is already on screen.

## Common mistakes

- The device is already on screen, or the film is calm and a 20 px/f arrival feels pushy.
- The third rise in a row: vary with a tilt or a pull-back.
- Fading the device in: the cut hides the start, a fade makes it float.
- Avoid when: The device is already on screen; a calm film where a 20 px/f arrival feels pushy; it would be the third rise in a row (vary with a tilt or a pull-back).

## Verified

2026-10-31, `~/zenvi-motion/fleet/artifacts/x2-cinetic/verify/cin-pd-device-rise-on-cut.mp4` (1280x720p60, bars test pattern graded to grey (saturation 0, contrast 0.1, exposure -0.5) under a coloured test-pattern device card (scale 0.45): location_y 0.14 to 0 over 0.73 s ease_out_expo, both clips scaling to 0.9 of their size over 0.8 s ease_out_cubic, whoosh_short at 0): frames 0.12-0.87 s show the colour card moving up already on the first frame while the grey backdrop is the only other element, both settling smaller; add_3d_scene_tool device_mockup also rendered (75 s) with file_id; watch judge 2.1/10.

Found when rendering it (apply before building):

- Step 1: color_grade_clip_tool contrast is -1..1 (1.1 is refused); use contrast 0.1 for a 10 % lift. saturation 0 and exposure -0.5 are valid.
- Step 2: add_3d_scene_tool device_mockup takes the recording as params.file_id (a media-bin file id) and optional media_start_seconds, not params.video (params: Unrecognized key video); a final render took about 75 s for 1 s of picture.
- Steps 3-4: when the device is a smaller object (the card here is scale 0.45), the shot-wide 1 to 0.9 scale has to start from each clip's own base scale (base to base*0.9), and the rise is added to location_y; with a full-size clip the file's values work as written.

Translated from cinetic's technique library (`pd-device-rise-on-cut`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
