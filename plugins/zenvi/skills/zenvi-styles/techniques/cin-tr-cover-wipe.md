---
id: cin-tr-cover-wipe
kind: technique
summary: "When the promise gives way to the product: a real UI panel sweeps over the old shot and the scene changes behind it."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, apply_fx_tool, add_sfx_tool]
pace: fast
mood: [product, confident, kinetic]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-hidden-cut-masks, t110, cin-tr-velocity-handoff-cut]
avoid_with: [cin-tr-band-wipe, cin-tr-stepped-column-fill]
needs: []
drawn: cinetic
---

# Product surface cover wipe

cinetic `tr-cover-wipe` · Transition · workhorse · energy medium · formats launch, feature, walkthrough, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A product surface (a UI panel, a window, a device) moves in front of the old shot and either passes straight through it with the scene changed behind it, or lands and becomes the new shot.

Use when: Promise to product: the UI pushes the headline off. Scene changes that should show the product itself rather than a graphic.

## Build it in Zenvi

1. Panel (a real screenshot or recording of the product UI, 1.15x the frame height) on a high track: `add_clip_to_timeline_tool {"file_id": "<ui-panel>", "position_seconds": <T-0.3>, "duration_seconds": 0.7, "track": 4}`.
2. Pass-through at a constant 64-72 px/f: `set_keyframes_tool {"timeline_clip_id": "<panel>", "property": "location_y", "mode": "replace", "points": [{"seconds": <T-0.3>, "value": -1.15}, {"seconds": <T+0.37>, "value": 1.15}], "interpolation": "linear"}` (about 2600 px, 36-40 f / 0.6-0.67 s). Smear it: `apply_fx_tool {"clip_id": "<panel>", "effects": [{"effect": "directional_blur", "amount": 0.5, "params": {"angle": 90}}]}`.
3. The scene beneath switches on the first frame the panel covers the whole frame: end clip A and start clip B at `T` (the covering frame).
4. Land variant: the window rises ~940 px from below to rest over 44 f (0.73 s, `ease_in_out_sine`, peak ~64 px/f) above the title, while the title's `alpha` fades 1 to 0 over 36 f (0.6 s) starting 16 f (0.27 s) earlier.
5. Occluder variant: during a fast camera push, time a foreground object crossing the lens on the push's peak frame, covering >= 60 % of the frame for 2-4 f (0.03-0.07 s), and switch the world then.
6. `add_sfx_tool {"recipe": "whoosh_medium", "at_seconds": <T-0.15>, "gain_db": -14}`.

## Timing & taste rules

- cinetic's timing (60 fps): Pass-through: about 2600 px at 64-72 px/f, or 36-40 f (0.67 s); the scene switches on the full-cover frame. Land: 940 px over 44 f (0.73 s) on ease_out_cubic (peak about 64 px/f at 31% of the move); the title fades over 36 f (0.60 s), starting 16 f (0.27 s) before. Occluder: covers for 2-4 f (0.07 s) at the push's peak.
- Pass-through: ~2600 px at 64-72 px/f, i.e. 36-40 f (0.6-0.67 s); the switch is on the full-cover frame.
- Land: 940 px over 44 f (0.73 s), peak ~64 px/f at 31 % of the move; title fades over 36 f (0.6 s), starting 16 f earlier.
- Occluder: covers for 2-4 f at the push's peak.
- The surface is above the old shot in z-order; its content need not be readable until it rests.
- Never above 80 px/f for the pass-through: shorten the distance with a cut instead.

## Sound for it

A whoosh peaking at the full-cover frame; a soft thud when the window lands in the land variant.

## Common mistakes

- A plain coloured slab as the surface: it is a preset wipe (avoid_when).
- A pass-through that needs more than 80 px/f.
- Switching the scene before the panel covers the frame: the swap shows.
- Avoid when: The surface is a plain coloured slab (then it is a preset wipe), or the pass-through would need more than 80 px/f; shorten the distance with a cut instead.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tr-cover-wipe`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
