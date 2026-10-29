---
id: shot-gradient-type-shift
kind: technique
summary: "When a calm section needs a living ground: a background that sweeps, focuses, then turns, cross-fading three moves."
categories: [kinetic-type-motion-design, brand-story-corporate, saas-app-launch, music-lyric-video, kids-education]
tools: [add_motion_block_tool, set_keyframes_tool, add_title_tool]
pace: calm
mood: [ambient, soft, modern]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-mask-reveal, kinetic-emphasis-scale, kinetic-lower-third]
avoid_with: [shot-theme-cycle-beat-list, kcut-strobe-cards]
needs: [gradient-param-field]
---

# Gradient shift background

## What it is
A moving background that goes through three different gradient moves in one take (a light band sweeping at an angle, a
spot wandering and focusing, a three-colour wheel turning), cross-faded narrowly while both layers keep moving. It gives
a text-only section a low, constant pulse. Background only; the foreground reads on top.

## Build it in Zenvi
No block animates linear angle, radial centre or conic start angle (`needs: gradient-param-field`). The stand-in is three
`gradient_field` layers whose different styles stand for the three moves, stacked and cross-faded.
1. Layer 1 (0 to 2.5 s), the sweep: `add_motion_block_tool {"block": "gradient_field", "params": {"style": "aurora", "colors":
   ["#6d28d9", "#c026d3", "#38bdf8"], "speed": 1.2, "grain": true}, "position_seconds": 0, "duration_seconds": 2.5, "placement": "full_frame"}`
2. Layer 2 (2.2 to 4.7 s), the wandering spot: same colours with `"style": "orbs", "dots": false`, `position_seconds: 2.2`, on the
   track above.
3. Layer 3 (4.2 to 7 s), the wheel: `"style": "bokeh"` or `orbs` at `"speed": 0.6`, `position_seconds: 4.2`.
4. Narrow cross-fades, 12-14 frames (0.4-0.47 s) overlapped while both move: `set_keyframes_tool {"timeline_clip_id": "<L2>",
   "property": "alpha", "points": [{"seconds": 2.2, "value": 0}, {"seconds": 2.65, "value": 1}], "ease": "ease_in_out"}`; same for L3 at 4.2 s.
5. A dark scrim on the text side: `add_title_tool {"background_color": "#00000066", "position_seconds": 0, "duration_seconds": 7}`.

## Timing & taste rules
- The overlap is 12-14 f and both layers are moving during it; no overlap shows a frozen "handover".
- Colour stops need a lightness spread (about 64 / 40 / 7): below 20 points of spread the sweep cannot be seen, it is a flat ground that changes colour.
- Spot must travel (centre diagonal) and grow (radius 48 to 80 %), not only breathe. Outer ring dark so the spot exists.
- The wheel turns about 250 degrees and slows to a stop (not a full turn, which returns to the start frame).
- One colour family of three, identical in the three layers; never a rainbow wheel in branded work.
- Grain on, otherwise banding.

## Sound for it
Nothing; it is a ground. A `room_tone` bed or the music only.

## Common mistakes
- Letting a bright wheel eat text contrast: darken the text side.
- Wide cross-fades, where two gradient structures fight.
- Cutting the three layers back-to-back with no overlap.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/transition/gradient-transition.md` (Apache-2.0; see ../NOTICE).
