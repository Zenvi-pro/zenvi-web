---
id: shot-parameter-dial
kind: technique
summary: "When one number should visibly drive a layout (spacing, radius): the readout steps while the blocks spread in sync."
categories: [saas-app-launch, product-launch-film, tech-review, animated-explainer]
tools: [set_keyframes_tool, add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [precise, rational, satisfying]
aspect: ["16:9", "1:1"]
pairs_with: [shot-control-state-change, kinetic-counter]
avoid_with: [shot-picker-carousel]
needs: [parameter-driven-layout]
---

# Parameter dial drives layout

## What it is
A row of link blocks with a selection frame and a gap badge. A readout steps 12 -> 104 while the blocks are pushed apart in the same frames, holds,
then springs back past its start. "Change one number and the interface follows" shown as one continuous cause, not a before/after cut.

## Build it in Zenvi
No parameter-driven layout exists (`needs: parameter-driven-layout`); fake it with one source of truth computed in a script:
1. Blocks, selection frame and badge are separate stills (5 blocks of unequal width, never equal).
2. For gap g(t), block x = centre + (i - 2) * (w + g(t)); sample g every 2 frames and write each block's `location_x` as a `set_keyframes_tool`
   `points` list (same list for the badge, which sits at the gap centre).
3. Readout: `add_motion_block_tool {"block": "counter", "params": {"values": ["12", "104", "12"], "suffix": "px", "style": "count", "label": "gap"}, "position_seconds": 0.6, "duration_seconds": 4.2}`.
   Its own easing differs from your g(t): step through frames and nudge the sampled g until blocks and number change together.
```json
set_keyframes_tool {"timeline_clip_id": "<block_1>", "property": "location_x", "ease": "ease_in_out_cubic", "interpolation": "bezier",
  "points": [{"seconds": 0.6, "value": -0.30}, {"seconds": 1.0, "value": -0.24}, {"seconds": 2.2, "value": -0.62}, {"seconds": 3.0, "value": -0.62}, {"seconds": 3.6, "value": -0.22}, {"seconds": 4.0, "value": -0.30}]}
```
Fallback when sync is not worth it: show only the blocks and a still readout at the end (no counter).

## Timing & taste rules
- Anticipation 12 -> 6 in 10 frames (0.33 s); out 6 -> 104 in 34 frames (1.1 s), slow landing; hold 20 frames (0.67 s); spring back with an
  overshoot below the start (about 7) then settle at 12; the gap is never negative.
- Make the travel at least 4-5x the original; a tiny change cannot be seen.
- Number and displacement from the same frame: even one frame of lag breaks the trust. Show the number in steps of 2, not 1 (a stopwatch otherwise).
- Blur only while moving; keep the selection frame, dashed extension lines and badge glued to the gap in every frame.
- One parameter per shot. If the screen already shows a real inspector field, drop the big readout.

## Sound for it
A very light `ui_tap` per two steps of the readout (-22 dB, 4-6 in all), a `pop` (-14) on the settle.

## Common mistakes
- Animating readout and layout separately.
- Equal-width blocks (reads as a diagram, not a nav bar).
- Dialling two parameters in one shot.
- Tuning on grey placeholders only; re-check with the real UI.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/interaction/autolayout-gap-dial.md` (Apache-2.0; see ../NOTICE).
