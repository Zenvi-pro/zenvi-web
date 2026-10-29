---
id: whip-and-match-cut-chain
kind: technique
summary: "For linking sport beats by motion or shape: whips and shape matches so about half the transitions are not plain cuts."
categories: [sports-hype-edit]
tools: [apply_motion_transition_tool, detect_subject_tool, align_match_cut_tool, add_clip_to_timeline_tool, add_sfx_tool]
pace: fast
mood: [energetic, playful, kinetic]
aspect: ["9:16", "16:9"]
pairs_with: [commentary-hits-with-dense-designed-cues, motion-pose-or-position-match-cut, withheld-music-cold-drop]
avoid_with: [foreground-occluder-cut-in-footage, beat-staggered-tile-and-slice-build]
needs: []
---

# Whip and match-cut chain

## What it is
A run of 3-5 shots joined by motion or shape instead of plain cuts: a kick
whips into the next sport, a ball becomes another ball, a hoop zooms through
into the crowd. The BBC World Cup spot links 7 of 14 joins this way. It reads
as one continuous move across many places.

## Build it in Zenvi
```json
apply_motion_transition_tool {"preset": "whip", "clip1_id": "<sprinter>", "clip2_id": "<kick>", "direction": "right"}
detect_subject_tool {"file_id": "<kick file>", "time": <its out-point>}
detect_subject_tool {"file_id": "<hoop file>", "time": <its in-point>}
align_match_cut_tool {"clips": [{"clip_id": "<kick>", "box": <ball box>}, {"clip_id": "<hoop>", "box": <ball box>}],
  "fit": "position_scale"}
apply_motion_transition_tool {"preset": "zoom_through", "clip1_id": "<hoop>", "clip2_id": "<crowd>"}
add_sfx_tool {"recipe": "whip", "at_seconds": <whip cut>, "gain_db": -8, "pan": 0.6}
add_sfx_tool {"recipe": "hit_transient", "at_seconds": <match cut>, "gain_db": -9}
add_sfx_tool {"recipe": "impact_punch", "at_seconds": <zoom cut>, "gain_db": -7}
```
- `detect_subject_tool` finds round subjects (balls, wheels, eyes); for poses
  give boxes by hand from a `preview_frame` grid.
- Whip `direction` follows the motion leaving the outgoing frame.
- True motion blur on footage: `apply_fx_tool directional_blur` on the last
  4 frames of the outgoing clip (CLI / local only).

## Timing & taste rules
- Each shot in the chain 0.8-1.5 s; the matched object must be on screen at
  least 0.4 s on both sides to read.
- Alternate join types (whip, match, zoom); the same one three times is a
  template.
- Every shot in the chain should already move: a whip out of a locked-off shot
  reads unmotivated (judge note on the test).
- End the chain on a held shot of 1.5 s+ with a hit, not mid-motion.

## Sound for it
One whoosh character per chain, re-pitched, peaking on each whip; a dry hit on
the shape match; a punch plus tail on the last join. Cues -7 to -9 dB over a
bed at -17.

## Common mistakes
- Shapes that do not line up (check the detect boxes at the actual cut frames).
- A filler shot inside the chain that breaks the sport (pass 1 used an
  off-theme fence shot; judge 3.91 called it momentum-breaking).
- Whips in a cinematic, slow piece: use plain cuts there.

## Verified
2026-10-29: 5.6 s 9:16 test: sprinter → whip right → football → ball-to-ball
match onto a basketball (`detect_subject_tool` boxes, `align_match_cut_tool`
position_scale) → zoom-through into a stadium. Judge 3.91 both passes; notes:
the whip needs the subjects moving the same way and a resolved ending.
