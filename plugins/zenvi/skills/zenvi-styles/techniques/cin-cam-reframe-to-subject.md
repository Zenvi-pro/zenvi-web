---
id: cin-cam-reframe-to-subject
kind: technique
summary: "When something new appears on screen: the camera glides a few hundred pixels and pushes in slightly to follow it."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [screen_zoom_follow_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [attentive, smooth, guiding]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-cursor-flyover, shot-control-state-change]
avoid_with: [cin-cam-isolating-push, cin-cam-crash-zoom-through]
needs: []
drawn: cinetic
---

# Reactive reframe

cinetic `cam-reframe-to-subject` · Camera · workhorse · energy calm · formats walkthrough, feature, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

When something new appears (a popover, a result, the hero icon), the camera glides a few hundred pixels and pushes in slightly until it sits where the eye wants it.

Use when: After any UI event that changes what matters on screen, or after a punch-in that left the hero off-centre.

## Build it in Zenvi

1. On the screen recording find the event time `c` (a popover opens, a result lands) with `inspect_timeline_tool`.
2. Reframe starting 4 f (0.07 s) after the element begins to appear, so the content leads and the camera follows: `set_keyframes_tool {"timeline_clip_id": "<screen>", "property": "scale_x", "mode": "replace", "points": [{"seconds": <c+0.07>, "value": 1.0}, {"seconds": <c+0.57>, "value": 1.05, "ease": "ease_in_out_sine"}]}` (and `scale_y`), settling in 20-40 f (0.33-0.67 s).
3. Move the new element toward frame centre (or offset to leave room for its caption): `location_x` / `location_y` `[{"seconds": <c+0.07>, "value": 0}, {"seconds": <c+0.57>, "value": <-dx>, "ease": "ease_in_out_sine"}]`, 150-350 px of travel.
4. To centre a hero after a punch-in: the same blend over 22 f (0.37 s) with position and scale on one curve (k 1.0 to 1.23), so the subject arrives on a long tail.
5. One-call route: `screen_zoom_follow_tool {"clip_id": "<screen>", "zoom": 1.1, "ease": "ease_in_out_sine", "min_hold": 1.2, "cursor": false, "stops": [{"seconds": <c>, "x": 0.6, "y": 0.4}]}`.

## Timing & taste rules

- cinetic's timing (60 fps): Popover reframe: starts 4 f (0.07 s) after the pop, settles in 20-40 f (0.67 s) on ease_out_cubic, k x1.05. Hero centring: 22 f (0.37 s) on ease_out_cubic, 150-350 px of travel, peak about 22 px/f at 31% of the move, k 1.0 -> 1.23.
- Popover reframe: starts 4 f (0.07 s) after the pop, settles in 20-40 f (0.33-0.67 s), k x1.05.
- Hero centring: 22 f (0.37 s), 150-350 px of travel, peak about 22 px/f at 31 % of the move, k 1.0 to 1.23.
- The element arrives on its own curve (a popover scales 0.05 to 1 from the click point over 10 f / 0.17 s, opacity over the first 4 f).
- Moves under 40 px read as a twitch: skip them.
- Use for events that matter, not every small UI change.

## Sound for it

None on the camera; the event's own click or pop carries the sound.

## Common mistakes

- Reframing on every small UI change, or for an element already near centre (a move under 40 px) (avoid_when).
- Moving the camera before the element appears: the content leads, the camera follows.
- Overshooting: it glides in on a long tail.
- Avoid when: Every small UI change (keep it for the ones that matter), or an element that already appears near frame centre (a move under 40 px reads as a twitch).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cam-reframe-to-subject`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
