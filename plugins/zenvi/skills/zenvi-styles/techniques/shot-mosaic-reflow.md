---
id: shot-mosaic-reflow
kind: technique
summary: "When one set of pictures has several faces: a tiled board re-cut on the beat into new layouts, tiles kept in step."
categories: [saas-app-launch, product-launch-film, brand-story-corporate, flash-cut-match-cut-edit, fashion-beauty-ad]
tools: [add_motion_template_tool, add_sfx_tool, detect_beats_tool]
pace: medium
mood: [curated, fluid, modern]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cinematic-montage-rhythm, shot-panel-grid-beats, kinetic-emphasis-scale]
avoid_with: [shot-theme-cycle-beat-list, kcut-strobe-cards]
needs: [grid-cell-reflow]
---

# Mosaic reflow

## What it is
The same 12 pictures change their arrangement in one continuous flow: a regular grid, then a curated mosaic with one big
feature, then a tilted diagonal cascade of prints, each state held long enough to read. "The layout itself thinks." For
portfolios, templates, photo-product demos.

## Build it in Zenvi
The continuous shape-to-shape morph of each tile is not available (`needs: grid-cell-reflow`). What exists is a grid that
is re-cut on a beat, each kept tile staying put while the others subdivide or fill:
`add_motion_template_tool {"template": "grid", "layout": "grid", "steps": [4, 6, 9], "file_ids": ["<f1>", "<f2>", "<f3>", "<f4>", "<f5>", "<f6>"],
"bpm": 96, "position_seconds": 0, "duration_seconds": 5, "gutter": 14, "radius": 18, "reveal": "pop", "drift": "in", "transitions": "none", "palette": "ui_dark"}`
(`steps` and `tiles` cannot be given together). For the feature state use a second call with `"layout": "mosaic", "tiles": 7`
placed right after (sections of 2.5 s), and for the last state `"layout": "repeat"` / `"film_strip"`. Add `"transitions": "whip"`
for a hard re-cut instead of the pop. Add `add_sfx_tool {"recipe": "ui_tap", "at_seconds": <re-cut>, "gain_db": -16}` on each re-cut.

## Timing & taste rules (card values)
- Reflow A to B 26 f, B to C 30 f, every tile with a curve of slow start, quick middle, long soft landing (0.75, 0, 0.15, 1).
- Holds: 30 / 36 / 34 f. Under 20 f the three states blur into one.
- Stagger 10 f across the board (A to B, dense first) and 14 f (B to C, dealt like cards). 0 is a mechanical flash,
  over 24 f the wave outshines the layout.
- Cause before effect: a segmented control (Grid / Mosaic / Cascade) moves 4 f before the tiles do; 0 f reads as no cause,
  over 8 f as a broken control.
- The feature tile is at least 2x2 cells; the cascade rotates -15 deg + 3 deg per print (equal angles collapse into a tilted grid).
- Tiles lift 3.5 % mid-move with a growing shadow; landing flat.
- Never change z-order while tiles overlap; swap it only in the state with no overlaps.

## Sound for it
Soft `ui_tap` (-16 dB) at each re-cut, nothing during holds.

## Common mistakes
- Resizing tiles by scaling the picture (distorted images); a tile's width and height must really change and the picture crop to fill it.
- More than three states.
- Source clips of different aspect ratios squashed into the cells (the judge flagged stretched 6- and 9-tiles on the test: crop to the cell, do not squash).

## Verified
2026-10-29, CLI on six bench clips: scripts/shot-mosaic-reflow.sh → shots/shot-mosaic-reflow.mp4 (local only). Checked on the sheet: the board fills one tile per beat and re-cuts 4 to 6 to 9 with gutters and rounded corners; the re-cuts are hard cuts, not a morph, and early cells are black. Watch judge (absolute): **3.36/10**; main note: "abrupt jump cuts between grid configurations rather than smooth transitions ... aspect ratios in the 6- and 9-grid look stretched".

Adapted from video-shotcraft card `shots/transition/mosaic-reframe.md` (Apache-2.0; see ../NOTICE).
