---
id: cin-cam-crane-push
kind: technique
summary: "When the eye must travel down a long page: the camera tilts past the chart to the cards while a slow push builds."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [set_keyframes_tool, screen_zoom_follow_tool]
pace: calm
mood: [measured, reading, editorial]
aspect: ["16:9", "9:16"]
pairs_with: [cin-cam-breathing-zoom, shot-crane-rise-reveal, screen-capture-zoom-onto-the-number]
avoid_with: [cin-cam-hero-push-yaw, shot-crash-zoom-punch]
needs: []
drawn: cinetic
---

# Crane down with a delayed push

cinetic `cam-crane-push` · Camera · accent · energy calm · formats walkthrough, feature, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The camera tilts down the page past the chart to the detail cards while a slow push-in builds behind it, as if the operator were leaning in to read.

Use when: Moving down a long page or dashboard from the overview to the detail that matters.

## Build it in Zenvi

1. The long page as a tall screen recording or image, longer than ~500 px of travel. Sum the main tilt and the overlapping drift on `location_y`: `set_keyframes_tool {"timeline_clip_id": "<page>", "property": "location_y", "mode": "replace", "points": [{"seconds": <a>, "value": 0}, {"seconds": <a+1.07>, "value": -0.32, "ease": "ease_in_out_sine"}, {"seconds": <a+3.67>, "value": -0.5, "ease": "ease_out_cubic"}]}`: main move ~240 px (0.22 of the height) on 64 f (1.07 s), plus a 300 px drift from `a+40 f` to `a+220 f` (0.67 to 3.67 s) that overlaps it, so the motion never stalls.
2. The delayed push: `scale_x` / `scale_y` `[{"seconds": <a+0.67>, "value": 1.0}, {"seconds": <a+4.0>, "value": 1.22, "ease": "ease_out_cubic"}]`, +22 % from `a+40 f` to `a+240 f` (0.67 to 4.0 s), peaking near +0.35 %/f at `a+98 f` (1.63 s).
3. Pivot so the push does not drift sideways: `origin_x` set to the column the viewer reads (e.g. 0.30).
4. One-call route: `screen_zoom_follow_tool {"clip_id": "<page>", "zoom": 1.22, "ease": "ease_in_out_sine", "min_hold": 1.2}`.

## Timing & taste rules

- cinetic's timing (60 fps): Main tilt 64 f (1.07 s) on ease_in_out_sine, about 240 px, peak about 10 px/f mid-move. Drift 300 px from a + 40 to a + 220 on ease_out_cubic (peaks near 5.8 px/f, under 0.5 px/f by the end). Push +22% from a + 40 to a + 240 on ease_out_cubic, peak about +0.35%/f near a + 98.
- Main tilt 64 f (1.07 s) on a smooth ease, ~240 px, peak ~10 px/f mid-move.
- Drift 300 px from f40 to f220 (0.67-3.67 s) on a long ease-out (peaks near 5.8 px/f, under 0.5 px/f by the end).
- Push +22 % from f40 to f240 (to 4.0 s), peak ~+0.35 %/f near f98 (1.63 s), starting 40 f late.
- `origin_x` on the reading column, so no sideways drift.
- Pages need 500 px or more of travel.

## Sound for it

None; a soft room tone or music bed carries it.

## Common mistakes

- Pages too short to travel 500 px, or vertical formats where the push crops the column (avoid_when).
- Starting the push with the tilt: it should come 40 f later and peak while the tilt decelerates.
- Stopping the tilt dead: the overlapped drift keeps it alive.
- Avoid when: Pages too short to travel 500 px or more, or vertical formats where the push crops the column.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cam-crane-push`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
