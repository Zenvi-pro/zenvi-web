---
id: shot-picker-carousel
kind: technique
summary: "When a list of features is read out as a picker: content scrolls through a fixed focus pill, snaps and rests on each."
categories: [saas-app-launch, product-launch-film, animated-explainer, tech-review]
tools: [add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [tactile, calm, precise]
aspect: ["9:16", "1:1", "16:9"]
pairs_with: [shot-control-state-change, kinetic-word-rotator]
avoid_with: [shot-parameter-dial]
needs: []
---

# Picker carousel

## What it is
A mobile-style vertical picker: the focus pill stays put, items travel through it, each decelerates hard, snaps and stands completely still for a beat,
with opacity, size and grey falling off by distance from the centre. Five snaps in ~3.6 s, one beat each.

## Build it in Zenvi
`word_rotator` in slot mode is the same mechanism (a column scrolling with neighbours fading above and below):
```json
add_motion_block_tool {"block": "word_rotator", "params": {"prefix": "", "words": ["Trim to the beat", "Sound design", "Captions", "Colour look", "Export"], "suffix": "", "style": "slot", "size": 96},
  "position_seconds": 0, "duration_seconds": 3.6, "placement": "over_video"}
```
Optional focus pill: a rounded-rectangle still (white, 1 px grey rim, soft shadow) under the block, fixed; after each snap give it a breath:
```json
set_keyframes_tool {"timeline_clip_id": "<pill>", "property": "scale_y", "ease": "ease_in_out_sine", "points": [{"seconds": 0.5, "value": 1}, {"seconds": 0.6, "value": 1.06}, {"seconds": 0.72, "value": 1}]}
```
(one triplet per snap, ~0.65 s apart). Round trip on the sheet: if the block rotates without resting, shorten the word list or lengthen the block.

## Timing & taste rules
- 5 steps in 3.6 s (0.65 s each = ~0.42 s travel + ~0.23 s dead still). Seven steps is too fast to read (0.46 s each).
- The rest is the point: continuous scrolling reads as a loading spinner. Quint-out snap, not a cubic.
- Falloff by distance d from the centre: opacity 1 -> 0.55 (d <= 1) -> 0.18 (d <= 2); size 17 -> 14 px (about -18 %); only the focus row keeps its icon.
- Odd number of visible rows (5), focus on the middle row; fade the top and bottom 26 % of the viewport with an alpha mask, not with a colour bar.
- Pill breath scaleY 1.06 maximum, and it must not move (a drifting pill breaks "content passes through").
- Keep every row on one line; shrink the type, do not wrap.

## Sound for it
`add_sfx_tool {"recipe": "ui_tap", "at_seconds": <each snap>, "gain_db": -18, "seed": <k>}`; five light ticks, no whoosh.

## Common mistakes
- No dead time on each item.
- Distance fade on opacity only (looks flat); add size and grey.
- A row height that changes per item (the layout jitters).

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/interaction/picker-carousel-feature-cycle.md` (Apache-2.0; see ../NOTICE).
