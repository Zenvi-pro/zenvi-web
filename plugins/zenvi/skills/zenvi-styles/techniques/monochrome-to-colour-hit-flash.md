---
id: monochrome-to-colour-hit-flash
kind: technique
summary: "For a drop or reveal in a music edit: the subject plays a bar in grey, a white flash on the snare cuts it to colour."
categories: [flash-cut-match-cut-edit, science-curiosity]
tools: [detect_beats_tool, add_clip_to_timeline_tool, color_grade_clip_tool, apply_motion_transition_tool, add_shape_mask_tool, add_sfx_tool]
pace: fast
mood: [dramatic, punchy, cinematic]
aspect: ["9:16", "16:9"]
pairs_with: [crt-scanline-and-schematic-inserts, beat-staggered-tile-and-slice-build, withheld-music-cold-drop]
avoid_with: [occluder-plate-wipe]
needs: []
---

# Monochrome-to-colour hit flash

## What it is
Each subject first plays one bar in black and white, then a 1-3 frame white
pop on the snare reveals the same shot in full colour. Repeated 3-4 times
after a drop, often with letterbox bars arriving on the drop. Science and
flash reels use it to make a render or a place "light up".

## Build it in Zenvi
```json
detect_beats_tool {"file_id": "<music>"}
add_clip_to_timeline_tool {"file_id": "<a>", "position_seconds": <bar 1>, "start_seconds": 1, "end_seconds": <1 + bar>}
add_clip_to_timeline_tool {"file_id": "<a>", "position_seconds": <bar 2>, "start_seconds": <1 + bar>, "end_seconds": <1 + 2 bar>}
color_grade_clip_tool {"timeline_clip_id": "<grey copy>", "saturation": 0, "contrast": 0.15}
color_grade_clip_tool {"timeline_clip_id": "<colour copy>", "saturation": 1.35, "vibrance": 0.2}
apply_motion_transition_tool {"preset": "flash_white", "clip1_id": "<grey copy>", "clip2_id": "<colour copy>"}
add_shape_mask_tool {"clip_ids": ["<colour copy after the drop>"], "shape": "rectangle", "width": 1.0, "height": 0.72, "feather": 0}
add_sfx_tool {"recipe": "impact_punch", "at_seconds": <colour cut>, "gain_db": -8}
```
- Continue the source time across the split (the colour copy starts where the
  grey one ended) so the motion does not jump.
- `flash_white` is 3 frames by default; it decays into the colour shot.
- Letterbox: a full-width rectangle mask, height 0.72 on 9:16; it arrives with
  the first colour hit after the drop and stays.

## Timing & taste rules
- Grey for exactly one bar (1.6 s at 150 bpm), colour on the next downbeat or
  snare.
- 2-4 pairs; then switch technique (it loses its effect after four).
- Push the colour copy: saturation 1.3-1.4 and a touch of contrast; a timid
  grade makes the reveal flat.
- Bars that appear on a non-drop cut feel jarring (judge note): only on the
  drop, then keep them to the end.

## Sound for it
A punch on each colour reveal, a lighter hit on the grey cut; nothing on the
flash itself beyond the punch (it is one event).

## Common mistakes
- A dissolve instead of a flash (soft, reads as a grade change).
- Grey and colour copies from different moments of the clip.

## Verified
2026-10-29: 6.4 s 9:16 test, dancer and surfer, one bar each grey → colour
with `flash_white` on the trap bed, letterbox on the second reveal. Contact
sheet: clean grey/colour pairs, flash visible on the cut frame. Judge (abs)
5.73: wants the bars to slide in (not snap) and a resolved ending.
