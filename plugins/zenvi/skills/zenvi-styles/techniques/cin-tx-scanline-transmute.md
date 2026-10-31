---
id: cin-tx-scanline-transmute
kind: technique
summary: "When one hero object must turn digital, once per film: a bar sweeps down it, dot-matrix above, solid below."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [duplicate_clips_tool, apply_fx_tool, search_transitions_tool, add_transition_tool, add_title_tool, add_shape_mask_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [techno, transformative, sleek]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [shot-scan-annotate, crt-scanline-and-schematic-inserts, cin-cl-light-swell-bridge]
avoid_with: [cin-tx-locked-mosaic, cin-tx-ring-field]
needs: [keyframed-polygon-mask]
drawn: cinetic
---

# Scanline transmutation

cinetic `tx-scanline-transmute` · Texture and finish · signature · energy medium · formats launch, feature, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A bright bar sweeps down a hero object: above the bar the object has already become its digital form, a dot-matrix disc with a crisp rim, while below it the original solid object remains.

Use when: One hero transformation per film: an object becoming its private, digital, encrypted or connected form; the moment the concept turns.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same copy and halftone: duplicate the hero, `apply_fx_tool {"clip_id": "<copy>", "effects": [{"effect": "halftone", "amount": 1, "params": {"cell": 16, "ink": "#ffffff", "paper": "#0b0c0f"}}]}`, with dots in white or the accent, never violet.
2. Same wipe transition and timing (`add_transition_tool` wipe down from 3.18 s over 0.39 s).
3. Flat hard-edged bar 12-24 px thick in white or the accent: `add_title_tool {"text": " ", "background_color": "#ffffff", "position_seconds": 3.0, "duration_seconds": 0.57, "track": "4"}` with `add_shape_mask_tool {"clip_ids": ["<bar>"], "shape": "rectangle", "width": 0.5, "height": 0.015, "feather": 0}`, same three `location_y` segments. No bloom, no tint, and nothing lit outside the object's outline.

**Full look** (relies on glow, purple: only when the person's brand supplies that look):

1. The solid hero on track 2 (about 40 % of the frame height, e.g. from 0.30 to 0.70). Copy it above: `duplicate_clips_tool {"timeline_clip_ids": ["<hero>"], "to_track": "3"}`, then make the copy dot-matrix: `apply_fx_tool {"clip_id": "<copy>", "effects": [{"effect": "halftone", "amount": 1, "params": {"cell": 16, "ink": "#ffffff", "paper": "#0b0c0f"}}]}`.
2. Reveal the dot layer top-down with a downward wipe synced to the bar: find the wipe with `search_transitions_tool {"query": "wipe down"}`, then `add_transition_tool {"track": "3", "position_seconds": 3.18, "duration_seconds": 0.39, "transition": "<wipe_name>", "direction": "down"}` (the copy appears from 3.0 s).
3. The bar: `add_title_tool {"text": " ", "background_color": "#ffffff", "position_seconds": 3.0, "duration_seconds": 0.57, "track": "4"}` plus `add_shape_mask_tool {"clip_ids": ["<bar>"], "shape": "rectangle", "x": 0.5, "y": 0.5, "width": 0.5, "height": 0.035, "feather": 0.002}` (3-4 % of the frame height). Move it in three segments on `location_y`: `set_keyframes_tool {"timeline_clip_id": "<bar>", "property": "location_y", "points": [{"seconds": 3.0, "value": -0.23}, {"seconds": 3.18, "value": -0.02, "ease": "linear"}, {"seconds": 3.28, "value": 0, "ease": "linear"}, {"seconds": 3.57, "value": 0.2, "ease": "ease_in_out_sine"}]}`.
4. Bloom on the dot layer for the lit look: `apply_fx_tool {"clip_id": "<copy>", "effects": [{"effect": "bloom", "amount": 0.4, "params": {"threshold": 0.6, "radius": 0.4}}]}` (applied in the same call as the halftone, after it).
5. `add_sfx_tool {"recipe": "whoosh_medium", "at_seconds": 3.3, "gain_db": -12}` at the third segment's speed peak, `{"recipe": "pop", "at_seconds": 3.57, "gain_db": -10}` on f34.

Fallback: Zenvi's masks cannot move one edge on a keyframed path, so the dot layer is revealed by a wipe transition timed to the bar rather than a clip that follows it exactly. If the wipe and bar drift apart, shorten the bar to a hairline and let the wipe lead by 2 f (0.03 s).

## Timing & taste rules

- cinetic's timing (60 fps): 34 f (0.57 s) in all: 11 f (0.18 s) fast (20-30 px/f at 1080p), a 6 f (0.10 s) near-hold at ~4-6 px/f on the symbol, 17 f (0.28 s) on ease_out_cubic to rest; bar 36-40 px; the transformed object then holds 24-40 f (0.67 s) with a drift under 1 px/f.
- 34 f (0.57 s) in all: -8 % to 45 % over f0-11 (0.18 s, linear, 20-30 px per frame), a near-hold 45-50 % over f11-17 (0.1 s, 4-6 px per frame) on the object's symbol, then 50-100 % over f17-34 (0.28 s, ease_in_out_sine).
- Bar 36-40 px thick (3-4 % of the frame height) and enters already moving, from 8 % above the object.
- Dot pitch about 16 px with 5 px dots and a crisp 2 px rim; the object should be at least 25 % of the frame height or the dots cannot read.
- The transformed object then holds 24-40 f (0.4-0.67 s) with a drift under 1 px per frame.
- One per film.

## Sound for it

A whoosh apex on the third segment's velocity peak (f17-f34) and one snap on f34, the frame the object completes.

## Common mistakes

- More than once per film.
- Using it for an ordinary UI state change.
- Objects under about 25 % of the frame height, where the dot pitch cannot read.
- Avoid when: More than once per film; ordinary UI state changes; objects under ~25% of frame height, where the dot pitch cannot read.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tx-scanline-transmute`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
