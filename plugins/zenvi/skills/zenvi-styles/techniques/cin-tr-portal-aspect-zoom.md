---
id: cin-tr-portal-aspect-zoom
kind: technique
summary: "When the film goes inside the product: a window opens in an accent tile that stretches to 16:9 and flies off."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_title_tool, add_clip_to_timeline_tool, add_shape_mask_tool, set_keyframes_tool, add_sfx_tool]
pace: fast
mood: [epic, bold, punchy]
aspect: ["16:9", "9:16"]
pairs_with: [t110, shot-ui-to-brand-morph, cin-tr-scale-through-cut]
avoid_with: [kcut-flood-climax]
needs: []
drawn: cinetic
---

# Portal zoom with aspect morph

cinetic `tr-portal-aspect-zoom` · Transition · signature · energy high · formats launch, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A window opens in the middle of a solid tile. Tile and window grow faster and faster while the square stretches to 16:9, until the window's interior is the next scene and the tile's border has flown off the edges.

Use when: The film's energy peak and act break, going inside the product, when the mark or app icon is a tile.

## Build it in Zenvi

1. The accent tile: `add_title_tool {"text": " ", "position_seconds": <T>, "duration_seconds": 0.65, "background_color": "#ff4d2e", "track": 3}` (or a flat colour clip), starting 204 px wide at 1080p (about 0.1 of the frame).
2. It grows exponentially, about x1.084 per frame over 39 f (0.65 s): `set_keyframes_tool {"timeline_clip_id": "<tile>", "property": "scale_x", "mode": "replace", "points": [{"seconds": <T>, "value": 0.1}, {"seconds": <T+0.65>, "value": 2.5, "ease": "ease_in_expo"}]}` and `scale_y` ending at 1.4 so the aspect goes 1 to 1.78 over the first 30 f (0.5 s) on `ease_in_out_sine`.
3. Scene two lives in a window inset 30 % of the tile on each side, present from the first frame at its final transform: `add_clip_to_timeline_tool {"file_id": "<scene2>", "position_seconds": <T>, "track": 4}` then `add_shape_mask_tool {"clip_ids": ["<scene2>"], "shape": "rectangle", "width": 0.4, "height": 0.4, "feather": 0, "keyframes": [{"seconds": <T>, "grow": 0}, {"seconds": <T+0.65>, "grow": 1.5}]}`; drop the mask at f39 (0.65 s) when the window covers the frame.
4. Tile border leaves the frame near f30 (0.5 s); keep text out until the window fills, then rise scene two's labels on a 4-6 f (0.07-0.10 s) stagger from f30.
5. Optional lead-in: the words on either side speed inward under the tile over 22 f (0.37 s, ease-in), the tile turns like a cube to a blank accent face (12 f), hold 6 f, then open. `add_sfx_tool {"recipe": "whoosh_rise", "at_seconds": <T>, "gain_db": -10}` and `{"recipe": "impact_slam", "at_seconds": <T+0.65>, "gain_db": -8}`.

Fallback: No true 3D cube turn for the lead-in; use `add_3d_scene_tool {"scene": "cube_cut"}` for a rotating cube, or skip the turn and open the window from the settled tile.

## Timing & taste rules

- cinetic's timing (60 fps): Lead-in: converge 22 f (0.37 s), cube turn 12 f (0.20 s), blank hold 6 f (0.10 s). Portal: 39 f (0.65 s) at ×1.084 per frame (border gone by about frame 30, inner window edges ≤ 78 px/f). Aspect 1 → 1.78 over the first 30 f (0.50 s). Next-scene labels start from about frame 30 on a 4-6 f (0.10 s) stagger.
- Portal 39 f (0.65 s) at about x1.084 per frame; border gone by ~f30 (0.5 s); inner window edges <= 78 px/f.
- Aspect 1 to 1.78 over the first 30 f (0.5 s) on a smooth ease.
- Next-scene labels start from ~f30 on a 4-6 f stagger.
- Lead-in: converge 22 f (0.37 s), cube turn 12 f (0.2 s), blank hold 6 f (0.1 s).
- Window inset 30 % of the tile width and height on each side.

## Sound for it

Rising whoosh across the 39 f, a slam on the frame the window covers the frame.

## Common mistakes

- The accent has already flooded the frame once, or another zoom-through sits in the same act (avoid_when).
- Putting text on the tile border: nothing readable until the window has filled.
- Linear growth: it must be exponential, or the tile crawls and then snaps.
- Avoid when: The accent has already flooded the frame once (the tile border is a brief accent flood), or another zoom-through sits in the same act.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tr-portal-aspect-zoom`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
