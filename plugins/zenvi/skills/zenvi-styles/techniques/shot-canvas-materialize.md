---
id: shot-canvas-materialize
kind: technique
summary: "When generated results should land on a canvas: list rows fly out as cards, or a prompt grows a tree level by level."
categories: [saas-app-launch, product-launch-film, animated-explainer, tech-review]
tools: [add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [generative, organised, satisfying]
aspect: ["16:9", "1:1", "9:16"]
pairs_with: [shot-type-and-filter, shot-voice-input-pill, kinetic-counter]
avoid_with: [shot-type-to-pill]
needs: [diagram-tree-block]
---

# Content materialises on the canvas

## What it is
Two ways to show "the result now exists on the board". A: a panel's rows are ticked, lifted, and fly in an arc to the canvas, changing from row shape to
card shape in flight, the panel slots collapsing into dashed placeholders. B: a prompt is typed, submitted, and a tree grows level by level, with each
connector drawn before its node. A is "existing content changes form"; B is "a structure grows out of one sentence".

## Build it in Zenvi
A: `masonry_grid` is the closest block (cards fly up into columns from a pulled-back camera, then one is hovered, lifted, saved):
```json
add_motion_block_tool {"block": "masonry_grid", "params": {"media_1": "<file_id>", "media_2": "<file_id>", "media_3": "<file_id>", "media_4": "<file_id>", "columns": 3, "save": "Add", "saved": "Added"},
  "position_seconds": 1.2, "duration_seconds": 5.0, "placement": "full_frame"}
```
Lead in with ticks and a press (a still of the list, `cursor_path` over it with `clicks: true`, three points 10 frames apart).
B: the typing is `prompt_bar`:
```json
add_motion_block_tool {"block": "prompt_bar", "params": {"prompt": "Plan a product launch", "placeholder": "Describe what to build", "status": "Generating…", "cursor": true, "position": "upper"}, "position_seconds": 0, "duration_seconds": 3.0}
```
The tree with lines leading the nodes has no block (`needs: diagram-tree-block`): stills of the nodes (1 root, 2 children, 4 grandchildren) placed over a
canvas still, each with `scale_x`/`scale_y` 0 -> 1 `ease_out_back` anchored from its top edge (move its `location_y` with the scale so the top stays fixed)
and a drawn connector still 10 frames before it. After the last node, a `scale` 1 -> 1.03 -> 1 breath on the whole tree group (about 28 frames).

## Timing & taste rules
- A: ticks at 14 / 24 / 34 frames; button at 52; rows lift 56 / 62 / 68 (6-frame stagger, 4 frames of 2 % enlargement and a deeper shadow) and then fly.
  A flight is an arc rising ~220 px at the midpoint; flat paths read as a move, not a pour. Row 626x104 -> card 486x300, corner radius 18 -> 24; the row look
  and the card look cross-fade in offset windows (never both visible mid-flight). Landing tilt -2.5 / 1.8 / -1.2 degrees with a 6-frame squash to 0.97.
- B: letters at 1.0-1.2 frames, spaces 1.7; submit 4 frames after the last letter. Root 14 frames after submit, levels 22 frames apart, siblings 5 frames
  apart; the connector draws in 16 frames, 10 frames before its node. A camera that starts 1.3x on the prompt and pulls back to 1.0 over 72 frames.
- Placeholder slots left by flying rows must collapse into dashed outlines; if they stay intact it looks like a copy.
- Breathe about the tree's centre of mass, not the frame centre; more than 1.06 reads as a zoom glitch.

## Sound for it
`ui_tap` per tick (-18), `whoosh_short` per flying card (-16, panned), `pop` per node (-18, pitched up one semitone per level via `pitch`).

## Common mistakes
- Everything flying on one frame (looks like copy-paste).
- Straight-line flights.
- Using the tree for an existing chart (the chart is alive, the tree is being born).
- Nodes drawn before their connectors.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/interaction/canvas-materialize-moves.md` (Apache-2.0; see ../NOTICE).
