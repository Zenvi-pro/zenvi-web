---
id: cin-d3-impact-morph-stretch
kind: technique
summary: "When cause and effect is the message: a dot hits a tile, which swaps shape and colour, stretches, no rebound."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-logo-sting]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, apply_fx_tool, add_motion_block_tool, add_sfx_tool]
pace: fast
mood: [impactful, cause-effect, crisp]
aspect: ["16:9", "1:1"]
pairs_with: [shot-slam-entrance, kcut-hit-fx, cin-ps-continuity-thread]
avoid_with: [cin-d3-peek-launch-recede, shot-attention-bounce]
needs: [floor-ripple-grid]
drawn: cinetic
---

# Impact morph with stretch and floor ripple

cinetic `d3-impact-morph-stretch` · Depth and 3D · signature · energy high · formats launch, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Something accelerates into a 3D tile. On contact the tile swaps shape and colour in one frame, stretches tall and settles without rebound while the floor beneath it ripples.

Use when: Cause and effect is the message: raw input hits the product and becomes something new.

## Build it in Zenvi

1. The tile as two clips on the same spot: tile A (rounded square, ink) and tile B (circle, accent), B starting on the contact frame (a hard swap in 1 f): `add_clip_to_timeline_tool {"file_id": "<tile_a>", "position_seconds": 0, "duration_seconds": 1.2, "track": 2}` and `{"file_id": "<tile_b>", "position_seconds": 1.2, "duration_seconds": 1.8, "track": 2}`.
2. The dot (or the previous shot's element) accelerates into the tile, travel at most 270 px (0.25), 12 f (0.2 s) on ease_in_cubic: `set_keyframes_tool {"timeline_clip_id": "<dot>", "property": "location_x", "mode": "replace", "points": [{"seconds": 1.0, "value": -0.25}, {"seconds": 1.2, "value": 0, "ease": "ease_in_cubic"}]}`; `apply_fx_tool {"clip_id": "<dot>", "effects": [{"effect": "directional_blur", "amount": 0.7, "start": 1.0, "end": 1.2}]}`.
3. Stretch along the impact axis: `set_keyframes_tool {"timeline_clip_id": "<tile_b>", "property": "scale_y", "mode": "replace", "points": [{"seconds": 1.2, "value": 1.31}, {"seconds": 1.4, "value": 1.0, "ease": "ease_out_cubic"}]}` and `scale_x` 0.90 to 1.0 on the same times; settles in about 12 f (0.2 s) with no rebound.
4. Floor ripple: `add_motion_block_tool {"block": "particle_burst", "position_seconds": 1.2, "duration_seconds": 1.0, "params": {"shape": "rings", "origin": [[0.5, 0.7]], "count": 3}}`.
5. Camera punch of 2 %: `set_keyframes_tool` on the background `scale_x/y` 1.0, 1.02, 1.0 over 0.17 s. Impact sound on the swap frame, no flash: `add_sfx_tool {"recipe": "impact_slam", "at_seconds": 1.2, "gain_db": -8}`.

Fallback: The vertex-displaced perspective grid floor is not available; a ring burst at the contact point stands in for the ripple.

## Timing & taste rules

- cinetic's timing (60 fps): Approach 12 f (0.20 s) ease_in_cubic (at most 270 px); swap in 1 f (0.02 s); height stretch +31% decaying over about 12 f (0.20 s) (hitPulse(t, 1, 4)); ripple 6 px, tau 6 f (0.10 s), front at 15 px/f, gone by about f20 (0.33 s); punch hitPulse(t, 2, 6) x 0.02.
- Approach 12 f (0.2 s) on ease_in_cubic, at most 270 px; swap in 1 f (0.017 s).
- Height stretch +31 % and width -10 %, decaying over about 12 f (0.2 s) with no rebound; camera punch +2 %.
- Ripple: 6 px amplitude, tau 6 f, front moving 15 px/f, gone by about f20 (0.33 s).
- Overshoot belongs to true landings only; here the settle is dead.

## Sound for it

The impact lands on the swap frame; a sub_drop under it at -12 dB; no flash.

## Common mistakes

- A film that already spent its two true landings, or a calm film.
- Using it as a generic transition.
- Adding a rebound after the stretch.
- Avoid when: The film has already spent its two true landings or is calm; never as a generic transition.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`d3-impact-morph-stretch`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
