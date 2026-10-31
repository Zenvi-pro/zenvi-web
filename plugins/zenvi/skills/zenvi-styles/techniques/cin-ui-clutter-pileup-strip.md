---
id: cin-ui-clutter-pileup-strip
kind: technique
summary: "When a product cuts chaos to one thing, copies of a control pile up, then vanish one per beat to a single tile."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_emoji_tool, duplicate_clips_tool, set_clip_properties_tool, move_clips_tool, set_keyframes_tool, trim_clips_tool, add_sfx_tool]
pace: fast
mood: [overloaded, abrupt, focused]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-ui-stalled-state, cin-ui-discard-into-bin, shot-jump-cut-punch-in]
avoid_with: [shot-blur-slide, cinematic-push-in]
needs: []
drawn: cinetic
---

# Clutter pile-up, then strip to one

cinetic `ui-clutter-pileup-strip` · UI choreography · accent · energy high · formats launch, feature, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Clicks spawn copies of a control until the frame is a messy pile, then elements vanish one per beat and the survivors snap to re-centre until a single tile remains.

Use when: Showing overload (too many tools, buttons, tabs, notifications) and then focus: the product reduces chaos to the one thing that matters.

## Build it in Zenvi

1. The control (a button, a tab, a toast): `add_emoji_tool {"emoji": "<icon>", "size": 0.1, "position_seconds": 0.0, "duration_seconds": 1.6, "track": "<n>"}`.
2. Pile-up: 14 copies, one every 4 f (0.067 s) for 60 f (1.0 s): `duplicate_clips_tool {"timeline_clip_ids": ["<id>"], "copies": 14, "to_track": "<n+1>"}`, then place each: `set_clip_properties_tool {"timeline_clip_id": "<copy_i>", "properties": {"location_x": <(rand_i-0.5)*0.26>, "location_y": <(rand_i-0.5)*0.28>}}` (500 px / 300 px at 1080p, offsets of 40-80 px from the previous copy) and start each at its own second (`move_clips_tool`, 0.067 s apart).
3. Each copy pops in over 8 f (0.13 s): `set_keyframes_tool {"property": "scale_x", "points": [{"seconds": <start>, "value": 0.9}, {"seconds": <start+0.13>, "value": 1.0, "ease": "ease_out_expo"}]}`; drift the whole pile up 1.5 px/f (0.025 of height per second) with `location_y` on every copy.
4. Strip: one removal every 5-7 f (0.08-0.12 s): `trim_clips_tool {"timeline_clip_ids": ["<copy_k>"], "trim_end_seconds": <t_k>}`; survivors re-centre instantly: `set_keyframes_tool {"property": "location_x", "interpolation": "constant", "points": [{"seconds": <t_k>, "value": <new>}]}`.
5. Last survivor holds 17 f (0.28 s) under a 0.5 % scale drift, then exits or becomes the next shot.
6. Ticks rising in level: `add_sfx_tool {"recipe": "ui_tap", "at_seconds": <t>, "gain_db": -26}` per spawn and per removal, +0.5 dB each.

## Timing & taste rules

- cinetic's timing (60 fps): Spawns every 4 f (0.07 s) for ~60 f (12-15 clones), 8 f (0.13 s) each (ease_out_expo, 40-80 px), pile drift 1.5 px/f. Removals every 5-7 f (0.12 s) with an instant re-centre (fd); last survivor 17 f (0.28 s) with a 0.5% drift.
- Spawn every 4 f (0.067 s) for about 60 f (1.0 s): 12-15 clones; each pops over 8 f (0.13 s) on ease_out_expo and travels 40-80 px from the last.
- Removal every 5-7 f (0.08-0.12 s) with an instant re-centre (constant interpolation, no tween).
- Last survivor holds 17 f (0.28 s) with a 0.5 % drift.
- Keep the pile centred in the safe area; the pile drifts up only 1.5 px/f.

## Sound for it

A soft tick on every spawn and removal, climbing in level so the acceleration is heard; the last survivor gets one pop at -12 dB.

## Common mistakes

- Calm or premium films, or elements whose text must be read: the jumps are deliberately abrupt.
- Tweening the re-centre: it must jump on the removal frame.
- A flat tick level: the build only feels fast if the level rises.
- Avoid when: Calm or premium films, or elements whose text must be read; the jumps are deliberately abrupt.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ui-clutter-pileup-strip`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
