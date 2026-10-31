---
id: cin-dn-area-ratio-compare
kind: technique
summary: "When a claim is a multiplier (10x smaller): a block shrinks to the area the ratio implies, leaving its outline."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_type_block_tool, set_keyframes_tool, add_motion_block_tool, add_sfx_tool]
pace: calm
mood: [honest, minimal]
aspect: ["16:9", "1:1", "4:5"]
pairs_with: [kinetic-counter, cin-dn-delta-chip-compare]
avoid_with: [cin-dn-unit-grid-tally]
needs: []
drawn: cinetic
---

# Area-true ratio comparison

cinetic `dn-area-ratio-compare` · Data and numbers · accent · energy calm · formats launch, feature, vertical, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A multiplier claim ('10x smaller') plays as a block that shrinks in log space to the area the ratio implies, leaving an outline of its old size behind.

Use when: Multiplier and reduction claims about size, cost, time or footprint.

## Build it in Zenvi

1. Reference outline at the original size: `add_type_block_tool {"block": "write_on", "paths": ["M0 0 H300 V300 H0 Z"], "fill": false, "stroke_width": 1.5, "ink": "#8a8f98", "width": 0.28, "x": 0.35, "y": 0.5, "draw_seconds": 0.3, "position_seconds": 1.0, "duration_seconds": 4.0}`.
2. Block A, filled: the same path with `"fill": true`, `"ink": "#8a8f98"`, on a track above, anchored bottom-left by setting `origin_x` 0 and `origin_y` 1 via `set_keyframes_tool`.
3. Shrink to area 1/ratio: `set_keyframes_tool {"timeline_clip_id": "<block>", "property": "scale_x", "ease": "ease_in_out_sine", "points": [{"seconds": 2.0, "value": 1.0}, {"seconds": 2.8, "value": 0.316}]}` (same on `scale_y`; 1/sqrt(10) for 10x; 48 f, 0.8 s).
4. Fill to the accent over the last 12 f (0.2 s): a second accent copy fading in, `alpha` 0 to 1 from 2.6 s.
5. The ratio counts beside it: `add_motion_block_tool {"block": "counter", "position_seconds": 2.0, "duration_seconds": 3.0, "placement": "over_video", "params": {"values": ["1", "10"], "suffix": "x", "style": "count"}}`, landing with the block at 2.8 s.
6. For speed or time claims use bar lengths (linear ratio) instead.

## Timing & taste rules

- cinetic's timing (60 fps): Shrink 48 f (0.80 s) on ease_in_out_sine via lmix. Fill mixes to the accent over the last 12 f (0.20 s). Ratio count 36 f (0.60 s) on ease_out_cubic, landing with the block. Hold at least 36 f (0.60 s) under a 2% breath.
- Shrink 48 f (0.8 s) ease_in_out_sine, scale = 1/sqrt(ratio) so area ends at 1/ratio.
- Fill mixes to the accent over the last 12 f (0.2 s); ratio count 36 f (0.6 s) landing with the block.
- Reference outline 1.5 px stays at the original size.
- Hold at least 36 f (0.6 s) under a 2 % breath; ratios above about 25x shrink to a dot, show the number alone.

## Sound for it

None, or one soft hit_transient at -20 dB on the landing.

## Common mistakes

- Ratios above about 25x: the block becomes a dot.
- Claims that are not really proportional in area.
- Scaling about the centre: the anchor must be a corner.
- Avoid when: Ratios above ~25x, where the block shrinks to a dot (show the number alone); claims that aren't really proportional.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`dn-area-ratio-compare`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
