---
id: shot-bento-light-up
kind: technique
summary: "When a wall of features or footage should appear in place, calmly: a dark bento board whose cells pop in one per beat."
categories: [saas-app-launch, product-launch-film, brand-story-corporate, tech-review, 3d-product-cgi-ad]
tools: [add_motion_template_tool, add_sfx_tool]
pace: medium
mood: [composed, premium, orderly]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [T062, kinetic-mask-reveal, shot-outline-trace-reveal]
avoid_with: [shot-card-stack-fan, shot-page-waterfall-wall]
needs: [grid-cell-reflow]
---

# Bento light-up

## What it is
A whole board of cells is there from frame one (dark, waiting); the cells light up one after another at an even beat,
content rising into each, then a slow push settles the board. Nothing flies across the screen: it is a wave of state
changes, not of movement. The sober answer to "how does a wall of features show up" (the energetic one is a card deal).

## Build it in Zenvi
A mosaic of your clips, one tile per beat (150 bpm = 12 frames a tile), pop reveal, slow push:
```json
add_motion_template_tool {"template": "grid", "layout": "mosaic", "tiles": 6, "reveal": "pop", "gutter": 10,
  "radius": 24, "bpm": 150, "offset_seconds": 0.4, "position_seconds": 0, "duration_seconds": 4.8,
  "palette": "ui_dark", "file_ids": ["<clip1>", "<clip2>", "<clip3>", "<clip4>", "<clip5>", "<clip6>"], "drift": "in"}
add_sfx_tool {"recipe": "ui_tap", "at_seconds": 0.4, "gain_db": -18, "seed": 1}   // one per tile at 0.8, 1.2 ... seeds 2..6
```
Use six different clips (`strict_variety: true` refuses repeats). The card's comet outline tracing each cell and the
content popping a few frames later is not available: the tile just pops. Closest add-on: a headline above the board with
`add_kinetic_title_tool` (`style: editorial`, `animation: rise`).

## Timing & taste rules
- 12 f per cell, even spacing: the evenness is the calm. Do not accelerate (that is the deal-style move).
- Two rows of mixed widths (600/420/420 over 420/420/600 on a 3x2 board); 6 cells is the sweet spot, 9 the max.
- Everything lights in place: no cell may also slide in from an edge.
- After the last cell: a 3-4 % push over about 25 f (`drift: in` gives 12 % over the whole template; shorten it), then a
  true hold of 0.5 s or more.
- Dark cells at 18 % opacity only work on a dark ground; on light grounds use `palette: ui_light` and a fade.

## Sound for it
A dry `ui_tap` per cell at -18 dB with varied seeds; stop after the last cell and let one `impact_thud` (-16 dB) land with
the push if the music has a hit there.

## Common mistakes
- Lighting all cells on the same frame (reads as a cut), or a comet sweep and the content on the same frame (no hand-off).
- Using this and a deal-style fly-in on the same wall; one wall reveal per piece.
- The first tile starts late: with `offset_seconds` 0.4 and a pop reveal the board is black for about 0.8 s; start the
  template earlier if you need the board visible at once.

## Verified
2026-10-29, CLI on six bench clips: scripts/shot-bento-light-up.sh → shots/shot-bento-light-up.mp4 (local only). Checked on the sheet: six rounded tiles pop in at 0.4 s steps on a dark ground, full board by 2.8 s, slow drift in; the board is empty for the first 0.8 s. Watch judge (absolute): **4.9/10**; main note: "The pop-in animations lack fluid easing, overshoot, or scale cushioning, feeling like rigid instant appearances."

Adapted from video-shotcraft card `shots/ui-entrance/wall-reveal-moves.md` (Apache-2.0; see ../NOTICE).
