---
id: cin-cam-lead-follow
kind: technique
summary: "When one thing travels through a layout: the camera follows a lead dot with a soft lag and never quite stops."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, screen_zoom_follow_tool, add_sfx_tool]
pace: medium
mood: [guiding, smooth, narrative]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-glow-flyline, cin-tr-path-relay, cin-cam-fit-bounds-follow]
avoid_with: []
needs: []
drawn: cinetic
---

# Follow the lead dot

cinetic `cam-lead-follow` · Camera · workhorse · energy medium · formats walkthrough, feature, vertical, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A small lead (a progress dot, a travelling packet, a drawing line's head) moves through the layout and the camera follows it with a soft lag, never quite stopping, so the viewer always knows where to look.

Use when: Agent progress, pipelines, timelines and journeys across a map: any story told by one thing moving through a layout.

## Build it in Zenvi

1. The layout and its lead: a tall steps layout (screenshot, `data_table` or `chart_build`) with a dot travelling through it (`cursor_path` block with `cursor_size` small, or a flat accent dot clip with no halo).
2. Camera follows with a 12 f (0.2 s) lag, so sample the lead's screen position every ~0.2 s and write the camera as the lead delayed: `set_keyframes_tool {"timeline_clip_id": "<layout>", "property": "location_y", "mode": "replace", "points": [{"seconds": 0, "value": 0}, {"seconds": 0.67, "value": -0.12, "ease": "ease_out_cubic"}, {"seconds": 1.33, "value": -0.25, "ease": "ease_out_cubic"}, {"seconds": 2.0, "value": -0.37, "ease": "ease_out_cubic"}]}` keeping the lead near 40 % of the frame height; plus a constant 2 px/f (0.002 frame per frame) drift in the travel direction, so it never stops.
3. Quicker route: `screen_zoom_follow_tool {"clip_id": "<layout>", "zoom": 1.25, "ease": "ease_out_cubic", "cursor": true, "rate": 0.6}`.
4. Reveal each step row as the lead passes: `set_keyframes_tool {"timeline_clip_id": "<row n>", "property": "alpha", "mode": "replace", "points": [{"seconds": <tPass>, "value": 0}, {"seconds": <tPass+0.2>, "value": 1, "ease": "ease_out_cubic"}]}` with a 12 px rise (`location_y` 0.011 to 0).
5. At the destination, punch in or ease to rest. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": <tPass>, "gain_db": -22}` per step, soft.

## Timing & taste rules

- cinetic's timing (60 fps): Lag coefficient 0.08 per frame (time constant about 12 f (0.20 s)). Peak 12.5 px/f, residual drift 2-2.5 px/f, never 0. Step rows reveal over 12 f (0.20 s) as the lead passes. Bumps between steps about 40 f (0.67 s).
- Lag coefficient 0.08 per frame (time constant ~12 f / 0.2 s).
- Peak speed 12.5 px/f, residual drift 2-2.5 px/f, never 0.
- Step rows reveal over 12 f (0.2 s) as the lead passes; bumps between steps about 40 f (0.67 s).
- The lead is a flat dot in the one accent colour, no halo.
- At a corner the lead turns first and the lag carries the camera's turn.

## Sound for it

One very soft `ui_tap` per step the lead passes (-22 dB); nothing for the travel.

## Common mistakes

- The lead moves faster than ~20 px/f for long stretches (the lag lets it escape), or the whole layout fits one framing (avoid_when).
- A camera that stops dead between steps: it keeps a 2 px/f drift.
- A glowing lead: it is a flat dot.
- Avoid when: The lead moves faster than about 20 px/f for long stretches (the lag lets it escape the frame), or the whole layout fits in one framing.

## Verified

2026-10-31, `~/zenvi-motion/fleet/artifacts/x2-cinetic/verify/cin-cam-lead-follow.mp4` (1280x720p60, test-pattern UI at scale 2.5 with 36 linear location_y keyframes computed as a first-order lag (0.08 per frame) of a dot that steps down in three moves, plus a 64 px flat orange dot clip with its own location_y track): the layout scrolls under the dot, which stays within about 0.05 of the frame height of its 40 % mark and never freezes; row reveals, ui_tap sounds and screen_zoom_follow_tool were not built; watch judge 1.9/10 (stand-in media).

Found when rendering it (apply before building):

- Step 2: the lag cannot be written as four ease_out_cubic points; sample the lead every 6 f and write the camera as a first-order lag of it (cam += (lead - cam) * 0.08 per frame, plus 0.002 per frame drift) with "interpolation": "linear" and mode replace (36 points for 3.5 s was accepted); the lead (flat dot) needs its own location_y keyframes = lead - camera, as a separate clip on a track above the layout (a 64 px dot.png needs scale ~0.05; an image fills the frame at scale 1).
- Step 3: screen_zoom_follow_tool args are wrong: ease is a number (seconds each push/pan/pull takes, default 0.45, max 2), "ease_out_cubic" is refused; cursor is object[] of click positions (0-1 over source time), not true; rate is the analysis frames per second (1-15), not a lag rate; there are also min_hold and stops [{source seconds, 0-1 point}].
- Step 2: layout must be scaled (here 2.5) so there is room to travel without showing black; a tall layout at scale 1 has none.

Translated from cinetic's technique library (`cam-lead-follow`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
