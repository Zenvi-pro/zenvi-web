---
id: cin-d3-card-fan-bury-scatter
kind: technique
summary: "When a count must feel physical: a dozen cards swoop in from two corners, bury the frame, then scatter to one number."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_clip_to_timeline_tool, set_clip_property_tool, set_keyframes_tool, apply_fx_tool, add_sfx_tool]
pace: fast
mood: [abundant, physical, climactic]
aspect: ["16:9", "1:1"]
pairs_with: [cin-lc-swarm-cluster-burst, shot-card-stack-fan, kcut-count-up]
avoid_with: [cin-lc-swarm-cluster-burst, shot-card-flock-tumble]
needs: [card-swarm-radial-rig, true-motion-blur-native]
drawn: cinetic
---

# Card fan that buries, then scatters

cinetic `d3-card-fan-bury-scatter` · Depth and 3D · signature · energy high · formats launch, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A dozen identical cards swoop in from two corners along a curved arc and stack in depth until they bury the frame. They drift for a beat, then scatter outward and leave one small card in the centre that carries the number.

Use when: A big count or scale claim (cards issued, transactions, users) needs to feel physical before it collapses to one legible number.

## Build it in Zenvi

1. The hero first, small and lowest, at the frame centre from the start: `add_motion_block_tool {"block": "counter", "position_seconds": 0, "duration_seconds": 5, "params": {"values": ["12.4M"], "label": "cards issued"}, "placement": "over_video"}`; the figure locks in 4-6 f (0.07-0.1 s) after the last card clears.
2. Twelve identical single-hue card images above it, tracks 2-13, all 5 s long: `add_clip_to_timeline_tool {"file_id": "<card>", "position_seconds": 0.2, "duration_seconds": 4.8, "track": 2}`; scale each about 0.3 with `set_clip_property_tool`; tilt each along the arc with `rotation` (the path tangent, plus a 2-4 deg step per card).
3. Fly-in per card from just beyond the opposite corners (at most 0.36 of the frame width): `set_keyframes_tool {"timeline_clip_id": "<card_i>", "property": "location_x", "mode": "replace", "points": [{"seconds": "<0.2 + 0.033*i>", "value": "<corner_x>"}, {"seconds": "<0.2 + 0.033*i + 0.83>", "value": "<slot_x_i>", "ease": "ease_out_expo"}]}`, `location_y` the same. 50 f (0.83 s) each, starts 2 f (0.03 s) apart; the fan covers 50 % of its final area by f6, 90 % by f26 (0.43 s). Later cards sit on lower tracks so they bury the earlier ones.
4. Drift 84 f (1.4 s): `location_x/y` +/-0.015 and `scale_x/y` +2 %, `ease_in_out_sine`.
5. Scatter at about 3.0 s: each card out along its radial vector by 0.18 of the frame while `scale_x/y` rises to 1.5x, 26 f (0.43 s), `ease_in_cubic`; bake the blur first with `apply_fx_tool {"clip_id": "<card_i>", "effects": [{"effect": "directional_blur", "amount": 0.7, "start": 3.0, "end": 3.43}]}`.
6. `add_sfx_tool {"recipe": "whoosh_rise", "at_seconds": 2.6}` and `{"recipe": "impact_boom", "at_seconds": 3.0, "gain_db": -8}`.

Fallback: Real tilt in depth (rotateX/rotateY per card) is not available on clips; keep the corner arc and the stacking order, skip the depth tilt.

## Timing & taste rules

- cinetic's timing (60 fps): Per card 50 f (0.83 s) on ease_out_cubic, starts 2 f (0.03 s) apart (22 f (0.37 s) span): the fan covers 50% of its final area by f6 (0.10 s), 90% by f26 (0.43 s) and all of it by f50 (0.83 s) (peak about 62 px/f). Drift 84 f (1.40 s) at 0.2-0.5 px/f plus breath +2%. Scatter 26 f (0.43 s) on ease_in_cubic, peak about 75 px/f (master motion blur). The hero figure locks 4-6 f (0.10 s) after the last card clears.
- Per card 50 f (0.83 s) on ease_out_expo, starts 2 f (0.03 s) apart (a 22 f, 0.37 s span); the fan reaches its full area at f50.
- Drift 84 f (1.4 s) at 0.2-0.5 px/f plus a 2 % breath.
- Scatter 26 f (0.43 s) on ease_in_cubic, 340 px outward and about 1.5x scale, peak about 75 px/f with blur.
- Cards use one tonal ramp of one colour so the repetition reads as one material; hero locks 4-6 f after the last card clears.

## Sound for it

A rising whoosh into the scatter and one boom on the frame the first cards leave; no sound per card.

## Common mistakes

- A film that already has a swarm or tile burst.
- A stat that must be read at once: the 50 f bury hides it.
- A calm film: the bury is too loud.
- Avoid when: The film already has a card or tile swarm, or the stat must be read at once; in a calm film the 50 f bury is too loud.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`d3-card-fan-bury-scatter`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
