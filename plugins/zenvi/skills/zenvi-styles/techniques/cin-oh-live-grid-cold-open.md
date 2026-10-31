---
id: cin-oh-live-grid-cold-open
kind: technique
summary: "When the first second must prove breadth: a flush 2x2 grid whose four cells are already moving from frame 2, no title."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: fast
mood: [busy, alive, systemic]
aspect: ["16:9", "1:1"]
pairs_with: [grid-cell-reflow-and-collapse, shot-bento-light-up, kcut-hit-fx]
avoid_with: [cin-oh-oversize-fly-then-small, cin-oh-macro-scramble-snap-out]
needs: [grid-cell-reflow]
drawn: cinetic
---

# Four live cells from frame 2

cinetic `oh-live-grid-cold-open` · Opening hook · signature · energy high · formats loop, launch, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

There is no title. The film opens on a flush 2x2 grid where every cell is already mid-action (a line assembling, a counter ticking, an object orbiting, a pin dropping), so from its first frames the frame reads as one living system.

Use when: A hero or social loop that must show several features at once, or a launch whose first second has to prove breadth.

## Build it in Zenvi

1. Four cells, one motion block each, all `placement: "full_frame"` on tracks 1-4 (same dark `ink` ground on all four so the seams vanish): `add_motion_block_tool {"block": "kinetic_headline", "position_seconds": 0, "duration_seconds": 4.3, "params": {"text": "Build *faster*", "style": "rise"}}`, `{"block": "counter", "duration_seconds": 4.3, "params": {"values": ["0","128"], "style": "count"}}`, `{"block": "line_trails", "duration_seconds": 4.3, "params": {"pattern": "orbit", "count": 3}}`, `{"block": "hud_callouts", "duration_seconds": 4.3, "params": {"labels": ["Live"], "points": [{"x": 0.5, "y": 0.5}]}}`.
2. Shrink each into its quadrant with `set_keyframes_tool {"timeline_clip_id": "<cellN>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 0, "value": 0.5}]}` (same for `scale_y`), then `location_x` / `location_y` at -0.25 / +0.25 (top-left is -0.25,-0.25; bottom-right +0.25,+0.25). Frame 960x540 per cell at 1080p.
3. Stagger nothing: each block's first move must land by f2-f6 (0.03-0.10 s), so start all four at 0 and trim any block whose own intro is slower with `trim_clip_tool` (start 0.2 s).
4. Give the cells unequal lengths (4.3 / 7.7 / 4.1 / 7.1 s, i.e. 260 / 462 / 244 / 428 f) and place a second copy of the short ones after them, so the loops never line up.
5. Accent only the one story element per cell (`accent` on the pin, the payoff word, the button); the rest greyscale. One groove under it: `add_sfx_tool {"recipe": "room_tone", "at_seconds": 0, "gain_db": -22}`.

Fallback: Without per-cell loops, lay the four blocks at full length and accept that they end together; a real recording per cell (muted) also works.

## Timing & taste rules

- cinetic's timing (60 fps): First arrivals on f2 (0.03 s), f2 (0.03 s), f2 (0.03 s) and f6 (0.10 s) (no cell later than f8 (0.13 s)). Typical entrances: a type lockup settles in 18 f (0.30 s) on ease_out_expo, a counter finishes in 28 f (0.47 s). Loop periods 260 / 462 / 244 / 428 f (7.13 s). Something changes somewhere about every 20 f (0.33 s) (longest gap about 62 f (1.03 s)). Cells 960x540 at 1080p.
- First arrival on f2, f2, f2 and f6 (0.03-0.10 s); no cell later than f8 (0.13 s).
- Something changes somewhere every ~20 f (0.33 s); longest quiet gap ~62 f (1.0 s).
- Typical entrances: a type lockup settles in 18 f (0.30 s) on ease_out_expo, a counter finishes in 28 f (0.47 s).
- Awkward loop periods, 260 / 462 / 244 / 428 f (4.3 / 7.7 / 4.1 / 7.1 s), so the four never repeat in sync.
- Cell content centred on the cell's own optical centre at 50-90 % of the cell width; one accent element per cell.

## Sound for it

No per-event SFX: one continuous groove (music or a low `room_tone`) carries the sound; the first cut or title later gets the hit.

## Common mistakes

- Giving each cell its own sound: four unrelated clicks read as noise; use one groove.
- Unequal ground colours: the grid seams show and it reads as four videos, not one system.
- A story that needs one idea at a time, or a 9:16 frame where cells drop below ~540 px wide (the fix is a vertical 1x4 stack or another opener).
- Avoid when: The story needs one idea at a time, a single-message sting, or a 9:16 frame where the cells would shrink below about 540 px wide.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`oh-live-grid-cold-open`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
