---
id: shot-countdown-arc-scatter
kind: technique
summary: "When a number is the promise ('5 min to install'): numbers sweep down to it, then it leads the title."
categories: [kinetic-type-motion-design, saas-app-launch, tech-review, science-curiosity, animated-explainer]
tools: [add_motion_block_tool, add_kinetic_title_tool, add_sfx_tool]
pace: fast
mood: [precise, light, confident]
aspect: ["16:9", "1:1", "9:16"]
pairs_with: [kinetic-counter, shot-blur-slide, kinetic-emphasis-scale]
avoid_with: [kinetic-word-rotator, shot-glitch-cycle, kinetic-beat-strobe]
needs: [arc-dial-numbers]
---

# Countdown dial that becomes the title

## What it is
Nine equal numerals sit on a big arc like a gauge; the whole dial sweeps through 96 degrees and brakes, with the hero numeral
("5") stopping at the top. It then slides straight into place as the first character of the title while the other numerals blur
away without moving, and the title words come in blurred, the last one turning to the accent. The viewer watches "many" fall to
"few"; the number argues for itself. Light-ground time and speed claims, data reveals.

## Build it in Zenvi
The tangent-arranged dial and the numeral that changes identity into a title letter are not available (`needs: arc-dial-numbers`).
Fallback that keeps the "from many to few" meaning: a rolling counter, then the headline built around the landed number.
```json
add_motion_block_tool {"block": "counter", "position_seconds": 0, "duration_seconds": 1.6, "placement": "full_frame",
  "params": {"values": ["45", "35", "28", "17", "10", "5"], "style": "odometer", "weight": 700, "align": "center",
             "palette": "cream", "suffix": " min"}}
add_motion_block_tool {"block": "kinetic_headline", "position_seconds": 1.6, "duration_seconds": 2.6, "placement": "full_frame",
  "params": {"text": "*5 minutes* / to install", "style": "blur", "emphasis": "accent", "palette": "cream", "accent": "#d2381f", "align": "center", "max_size": 200}}
add_sfx_tool {"recipe": "ui_tap", "at_seconds": 1.1, "gain_db": -16}
add_sfx_tool {"recipe": "toggle", "at_seconds": 1.6, "gain_db": -16}
```
Cut the counter's last value onto the headline's number so they sit at the same place and size (match the numeral's position and `max_size`).
A hand-built dial would be nine title clips (`add_kinetic_title_tool`, one numeral each) on an arc via `rotation` and `location` keyframes.

## Timing & taste rules
- Sequence is a decreasing, uneven run: 45, 35, 28, 17, 10, 5 (the counter takes six values; then 4, 3 reserved). Equal steps look like a ruler.
- Sweep: anticipation +3 degrees for 5 frames, then 99 to 0 degrees in about 24 frames (damping 12, stiffness 60), ~2 degrees of overshoot, settled by frame 34; over 4 degrees looks like a toy.
- Numerals are equal in size and weight (112 px / 700 on 1080p), faded by angle: invisible beyond 70 degrees, full inside 48.
- The hero numeral leaves the dial 2 frames before it has settled and flies 20 frames to the first slot (112 to 150 px, rotation to 0) on an asymmetric ease-in-out; no pause between sweep and flight.
- The other numerals fade with a 6 px blur from frame 28 to 44, in place (no travel), starting 4 frames before the hero moves.
- Title words 14-16 frames each, overlapping about 10 frames, rise 0.12 em, blur 10 px to 0; the last word moves to the accent in 12 frames, the only colour event.
- Light paper ground and one accent; the blur fade turns grey on dark.

## Sound for it
Two different short sounds a few frames apart: a mechanical stop when the dial brakes, a light settle when the number lands. The same sound twice smears into one.

## Common mistakes
- Unequal numeral sizes (reads as a chart, not a dial).
- Fading the other numerals after the hero has left: they must clear the way first.
- A title wider than planned: the hero's landing slot must be the true first character.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/typography/countdown-arc-scatter.md` (Apache-2.0; see ../NOTICE).
