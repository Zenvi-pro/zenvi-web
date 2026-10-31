---
id: shot-page-waterfall-wall
kind: technique
summary: "When 'there is far more than we can show' is the point: screens flow past in tilted columns at different speeds."
categories: [saas-app-launch, product-launch-film, brand-story-corporate, ugc-ad-testimonial, news-short-vertical-explainer]
tools: [add_motion_template_tool, set_keyframes_tool, add_clip_to_timeline_tool, add_vignette_tool, add_sfx_tool]
pace: medium
mood: [abundant, flowing, modern]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-emphasis-scale, T062, T045]
avoid_with: [shot-bento-light-up, shot-card-stack-fan, shot-carousel-ring]
needs: [perspective-plane-camera, grid-cell-reflow]
---

# Page waterfall wall

## What it is
Real screenshots cut into 3-4 columns, tilted back like a wall, scroll endlessly at different speeds with the middle column running the other way
while the camera creeps in slowly. The feeling is volume, not detail. It is a state, not an entrance: it can follow a wall reveal as the "keeps
flowing" beat, then hand over to a single hero card.

## Build it in Zenvi
Native approximation (flat, no perspective tilt): 3 column clips, each a tall image/video of stacked card slices placed side by side:
1. `add_motion_template_tool {"template": "grid", "layout": "strips_v", "tiles": 3, "file_ids": ["<a>", "<b>", "<c>"], "gutter": 14, "radius": 20, "reveal": "cut", "drift": "up", "position_seconds": 0, "duration_seconds": 5}`
   gives three columns at the same speed and direction. For differing speeds/directions, place three clips yourself (`add_clip_to_timeline_tool`) and
   `set_keyframes_tool` `location_y` per column, `interpolation: linear`: left 12 s per loop (up), middle 9 s (down), right 14 s (up); use a clip two screens tall.
2. The slow push: `set_keyframes_tool` `scale_x`/`scale_y` 1.2 to 1.26 on each column (or on a parent comp).
3. Tilt: `needs: perspective-plane-camera` (rotateX 20 degrees, perspective 1000 px). A fake: `shear_y` on the columns, and top/bottom fades via
   `add_vignette_tool` (edge falloff).
4. Sound: usually a bed only; an `add_sfx_tool` `whoosh_long` at -26 dB underneath if there is none.

## Timing & taste rules
- 3 columns at 1080p, 4 on ultra-wide; 2 columns do not read as a wall, 5 make the slices too narrow.
- Speeds differ by at least 25 % (12 / 9 / 14 s per loop), middle column reversed; equal speed and direction reads as one big image sliding.
- The fastest column no quicker than 7 s a loop, or it is screen-flicker.
- Tilt 20 degrees (above 25 the top rows smear, under 12 it does not read as a wall); base scale 1.2 so the corners are filled; the push adds up to about 1.26.
- Fade masks about 200 px top and bottom.
- Each column's content must be at least as tall as the view, and the same slice must not appear in two columns; use card-sized slices, not full-page tall shots.
- The loop distance is exactly one copy of the content (no gaps that make it jump).
- Appear only once per piece; a second wall is padding.

## Sound for it
A bed. If silent: soft `whoosh_long` (-26 dB) rising under it; no per-card sound.

## Common mistakes
- Same speed and direction in every column.
- A 3D tilt past 25 degrees with small text.
- Using it where the viewer must read: hand over to one hero card for reading.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/ui-entrance/page-waterfall-wall.md` (Apache-2.0; see ../NOTICE).
