---
id: cin-cam-isolating-push
kind: technique
summary: "When one row, card or column is the point: the camera pushes into it while everything around it fades off or dims."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [set_keyframes_tool, add_shape_mask_tool, add_vignette_tool, add_sfx_tool]
pace: medium
mood: [focused, guiding, clean]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-pullback-isolation, shot-spotlight-hero-card, screen-capture-zoom-onto-the-number]
avoid_with: [cin-cam-reframe-to-subject, cin-cam-breathing-zoom]
needs: []
drawn: cinetic
---

# Isolating push into one item

cinetic `cam-isolating-push` · Camera · workhorse · energy medium · formats feature, walkthrough, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The camera pushes into one row, card or column while everything around it fades, dims or slides off the edges, picking a single thread out of a busy layout.

Use when: Choosing one result from a list of parallel processes, moving from a typographic act into a UI close-up without a cut, or steering the eye to where the next action will happen.

## Build it in Zenvi

1. Dive: `set_keyframes_tool {"timeline_clip_id": "<screen>", "property": "scale_x", "mode": "replace", "points": [{"seconds": <a>, "value": 1.0}, {"seconds": <a+1.33>, "value": 4.0, "ease": "ease_in_out_sine"}]}` (and `scale_y`) on 80 f (1.33 s), `origin_x/origin_y` on the item.
2. Siblings fade over 20 f (0.33 s) from `a`: with the rows as separate clips or masked copies, `set_keyframes_tool {"timeline_clip_id": "<sibling>", "property": "alpha", "mode": "replace", "points": [{"seconds": <a>, "value": 1}, {"seconds": <a+0.33>, "value": 0}]}`; or isolate by mask: `add_shape_mask_tool {"clip_ids": ["<screen>"], "shape": "rectangle", "x": 0.5, "y": 0.42, "width": 0.9, "height": 0.09, "feather": 0.02, "outside": false}` plus a dimmed copy underneath.
3. As the push ends, the item's icon dims to 0.3 and the next state swaps in on a whole frame (a zoom-through without a cut).
4. Eject version: `scale` 1 to 1.48 over 30 f (0.5 s, `ease_in_out_sine`) then +4 % over 60 f (1.0 s, linear).
5. Gentle focus version: `add_effect_tool` Blur at 8 on the side columns, `alpha` 0.6, parent `scale_x/scale_y` 1.0 to 1.06 over 18 f (0.3 s). `add_sfx_tool {"recipe": "whoosh_short", "at_seconds": <a+0.2>, "gain_db": -18}`.

## Timing & taste rules

- cinetic's timing (60 fps): Dive 80 f (1.33 s), x4 on ease_in_out_sine (peak about 5%/f), sibling fades 20 f (0.33 s), swap on the last frame. Accelerate-through 60 f (1.00 s), x1.25 on ease_in_cubic, surround fade 16 f (0.27 s). Eject 30 f (0.50 s), x1.48 on ease_in_out_sine, then +4% over 60 f (1.00 s). Focus pull 18 f (0.30 s), x1.06, blur 8 px, opacity 0.6, running straight into the next move.
- Dive 80 f (1.33 s), x4 on a smooth ease (peak ~5 %/f), siblings fade over 20 f (0.33 s), swap on the last frame.
- Accelerate-through 60 f (1.0 s), x1.25 on an ease-in, surround fades over 16 f (0.27 s), then cut on the peak frame.
- Eject 30 f (0.5 s), x1.48, then +4 % over 60 f; flanking words blur up to 6 px once past 80 % of the half-width.
- Gentle focus 18 f (0.3 s): x1.06, blur 8, opacity 0.6, running straight into the next move.
- Only if the item stays readable at 4x.

## Sound for it

Soft `whoosh_short` at the start; a `ui_tap` at the swap frame.

## Common mistakes

- The item is still too small to read at 4x, or the surrounding layout carries information the viewer still needs (avoid_when).
- Fading siblings after the push starts: they fade first or together, never after.
- Hard-cutting the swap while the push is still accelerating without matching scale velocity.
- Avoid when: The item is still too small to read at 4x, or the surrounding layout carries information the viewer still needs.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cam-isolating-push`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
