---
id: cin-tr-path-relay
kind: technique
summary: "When data or money travels: a line and its lead dot carry the eye around a corner or across the cut."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_type_block_tool, add_title_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [guided, technical, calm]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-glow-flyline, shot-line-carry-transition, shot-source-hub-connect]
avoid_with: []
needs: [path-write-on]
drawn: cinetic
---

# Path relay

cinetic `tr-path-relay` · Transition · workhorse · energy calm · formats launch, feature, walkthrough, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A line and its lead dot carry the eye from one place to the next. The connector bends around a rounded corner with the camera following, or continues across a cut and enters the next shot from the same edge at the same angle.

Use when: Money, data or messages travelling (send, route, sync), flowcharts and timelines, and films whose UI already uses lines and nodes.

## Build it in Zenvi

1. Draw the connector with one corner arc (r = 40 px): `add_type_block_tool {"block": "write_on", "paths": ["M 0 0 H 220 A 40 40 0 0 1 260 40 V 140"], "view_box": [0, 0, 260, 140], "position_seconds": 0, "duration_seconds": 1.2, "draw_seconds": 1.0, "stroke_width": 2, "ink": "#ffffff", "width": 0.4, "x": 0.5, "y": 0.5}` (stroke at least 1.5 px).
2. Lead dot: `add_title_tool {"text": "\u25cf", "position_seconds": 0, "duration_seconds": 1.2}` with `set_keyframes_tool` on `location_x` and `location_y` along the same path at a constant 8-16 px/f (`"interpolation": "linear"`), one point per segment end.
3. Camera follows with a 8-12 f (0.13-0.20 s) lag: `scale_x/scale_y` 1.0 to 1.15 and `location_x/location_y` keyframed on the shot clip, offset 0.15 s behind the dot's.
4. Across a cut, start the next clip's line at the frame edge where the first left, same angle and speed; the dot reaches its target 18 f (0.3 s) after the cut.
5. Off-frame variant: dot exits on `ease_in_cubic` over 24 f (0.4 s), hidden 12 f (0.2 s) while the camera relocates, re-enters at 60 px/f or slower braking x0.92 per frame to rest in ~36 f (0.6 s).
6. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 1.2, "gain_db": -20}` when the dot lands.

Fallback: The write-on draws the line but the dot is a separate clip keyframed by hand, so keep the path a straight run plus one corner to make the sync easy. For a line plus dot generator, `line_trails` with `heads: true` is a looser cousin.

## Timing & taste rules

- cinetic's timing (60 fps): Dot at a constant 8-16 px/f. Corner radius 40 px. Camera lag 8-12 f (0.20 s). One run lasts 60-72 f (1.20 s). After a cut the dot lands 18 f (0.30 s) later. Off-frame gap 12 f (0.20 s); re-entry at ≤ 60 px/f, slowing ×0.92 per frame.
- Dot at a constant 8-16 px/f (linear), corner radius 40 px, line stroke >= 1.5 px.
- Camera lag 8-12 f (0.13-0.20 s); one run lasts 60-72 f (1.0-1.2 s).
- After a cut the dot lands 18 f (0.3 s) later.
- Off-frame gap 12 f (0.2 s); re-entry at <= 60 px/f, slowing x0.92 per frame.
- A path that loops back reads as indecision.

## Sound for it

One soft `ui_tap` as the dot lands; the travel is silent or a faint sustained tone.

## Common mistakes

- The film has no line language, or the path would cross readable text (avoid_when).
- Letting the dot accelerate or ease: it moves at a constant speed.
- The dot arriving a different edge or angle than it left across the cut.
- Avoid when: The film has no line language, or the path would cross readable text. A path that loops back reads as indecision.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tr-path-relay`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
