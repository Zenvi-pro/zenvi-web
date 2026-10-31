---
id: shot-control-state-change
kind: technique
summary: "When one UI control is the feature (mode switch, plan picker): a pointer presses it and the state change is the shot."
categories: [saas-app-launch, product-launch-film, tech-review, animated-explainer]
tools: [set_keyframes_tool, add_motion_block_tool, add_title_tool, add_sfx_tool]
pace: medium
mood: [precise, tactile, clean]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-type-and-filter, kinetic-counter, t069]
avoid_with: [shot-picker-carousel, shot-parameter-dial]
needs: []
---

# Control close-up: press, respond, reward

## What it is
A single control shot in close-up with no page around it: a pointer arrives, presses, the world responds (a thumb slides, or one chip inverts while its
siblings fade), and a reward lands (new icon pops, or a price settles). Two variants: A segmented thumb (2-way mode switch), B chip single-select.
It shines as the announcement beat for "now there is a second mode" or "pick a plan, see the result".

## Build it in Zenvi
Controls are stills you supply or generate (control body, thumb, icons, pointer as separate PNGs; chips before and after). Place them as photo clips.
A segmented thumb (3.5 s):
```json
set_keyframes_tool {"timeline_clip_id": "<body>", "property": "location_y", "ease": "ease_out_back", "points": [{"seconds": 0, "value": 0.18}, {"seconds": 0.6, "value": 0}]}
set_keyframes_tool {"timeline_clip_id": "<pointer>", "property": "location_x", "ease": "ease_out_cubic", "points": [{"seconds": 0.6, "value": 0.7}, {"seconds": 1.4, "value": 0}]}
set_keyframes_tool {"timeline_clip_id": "<pointer>", "property": "scale_x", "points": [{"seconds": 1.5, "value": 1}, {"seconds": 1.6, "value": 0.86}, {"seconds": 1.73, "value": 1}]}
set_keyframes_tool {"timeline_clip_id": "<thumb>", "property": "location_x", "ease": "ease_out_cubic", "points": [{"seconds": 1.6, "value": -0.17}, {"seconds": 1.87, "value": 0.17}]}
set_keyframes_tool {"timeline_clip_id": "<new_icon>", "property": "scale_x", "ease": "ease_out_back", "points": [{"seconds": 1.87, "value": 0}, {"seconds": 2.1, "value": 1}]}
```
Repeat `scale_y` like `scale_x` for the pointer and the icon. The press ripple is `add_motion_block_tool {"block": "particle_burst", "params": {"shape": "rings", "count": 8, "origin": [{"x": 0.62, "y": 0.5}], "rings": true}, "position_seconds": 1.6, "duration_seconds": 0.8}`.
Chip select (5.5 s): chips-before still, a 1-frame grey press flash, then the chips-after still (selected chip ink, others 18 % at the same positions):
```json
add_title_tool {"text": "", "background_color": "#78829280", "position_seconds": 1.87, "duration_seconds": 0.034}
add_motion_block_tool {"block": "counter", "params": {"values": ["42.00", "34.44"], "prefix": "$", "decimals": 2, "style": "count", "label": "per month"}, "position_seconds": 3.4, "duration_seconds": 2.0}
```
The old price struck out and the saving pill are stills or a second `add_title_tool`.

## Timing & taste rules
- Thumb slide 8 frames (0.27 s) ease-out cubic; under 5 frames reads as a jump, over 14 as a slow demo. Pointer arrives from off-frame in ~0.8 s.
- Press: pointer scale 1 -> 0.86 -> 1 (3 frames down, 4 up) plus a 12-frame ring ripple from the tip; a click without a ripple reads as the pointer passing by.
- New icon pops with a small overshoot (settle in 0.25-0.3 s); the old icon collapses in 6 frames. Hold the new state for 30 frames or more.
- Chip B: the press flash is exactly ONE frame (two reads as hover); the invert takes 5 frames, linear, then a +-4 % bounce; siblings drop to 18 % and
  must NOT move or the viewer thinks the page reloaded. Hold the selected state ~1.5 s before the result.
- Control at least 1000 px wide on a 1080 frame; a smaller control does not carry the weight of the slide.
- Use it for two-way switches; a 3+ segment thumb crossing several stops in 8 frames cannot be read.

## Sound for it
`add_sfx_tool {"recipe": "toggle", "at_seconds": 1.87, "gain_db": -12}` on the thumb landing, `pop` on the icon (-16), `mouse_click` on the press (-10).

## Common mistakes
- Dropping the pointer: the UI then moves on its own and the cause is lost.
- No ripple or no icon pop: the press has no consequence.
- Re-flowing the unselected chips (they must keep their slot).
- Shooting the same click twice, once in the page and once in this close-up.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft cards `shots/interaction/segmented-thumb-hero.md` and `shots/interaction/chip-grid-single-select-blackout.md` (Apache-2.0; see ../NOTICE).
