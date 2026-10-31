---
id: cin-cam-crash-zoom-through
kind: technique
summary: "When a launch hits its peak: an object extrudes toward camera, the camera slams in and cuts to its interior."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-logo-sting]
tools: [set_keyframes_tool, apply_fx_tool, add_3d_scene_tool, add_sfx_tool]
pace: frantic
mood: [violent, spatial, launch]
aspect: ["16:9", "9:16"]
pairs_with: [t110, t106, shot-crash-zoom-punch]
avoid_with: [cin-cam-pull-lands-event]
needs: []
drawn: cinetic
---

# Extrude then crash in

cinetic `cam-crash-zoom-through` · Camera · accent · energy high · formats launch, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

An object grows toward camera (a disc extruding into a tall cylinder) and the camera slams into it, hard-cutting to its interior while still rushing forward.

Use when: A violent spatial jump into the product at the energy peak of a launch film or sting.

## Build it in Zenvi

1. Shot A: the object (a disc image or shape) on track 2. Extrude: `set_keyframes_tool {"timeline_clip_id": "<disc>", "property": "scale_y", "mode": "replace", "points": [{"seconds": <s>, "value": 1.0}, {"seconds": <s+0.2>, "value": 2.5, "ease": "ease_in_cubic"}]}` with `origin_y` 1.0 (its base) over 12 f (0.2 s) so it accelerates toward the camera.
2. Overlapping the last 8 f of the extrusion (from `s+0.067`) the camera slams into its face: `scale_x` / `scale_y` on the whole shot `[{"seconds": <s+0.067>, "value": 1.0}, {"seconds": <s+0.467>, "value": 1.9, "ease": "ease_in_cubic"}]`, 24 f (0.4 s), about 8 %/f (~77 px/f at the frame edge) on the cut frame.
3. Hard-cut at `s+0.467` to the interior shot B, already moving: `set_keyframes_tool {"timeline_clip_id": "<interior>", "property": "scale_x", "mode": "replace", "points": [{"seconds": <s+0.467>, "value": 1.76}, {"seconds": <s+1.133>, "value": 1.0, "ease": "ease_out_cubic"}]}` (and `scale_y`), 40 f (0.67 s). Draw the tube walls as 2-3 flat, crisp steps of the object's own colour (darker at the rim, lighter to the vanishing point), no bloom.
4. Blur the frames either side: `apply_fx_tool {"clip_id": "<A>", "effects": [{"effect": "radial_blur", "amount": 0.9, "start": <len-0.1>, "end": <len>}]}` and on B's first 0.1 s; or build the tunnel with `add_3d_scene_tool {"scene": "glass_hero", "params": {"shape": "torus"}}`.
5. `add_sfx_tool {"recipe": "whoosh_rise", "at_seconds": <s>, "gain_db": -10}` and `{"recipe": "impact_slam", "at_seconds": <s+0.467>, "gain_db": -6}`.

## Timing & taste rules

- cinetic's timing (60 fps): Extrusion 12 f (0.20 s) on ease_in_cubic. Camera push 24 f (0.40 s) on a cubic ease-in, x1.9, reaching about 8%/f (about 77 px/f at the frame edge) on the cut frame. Interior entry x1.76 -> rest over 40 f (0.67 s) on ease_out_cubic.
- Extrusion 12 f (0.2 s) on an ease-in, base pinned.
- Camera push 24 f (0.4 s) on a cubic ease-in, x1.9, ~8 %/f (~77 px/f at the frame edge) on the cut frame.
- Interior entry x1.76 to rest over 40 f (0.67 s) on an ease-out.
- Flat, crisp wall steps; no bloom, halo or bright blurred edges.
- Blur the frames either side of the cut so the frame edge stays under ~80 px/f.

## Sound for it

`whoosh_rise` through the extrusion and push, `impact_slam` on the cut frame.

## Common mistakes

- Calm films, any second use in the same film, and readable text on either side of the cut (avoid_when).
- A soft glowing tunnel: draw flat crisp steps.
- No overlap between the extrusion and the push: they must overlap by 8 f.
- Avoid when: Calm films, any second use in the same film, and readable text on either side of the cut.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cam-crash-zoom-through`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
