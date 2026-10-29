---
id: shot-collab-cursors
kind: technique
summary: "When 'your team is here' is the claim: five named cursors fly in, drift like hands, one types, then all gather to look."
categories: [saas-app-launch, product-launch-film, brand-story-corporate, animated-explainer]
tools: [set_keyframes_tool, add_kinetic_title_tool, add_sfx_tool]
pace: calm
mood: [social, warm, alive]
aspect: ["16:9", "1:1"]
pairs_with: [shot-canvas-materialize, shot-type-and-filter]
avoid_with: []
needs: [multi-cursor-ensemble]
---

# Collaboration cursors as cast

## What it is
An ambient layer on a board or document: five coloured, named pointers arrive one after another, keep drifting with the wobble of real hands, one parks on
a text line and types a title, and at the end all gather around the card. It is the cheapest visual argument for "multiplayer".

## Build it in Zenvi
`cursor_path` is a single pointer on a screenshot, so it cannot play five at once (`needs: multi-cursor-ensemble`). Build the cast from stills: an arrow + name chip
per person (5 colours, one colour per person for the whole film). For each cursor sample two sines every 0.2 s in a script and send the list:
```json
set_keyframes_tool {"timeline_clip_id": "<cursor_2>", "property": "location_x", "ease": "ease_in_out_sine", "points": [{"seconds": 0.23, "value": -0.62}, {"seconds": 0.43, "value": -0.31}, {"seconds": 0.63, "value": -0.28}]}
set_keyframes_tool {"timeline_clip_id": "<cursor_2>", "property": "alpha", "points": [{"seconds": 0.23, "value": 0}, {"seconds": 0.4, "value": 1}]}
```
One list for `location_x` and one for `location_y` per cursor; entrances at 0.07 / 0.23 / 0.37 / 0.53 / 0.73 s (spring-like arrival: use `ease_out_back`).
The cursor that types is hand-placed on the insertion point, with `add_kinetic_title_tool {"text": "Plan the launch for Friday.", "style": "documentary", "animation": "typewriter", "position_seconds": 1.6, "duration_seconds": 1.8}`.
Name chips fade in 0.33 s after their arrow and rise 12 px.

## Timing & taste rules
- Drift = two sines per axis per cursor with different phases: about 3.8 s and 10 s periods, amplitude +-40 / +-26 px at 1080p. One sine reads as a pendulum.
- Entrances staggered 2 / 7 / 11 / 16 / 22 frames; avatars in the corner pop on one frame.
- Typing: 1.6-2.4 frames per character with deterministic wobble, extra 0.9 frame after spaces; the typing cursor holds still (drift to 0).
- Gather: from ~3.3 s in ~0.93 s, smooth, around the card (not over the title); keep 25 % of the drift, never freeze (a frozen cursor group reads as a crash).
- Cursor colour = identity for the whole film.
- Cursors never cover what the viewer should read; keep the drift out of the main content's safe area.
- Keep the same character and space count if you change the title so the typing beats stay.

## Sound for it
A very light `pop` per arrival (-24), silence through the drift, a soft `keyboard_key` run while one types (-20).

## Common mistakes
- A name chip appearing on the same frame as its arrow (looks like a sticker); let it fade in as the arrow slows.
- Using it where a pointer has to click something (use `cursor_path` there).

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/interaction/collab-cursor-moves.md` (Apache-2.0; see ../NOTICE).
