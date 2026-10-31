---
id: cin-lc-bento-cell-takeover
kind: technique
summary: "When a four-up overview should dive into one feature without a cut: the grid scales up and one cell fills the frame."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_template_tool, set_keyframes_tool, apply_fx_tool, add_sfx_tool]
pace: medium
mood: [impressive, seamless, confident]
aspect: ["16:9", "1:1"]
pairs_with: [shot-bento-light-up, grid-cell-reflow-and-collapse, shot-mosaic-reflow]
avoid_with: [cin-lc-live-split-view, cin-lc-one-centred-subject]
needs: [grid-cell-reflow]
drawn: cinetic
---

# Bento cell takes over the frame

cinetic `lc-bento-cell-takeover` · Layout and composition · signature · energy high · formats loop, launch, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

In a flush four-cell grid, one cell grows to fill the whole frame while its siblings are pushed off the edges, still playing as they go, turning a breadth overview into one focused shot without a cut.

Use when: A loop or launch that opens on four-up breadth and then dives into one feature; returning to the overview between features.

## Build it in Zenvi

1. Flush 2x2 grid of live clips: `add_motion_template_tool {"template": "grid", "position_seconds": 0, "duration_seconds": 6, "file_ids": ["<a>", "<b>", "<c>", "<d>"], "layout": "grid", "tiles": 4, "gutter": 0, "radius": 0, "reveal": "cut", "zoom_into": 2}`; `zoom_into` is the 0-based tile the camera pushes into (the template does the eased push to that tile).
2. If the template's zoom is not the shape wanted, build it by hand: four clips on tracks 1-4, each scaled to 0.5 and placed on its quadrant (`location_x/y` of +/-0.25), then `set_keyframes_tool {"timeline_clip_id": "<cell_i>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 3.0, "value": 0.5}, {"seconds": 4.07, "value": 1.0, "ease": "ease_in_out_sine"}]}` for all four (and `scale_y`), with `location_x/y` moving each cell out by double its offset so the chosen cell lands on the frame (64 f, 1.07 s) and the others slide off.
3. Motion blur on the push: `apply_fx_tool {"clip_id": "<cell_i>", "effects": [{"effect": "directional_blur", "amount": 0.6, "start": 3.1, "end": 3.95}]}` on each cell; every cell keeps playing through the move.
4. After landing, hold the full-frame scene at least 90 f (1.5 s); to return to the overview, run the keyframes in reverse (scale 1 to 0.5, 64 f, `ease_in_out_sine`).
5. `add_sfx_tool {"recipe": "whoosh_medium", "at_seconds": 3.1, "gain_db": -12}`.

Fallback: Motion blur on the edge-of-frame content is a baked directional blur on the whole cell, not a per-edge blur; if the grid template lacks the corner-fixed zoom, do the by-hand keyframes.

## Timing & taste rules

- cinetic's timing (60 fps): 64 f (1.07 s) on ease_in_out_sine; content at the far frame edge peaks around 60 px/f (the far corner about 68 px/f), with motion blur. Cells keep playing throughout. Follow with at least 90 f (1.50 s) of the full-frame scene. To return to the overview, run it in reverse (scale 2 to 1, 64 f (1.07 s), ease_in_out_sine).
- 64 f (1.07 s) on ease_in_out_sine; content at the far edge peaks near 60 px/f.
- Seams vanish only with gap 0, whole-pixel cells and the same ink colour in every cell.
- Every cell's loop keeps playing through the move; blur while the far edge exceeds 12 px/f.
- Follow with at least 90 f (1.5 s) of the full-frame scene; no more than twice per film.

## Sound for it

One whoosh_medium peaking at the middle of the push; no per-cell sounds.

## Common mistakes

- A chosen cell whose scene was not composed for full frame: it looks sparse when it lands.
- More than twice per film.
- Gutters or rounded corners on the grid: the seams show and the landing is not exact.
- Avoid when: A chosen cell whose scene was not composed for full frame (it will look sparse), or more than twice per film.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`lc-bento-cell-takeover`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
