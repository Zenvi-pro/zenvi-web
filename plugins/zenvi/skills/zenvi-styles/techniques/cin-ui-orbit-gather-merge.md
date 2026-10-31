---
id: cin-ui-orbit-gather-merge
kind: technique
summary: "When several inputs pool into one action, tokens orbit a node, slow to a lazy spin, then funnel out through one exit."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_emoji_tool, set_keyframes_tool, add_type_block_tool, add_sfx_tool]
pace: medium
mood: [physical, wordless, converging]
aspect: ["16:9", "1:1", "9:16"]
pairs_with: [cin-ui-path-fracture-fan, cin-ui-stalled-state, shot-source-hub-connect]
avoid_with: [cin-ui-card-grid-arrival, kinetic-typewriter]
needs: [closed-form-orbit-motion]
drawn: cinetic
---

# Orbit gather and merge

cinetic `ui-orbit-gather-merge` · UI choreography · signature · energy medium · formats launch, feature, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Tokens swing into orbit around a node, slow to a lazy spin, then accelerate one by one into a single exit point from which a line shoots out.

Use when: Several inputs, funds or sources gather before one action (pooling, batching, syncing, sending) and the idea should be told by physics with no words.

## Build it in Zenvi

1. Source node, exit node and 4 tokens, each its own clip on its own track: `add_emoji_tool {"emoji": "<icon>", "size": 0.06, "screen_position": "center", "position_seconds": 0.0, "duration_seconds": 1.9, "track": "<n>"}`. Put the exit node 3 o'clock of the source (`location_x` +0.049 for a 16:9 frame).
2. Orbit radius 95 px at 1080p = 0.088 of frame height (0.049 of width at 16:9). Token i angle by frame f: `theta_i = theta0 + 90*i - (132.5*(1 - exp(-f/10)) + 2*f)` degrees; write `location_x = 0.049*cos(theta)`, `location_y = 0.088*sin(theta)` as points every 2 frames (0.033 s) for the first 30 f, then every 4 f: `set_keyframes_tool {"timeline_clip_id": "<token_i>", "property": "location_x", "interpolation": "linear", "points": [...]}` and the same for `location_y`.
3. Spawn: tokens 0-3 appear at f0, f10 (0.17 s), f18 (0.30 s), f28 (0.47 s); each `scale_x`/`scale_y` 0 to 1 over 10 f (0.17 s) `ease_out_expo`. Pick theta0 so each token is 90-120 degrees short of 3 o'clock when its merge starts.
4. Merge: token i runs the rest of the angle forward over 16 f (0.27 s) with `ease_in_cubic`, landing at f72 (1.20 s), f82 (1.37 s), f86 (1.43 s); on arrival `scale_x`/`scale_y` cut to 0 and the exit node pulses to 1.08 for 2 f then back (`ease_out_cubic`).
5. At f92 (1.53 s) the line out: `add_type_block_tool {"block": "write_on", "paths": ["M0 0 L1 0"], "x": 0.62, "y": 0.5, "width": 0.3, "position_seconds": 1.53, "duration_seconds": 0.5, "draw_seconds": 0.2}`.
6. Sound: `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 1.2, "gain_db": -22}` on each landing (1.2, 1.37, 1.43 s), each 2 dB louder.

Fallback: Without sampled keyframes use one rotating group: put the 4 tokens on a single ring graphic (an add_type_block_tool text_on_path ring of dots) and spin it with rotation keyframes decaying from 15 to 2 degrees per frame.

## Timing & taste rules

- cinetic's timing (60 fps): omega = 13.25*exp(-f/10) + 2 deg/f, radius 95 px at 1080p. Spawns f10 (0.17 s)/f18 (0.30 s)/f28 (0.47 s), 10 f (0.17 s) each (ease_out_expo). Merges 16 f (0.27 s) each (ease_in_cubic), landing f72 (1.20 s)/f82 (1.37 s)/f86 (1.43 s) at < 60 px/f; hitPulse(t, 2, 5) on the exit node. Exit line f92 (1.53 s), 12 f (0.20 s) (ease_out_expo). About 105 f (1.75 s) in all.
- Swing starts at 13 deg per frame (about 22 px/f of arc) and decays to 2 deg per frame inside 30 f (0.5 s); a constant spin looks like a loader.
- Spawns at f10 / f18 / f28 (0.17 / 0.30 / 0.47 s), 10 f (0.17 s) scale-in each; the uneven gaps read as decided, not mechanical.
- Merge 16 f (0.27 s) each, under 60 px/f at landing; the token vanishes on arrival, never fades.
- Whole beat is about 105 f (1.75 s); a diagram act past about 4 s loses the thread.

## Sound for it

One soft ui_tap per landing at f72 / f82 / f86 (1.20 / 1.37 / 1.43 s), rising 2 dB each; the exit line gets a whoosh_short at -20 dB. Spawns stay silent.

## Common mistakes

- Tokens carrying readable text: they cannot be read while orbiting, so use icons only.
- No single exit point in the story: the merge then has nowhere to go.
- Constant-speed orbit with no slow-down: it looks like a spinner, not a gathering.
- Avoid when: The tokens are UI cards carrying text (unreadable while orbiting), or the story has no single output point.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ui-orbit-gather-merge`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
