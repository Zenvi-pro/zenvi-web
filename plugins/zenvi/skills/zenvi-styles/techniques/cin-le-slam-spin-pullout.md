---
id: cin-le-slam-spin-pullout
kind: technique
summary: "When a high-energy film needs its finale: after a still beat a giant dark mark rushes back, spinning and brightening."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-logo-sting]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, add_effect_tool, set_effect_property_tool, apply_fx_tool, add_sfx_tool]
pace: frantic
mood: [violent, triumphant]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-le-living-hold, blackout-and-dead-silence-pause]
avoid_with: [cin-le-macro-pullout-breathe, cin-le-strobe-sting]
needs: []
drawn: cinetic
---

# Dark slam, spin and brighten

cinetic `le-slam-spin-pullout` · Logo and end card · signature · energy high · formats launch, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

After a near-still beat, giant low-contrast arms of the mark sweep over the frame, and the mark rushes back to logo size while spinning into place and brightening to full contrast.

Use when: The finale of a high-energy film, where the single biggest motion spike follows the single biggest stillness. Radially symmetric or rotational marks (asterisks, petals, rings).

## Build it in Zenvi

1. Hold the previous card (URL or last line) almost still (0.3 px/f drift) for 60-90 f (1-1.5 s) ending in a freeze of at most 15 f (0.25 s): `freeze_frame_tool {"clip_query": "<last shot>", "at_seconds": 4.5, "hold_seconds": 0.25}`.
2. The mark at full speed, no ease-in: `add_clip_to_timeline_tool {"file_id": "<logo>", "position_seconds": 4.75, "duration_seconds": 3.0, "track": "3"}`; `set_keyframes_tool {"timeline_clip_id": "<logo>", "property": "scale_x", "ease": "ease_out_expo", "points": [{"seconds": 4.75, "value": 12}, {"seconds": 5.85, "value": 1.0}]}` (same on `scale_y`; 66 f, 1.1 s) and `rotation` -70 to 0 over 60 f (1 s) `ease_out_expo`.
3. Dark to full contrast: `add_effect_tool {"timeline_clip_id": "<logo>", "effect": "Brightness"}` then keyframe brightness from -0.7 to 0 with `set_effect_property_tool` (31 % of the way at f10, 0.17 s; 97 % at f40, 0.67 s), so the fastest frames are dark and cannot strobe.
4. Blur the previous text out underneath over 10 f (0.17 s) and the mark's first 18 f (0.3 s): `apply_fx_tool {"clip_id": "<logo>", "effects": [{"effect": "radial_blur", "amount": 0.85, "start": 0, "end": 0.3}]}`.
5. `add_sfx_tool {"recipe": "impact_slam", "at_seconds": 4.75, "gain_db": -6}` and `{"recipe": "whoosh_fall", "at_seconds": 4.75, "gain_db": -12}`.

## Timing & taste rules

- cinetic's timing (60 fps): 66 f (1.10 s). Log rate 0.17/f at f0 (0.00 s), 0.10 at f10 (0.17 s), 0.04 at f20 (0.33 s). Spin 5.2 deg/f at the start, 2.8 deg/f by f10 (0.17 s), at rest by f60 (1.00 s). Fill 31% of the way to white at f10 (0.17 s), 70% at f20 (0.33 s), 97% at f40 (0.67 s). Preceded by a near-still hold of 60-90 f (1.50 s) that ends in a freeze of at most 15 f (0.25 s).
- Total 66 f (1.1 s); log rate 0.17/f at f0, 0.10 at f10, 0.04 at f20; spin 5.2 deg/f at the start, at rest by f60 (1 s).
- Fill 31 % of the way to white at f10 (0.17 s), 70 % at f20 (0.33 s), 97 % at f40 (0.67 s).
- Motion blur only while the log rate is above 0.05/f (about the first 18 f, 0.3 s).
- Preceded by a near-still hold of 60-90 f (1-1.5 s).

## Sound for it

impact_slam on the first frame of the rush, a falling whoosh under it; silence in the freeze before it.

## Common mistakes

- Marks with an obvious up direction (lettermarks) that look wrong at -70 degrees.
- Calm films, or films that already used a spin or fast zoom-out seam.
- Starting bright: the fastest frames must be dark so they cannot strobe.
- Avoid when: Marks with an obvious up direction that look wrong at -70 deg (lettermarks). Calm films. Films that already used a spin or a fast zoom-out seam.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`le-slam-spin-pullout`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
