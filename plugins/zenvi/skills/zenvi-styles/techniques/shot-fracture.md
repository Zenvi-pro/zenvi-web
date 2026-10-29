---
id: shot-fracture
kind: technique
summary: "When an opener goes from chaos to form: a poster assembles from tumbling tiles, ripples centre-out, holds, bursts apart."
categories: [movie-game-trailer, product-launch-film, brand-story-corporate, kinetic-type-motion-design]
tools: [add_shape_mask_tool, set_keyframes_tool, add_motion_block_tool, add_sfx_tool]
pace: fast
mood: [dramatic, physical, bold]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kcut-hit-fx, shot-brand-ink-open, cinematic-silence-before-hit]
avoid_with: [shot-icon-field-colorize, shot-magician-card-flourish]
needs: [tile-3d-assemble]
---

# Fracture assemble

## What it is
A 5x5 grid of tiles, each cut from the same poster, flies in from scattered 3D positions with its own spin, centre tiles first and corners last, and clicks
into one whole image. A one-second hold to read the type, then every tile flies away from the centre, accelerating and spinning, out of the frame. In and
out are symmetric, so half of it also works as a hard transition.

## Build it in Zenvi
There is no 3D tile assembly (`needs: tile-3d-assemble`). Native approximation with a flat 4x4 or 5x5 grid built by a script: put the poster still on 16-25 tracks,
mask each copy to its cell and animate it.
```json
add_shape_mask_tool {"clip_ids": ["<tile_r2c3>"], "shape": "rectangle", "x": 0.7, "y": 0.5, "width": 0.2, "height": 0.2, "feather": 0}
set_keyframes_tool {"timeline_clip_id": "<tile_r2c3>", "property": "location_x", "ease": "ease_in_out_cubic", "points": [{"seconds": 0, "value": 0.36}, {"seconds": 0.85, "value": 0}]}
set_keyframes_tool {"timeline_clip_id": "<tile_r2c3>", "property": "rotation", "ease": "ease_in_out_cubic", "points": [{"seconds": 0, "value": 110}, {"seconds": 0.85, "value": 0}]}
set_keyframes_tool {"timeline_clip_id": "<tile_r2c3>", "property": "alpha", "points": [{"seconds": 0, "value": 0}, {"seconds": 0.3, "value": 1}]}
```
Every tile: its own seeded start (location +-0.35 / +-0.4, rotation +-180) and arrival delay (|row-2| + |col-2|) * 0.045 s; exit location along the
direction away from the centre. Sync the end with `add_motion_block_tool {"block": "particle_burst", "params": {"shape": "shards", "count": 120, "origin": [{"x": 0.5, "y": 0.5}]}, "position_seconds": 3.9, "duration_seconds": 1.4}`.
Check the sheet: seams between tiles must not show (feather 0, abutting masks).

## Timing & taste rules
- 156 frames (5.2 s): gather 2.6 s, hold 1 s, break-out 1.5 s. Per tile 0.34-s arrival (ease in/out cubic, long deceleration into the slot), ripple step 0.045 s per ring; a last tile in by ~0.6 of the clip's progress.
  Ring spacing above 0.07 s reads as roll call, below 0.03 s as simultaneous.
- On landing each tile does a small damped rock (<= 2.5 degrees, ~10 frames) as the click-in.
- Opacity arrives quickly (about 0.4 s of the tile time) so it reads as physical, not as a fade-in.
- Hold ~1 s as the only reading window; add a slow 3 % push. Longer copy needs a longer hold before take-off.
- Exit: the tiles leave by displacement (620-880 px away from the centre, extra spin +-150 degrees, ease-in), never by fading; finish the exit before the final frame
  or corner tiles hang on the frame edge for a second.
- Keep the logo inside one tile, not on a seam.
- Everything random must be seeded so re-renders match.

## Sound for it
`reverse_swell` into the click-in (-14), `impact_punch` as the last tile lands (-8), `whoosh_fall` + `glitch_burst` on the break-out (-12 / -20).

## Common mistakes
- Fading the tiles out on exit (reads as disappearing, not flying).
- A logo straddling a seam (a hairline cut through it).
- Using the full effect as a transition without re-mapping the two shots onto the tile faces.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/opening/fracture.md` (Apache-2.0; see ../NOTICE).
