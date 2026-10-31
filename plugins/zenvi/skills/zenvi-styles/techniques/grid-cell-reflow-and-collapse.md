---
id: grid-cell-reflow-and-collapse
kind: technique
summary: "For a modular motion-design beat: a bento grid of clips re-cuts 2 → 4 → 6 cells on beats, then collapses into one."
categories: [kinetic-type-motion-design, map-data-explainer]
tools: [add_motion_template_tool, add_motion_block_tool, detect_beats_tool, unify_grade_tool, add_sfx_tool]
pace: fast
mood: [editorial, modern, structured]
aspect: ["9:16", "1:1", "16:9"]
pairs_with: [beat-locked-kinetic-type-cuts, prompt-bar-typing-hero, stacked-word-flipper]
avoid_with: [beat-staggered-tile-and-slice-build, tiled-video-wall]
needs: [grid-cell-reflow]
---

# Grid cell reflow and collapse

## What it is
A Swiss/bento grid whose cells rescale and reflow on the beat (2 cells, then
4, then 6, with steep ease-out), content clipped to each cell, until the grid
collapses into one full-frame cell. Motion-design reels use it as the
"structure" beat between type sections.

## Build it in Zenvi
```json
detect_beats_tool {"file_id": "<music>"}
add_motion_template_tool {"template": "grid", "file_ids": ["<6 clips of one look>"], "position_seconds": <t>,
  "duration_seconds": 6, "layout": "grid", "steps": [2, 4, 6], "reveal": "pop", "merge": true,
  "transitions": "none", "radius": 28, "gutter": 12, "beats": [<timeline beats>], "palette": "editorial"}
unify_grade_tool {}
add_sfx_tool {"recipe": "ui_tap", "at_seconds": <each cell beat>, "gain_db": -16, "pitch": <step>}
add_sfx_tool {"recipe": "swoosh_hit", "at_seconds": <collapse>, "gain_db": -10}
```
- `steps` must increase; each step re-cuts the grid on a beat and fills again.
  `merge` grows the last tile to full frame; `zoom_into` pushes into one tile.
- `masonry_grid` (block) is the photo-board variant with a camera pull-back.
- Cells that slide to new positions while staying filled, with sliding
  brackets, are the missing `grid-cell-reflow`; today the grid re-cuts and
  refills (it reads as a pop, not a reflow).

## Timing & taste rules
- One step per 2 beats; 3 steps then collapse, 4-6 s total.
- One shoot or one colour family across cells: abstract gradients next to
  street footage read as random (judge, pass 1, 3.64).
- Expose-match the cells before building (`unify_grade_tool`); one blown-out
  cell spoils the board (pass 2 note).
- The first frame should already have a filled cell; an empty half-frame is a
  dead hook.

## Sound for it
Dry ticks per cell pitched up the grid (editorial / multiplicity palette), one
low swoosh-hit on the collapse; no reverb.

## Common mistakes
- More than 6 cells on 9:16 (unreadable).
- Grid as a transition between unrelated shots.

## Verified
2026-10-29: 6 s 9:16 tests. Pass 1: gradients + street + ink clips, `slide`
reveal, judge 3.64 (empty canvas, mismatched cells). Pass 2: street/laptop
clips only, `pop`, radius 28, unified grade, a swoosh-hit on the collapse:
4.18 (the collapse is a jump, one cell overexposed). Fidelity approximates.
