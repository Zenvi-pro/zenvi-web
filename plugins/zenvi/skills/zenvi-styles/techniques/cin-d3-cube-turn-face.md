---
id: cin-d3-cube-turn-face
kind: technique
summary: "When a sentence should clear into one colour: words slide under an icon that turns 90 degrees to a blank accent face."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_title_tool, set_keyframes_tool, add_clip_to_timeline_tool, add_3d_scene_tool, add_sfx_tool]
pace: medium
mood: [geometric, clean, decisive]
aspect: ["16:9", "1:1"]
pairs_with: [kcut-flood-climax, shot-match-iris-window, cin-d3-coin-edge-to-face]
avoid_with: [cin-d3-fold-out-channel]
needs: [card-flip-3d]
drawn: cinetic
---

# Cube turn to a blank face

cinetic `d3-cube-turn-face` · Depth and 3D · accent · energy medium · formats sting, launch, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Words converge and slide under an icon, then the icon turns 90 degrees like a cube to show a plain accent face that becomes the field for what comes next.

Use when: Clearing a sentence into a single colour field or a seed for the logo with a clean geometric gesture.

## Build it in Zenvi

1. Flanking words converge: `add_title_tool {"template": "Standard_1", "text": "Ship", "position_seconds": 0, "duration_seconds": 1.2, "track": 3}` and `"text": "faster"` on track 4; the tile (icon) on a higher track. `set_keyframes_tool` on each word `location_x` from -0.3 / +0.3 to 0 over 22 f (0.37 s), `ease_in_cubic`, sliding under the tile (lower track).
2. The tile and its blank accent face as two clips: `add_clip_to_timeline_tool {"file_id": "<icon_tile>", "position_seconds": 0, "duration_seconds": 1.4, "track": 5}` and `{"file_id": "<accent_face>", "position_seconds": 0.37, "duration_seconds": 1.4, "track": 5}`.
3. Turn over 12 f (0.2 s) with `ease_in_out_sine`: `set_keyframes_tool {"timeline_clip_id": "<icon_tile>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 0.37, "value": 1.0}, {"seconds": 0.57, "value": 0.02, "ease": "ease_in_out_sine"}]}` with `location_x` 0 to -half the tile width; the accent face `scale_x` 0.02 to 1.0 with `location_x` +half to 0 over the same times. Dim the departing face from brightness 1 to 0.55 with a black card above at 0 to 0.45 alpha.
4. Hold the blank face 6 f (0.1 s) as a designed freeze on a silence, then it expands, punches or opens into the next element: `scale_x/y` 1.0 to 3.0 on `ease_in_expo`.
5. For a true cube: `add_3d_scene_tool {"scene": "cube_cut", "params": {"from_clip_id": "<a>", "to_clip_id": "<b>", "direction": "left"}, "duration_seconds": 0.4}`. `add_sfx_tool {"recipe": "swoosh_hit", "at_seconds": 0.5, "gain_db": -12}`.

Fallback: The 2D turn squashes the tile instead of rotating a solid cube; use cube_cut when both faces are full clips.

## Timing & taste rules

- cinetic's timing (60 fps): Converge 22 f (0.37 s) ease_in_cubic; cube turn 12 f (0.20 s) ease_in_out_sine; blank-face freeze 6 f (0.10 s); then the next move.
- Converge 22 f (0.37 s) on ease_in_cubic; cube turn 12 f (0.2 s) on ease_in_out_sine; blank-face freeze 6 f (0.1 s).
- Shade the departing face 1 to 0.55 and the arriving face 0.85 to 1.
- Perspective about 4x the tile width in the original.
- The blank face seeds the next element.

## Sound for it

Words slide silently; a swoosh_hit at the turn, and the 6 f freeze sits on a short silence.

## Common mistakes

- A tile with fine detail: it shears during the turn.
- Flipping the same element earlier in the film.
- A blank face with no follow-up: it must become the next element.
- Avoid when: The tile carries fine detail (it shears during the turn), or the same element was already flipped.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`d3-cube-turn-face`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
