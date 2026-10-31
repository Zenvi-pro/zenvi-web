---
id: cin-cam-push-dutch-roll
kind: technique
summary: "When a push would feel mechanical: dive into one corner of the UI, rolling a few degrees off level, and land level."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [handheld, organic, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-cursor-flyover, cin-cam-isolating-push, cinematic-push-in]
avoid_with: [cin-cam-hero-push-yaw, cin-cam-cursor-whip-orbit]
needs: []
drawn: cinetic
---

# Push-in with a roll swing

cinetic `cam-push-dutch-roll` · Camera · accent · energy medium · formats launch, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The camera dives into one corner of the UI, rolls a few degrees off level mid-dive like a hand-steered move, and rolls back to level as it lands.

Use when: A push that would otherwise feel mechanical: diving into a settings corner, a sidebar or a detail panel.

## Build it in Zenvi

1. Push 2.09x onto the corner element, which stays at its current screen point as the frame grows around it: `set_keyframes_tool {"timeline_clip_id": "<screen>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 0, "value": 1.0}, {"seconds": 1.0, "value": 2.09, "ease": "ease_in_out_sine"}]}` and `scale_y`; set `origin_x` and `origin_y` on the element's centre so it holds position (e.g. 0.88, 0.12 for a top-right corner).
2. The roll on its own curve, two eased segments: `set_keyframes_tool {"timeline_clip_id": "<screen>", "property": "rotation", "mode": "replace", "points": [{"seconds": 0, "value": 0}, {"seconds": 0.57, "value": -4, "ease": "ease_in_out_sine"}, {"seconds": 1.0, "value": -0.3, "ease": "ease_in_out_sine"}]}` (-4 degrees by 57 % of the move, back to -0.3 at the end).
3. Optional tilted landing: `shear_y` 0 to 0.1 over the last 24 f (0.4 s), `ease_in_out_sine` (the pitch).
4. Keep |roll| under 11 degrees and the move at 60 f (1.0 s) or longer. `add_sfx_tool {"recipe": "whoosh_short", "at_seconds": 0.2, "gain_db": -18}`.

## Timing & taste rules

- cinetic's timing (60 fps): 60 f (1.00 s); zoom 1 -> 2.09 on ease_in_out_sine in log space, peak about 3.5%/f mid-move. Roll 0 -> -4 deg by 57% of the move, back to -0.3 deg at the end, each segment ease_in_out_sine. Optional pitch 0 -> 8 deg over the last 24 f (0.40 s).
- 60 f (1.0 s); zoom 1 to 2.09 on a smooth ease, peak about 3.5 %/f mid-move.
- Roll 0 to -4 degrees by 57 % of the move, back to -0.3 degrees at the end; each segment eased.
- Optional pitch 0 to 8 degrees over the last 24 f (0.4 s).
- |roll| under 11 degrees; one rotation axis per act.
- Moves under 40 f (0.67 s) make the roll read as a wobble.

## Sound for it

A faint `whoosh_short` at the start, nothing on the landing.

## Common mistakes

- Next to another rolled or tilted move in the same act, or a move shorter than 40 f (avoid_when).
- A roll that does not return to level: the landing looks crooked.
- Rolling the whole clip around the wrong origin so the element slides off.
- Avoid when: Next to another rolled or tilted move in the same act (one rotation axis per act), or on moves shorter than 40 f, where the roll reads as a wobble.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cam-push-dutch-roll`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
