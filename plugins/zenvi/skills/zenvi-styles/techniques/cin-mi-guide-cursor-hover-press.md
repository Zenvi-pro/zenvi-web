---
id: cin-mi-guide-cursor-hover-press
kind: technique
summary: "When a person drives the product, a cursor arcs to the target, it shows hover, then a short press responds."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [guiding, human, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-pd-hard-swap-on-cause, cin-mi-focus-ring-pop-or-trim, cin-mi-shared-highlight-walk]
avoid_with: [cin-mi-focus-ring-pop-or-trim]
needs: []
drawn: cinetic
---

# Guide cursor: arrive, hover, press

cinetic `mi-guide-cursor-hover-press` · Micro-interaction · workhorse · energy any · formats walkthrough, feature, launch, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A cursor travels a bowed path to the element about to act, the target shows its hover state a few frames after the cursor arrives, and a short press triggers the response on the same frame.

Use when: A person is driving the product, and dense UI needs a point of view that shows the viewer where to look next.

## Build it in Zenvi

1. `add_motion_block_tool {"block": "cursor_path", "params": {"background": "<screenshot_or_recording>", "points": [[<x1>, <y1>], [<x2>, <y2>]], "labels": ["<label>"], "zoom": 1.0, "cursor_size": <size>, "clicks": true, "target": 1}, "position_seconds": 0.0, "duration_seconds": 5.0}` (a pointer travels a curved path, hovers each target, clicks with a ripple).
2. Calm mode: travel at 5-15 px/f on a bowed arc (bow 0.15-0.25), arriving 6-12 f (0.1-0.2 s) before the press. The target's hover fill (a 6 % ink tint) fades in over 4 f (0.07 s), starting 4 f after arrival: `set_keyframes_tool {"timeline_clip_id": "<hover_fill>", "property": "alpha", "points": [{"seconds": <arrive+0.07>, "value": 0}, {"seconds": <arrive+0.13>, "value": 1}]}`; any highlight following the cursor trails it by 4 f (0.07 s).
3. The press: 4 f (0.07 s) down, 8 f (0.13 s) recoil; the target's response (a press envelope or a state flip) starts on that same frame.
4. Snappy mode for vertical frames: the pointer about 11 % of frame height; about 300 px (0.28 of height) in 24 f (0.4 s) on `ease_out_expo` (about 72 px/f on the first frame), then dwell about 60 f (1.0 s) while the UI reacts.
5. Once the product acts on its own, fade the pointer out over 10 f (0.17 s) after its last click. `add_sfx_tool {"recipe": "mouse_click", "at_seconds": <press>, "gain_db": -20}`.

## Timing & taste rules

- cinetic's timing (60 fps): Calm: arcs at 5-15 px/f on ease_in_out_sine, bow 0.15-0.25, arriving 6-12 f (0.20 s) early; hover starts 4 f (0.07 s) after arrival and takes 4 f (0.07 s). Press: 4 f (0.07 s) down, 8 f (0.13 s) recoil (pressAt). Snappy: 300 px in 24 f (0.40 s) ease_out_expo, dwell about 60 f (1.00 s). At most one click per 30 f (0.50 s), at uneven gaps; exit fade 10 f (0.17 s).
- Calm: arcs at 5-15 px/f, bow 0.15-0.25, arrive 6-12 f (0.1-0.2 s) early; hover starts 4 f (0.07 s) after arrival and takes 4 f.
- Press 4 f (0.07 s) down, 8 f (0.13 s) recoil; at most one click per 30 f (0.5 s), at uneven gaps.
- Snappy: 300 px in 24 f (0.4 s) on ease_out_expo, dwell about 60 f (1.0 s).
- Exit fade 10 f (0.17 s).

## Sound for it

A mouse_click at -20 dB on the press frame; the travel is silent.

## Common mistakes

- The product acts on its own: no pointer is needed.
- Clicks faster than one per 30 f (0.5 s): it reads as a macro.
- A pointer plus a focus ring on the same control: pick one.
- Avoid when: The product acts on its own, clicks would come faster than one per 30 f, or the shot already has a pointer such as a focus ring.

## Verified

2026-10-31, `~/zenvi-motion/fleet/artifacts/x2-cinetic/verify/cin-mi-guide-cursor-hover-press.mp4` (1280x720p60, cursor_path motion block (full frame, background a test-pattern still, two stops Open and Send, cursor_size 0.6, target 170, 5 s) with a mouse_click at 1.9 s): the pointer starts bottom right, reaches the first stop with a hover outline and an Open label pill by about 1.55 s, and the second stop with a Send pill by about 3.4 s; click time is the block's own, so the sfx has to be read off frames (I placed 1.9 s by eye); judged on picture only; watch judge 1.8/10.

Found when rendering it (apply before building):

- Step 1: params.points must be a list of {x, y} objects (x and y 0-1): [{"x": 0.25, "y": 0.3}, {"x": 0.7, "y": 0.65}]; the [[x, y]] arrays are refused (Error: points must be a list of {x, y} points).
- Step 1: params.target is the hover outline width in px at 1080 (default 170), not 1; cursor_size is a multiple of 88 px at 1080 (0.6 reads small at 720p, use 1 or more). background takes a media-bin file id (a still worked); without placement it rendered full frame.
- Steps 2-3: the block has no timing parameters: the pointer reached the first stop about 1.5 s into a 5 s block and the second near 3.4 s, so read the arrival and press frames off a render before placing the mouse_click, and do not expect the 6-12 f arrival lead or the 4 f hover fill to be controllable; the hover fill and press recoil are inside the block, not separate clips with an alpha curve.

Translated from cinetic's technique library (`mi-guide-cursor-hover-press`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
