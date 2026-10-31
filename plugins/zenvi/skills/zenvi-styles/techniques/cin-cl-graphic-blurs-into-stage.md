---
id: cin-cl-graphic-blurs-into-stage
kind: technique
summary: "When a graphic build hands off to a title: the crisp bars or stripes soften and widen into the backdrop, no cut."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting]
tools: [add_motion_block_tool, duplicate_clips_tool, add_effect_tool, set_keyframes_tool, add_kinetic_title_tool, apply_look_preset_tool]
pace: calm
mood: [dreamy, seamless, atmospheric]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-living-stage, cin-cl-one-hue-light-ramp, shot-line-carry-transition]
avoid_with: [cin-cl-mono-one-accent]
needs: []
drawn: cinetic
---

# Graphic softens into the stage

cinetic `cl-graphic-blurs-into-stage` · Colour and light · accent · energy calm · formats launch, sting, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A crisp graphic that has just finished its move, such as a wall of bars or a stripe field, loses its edges, widens and keeps drifting until it has become the soft backdrop for the next title, with no cut.

Use when: After a graphic build (a bar wall, a stripe or tile field, a filled pattern), when the next beat is a title or the end-card mark and needs a backdrop born from what was just on screen.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same chart: `add_motion_block_tool {"block": "chart_build", "position_seconds": 0, "duration_seconds": 5, "params": {"kind": "bar", "values": ["30", "55", "80", "100", "70", "45"], "labels": ["A", "B", "C", "D", "E", "F"], "plate": "none", "palette": "<palette>", "accent": "<one non-banned hue>"}}` so the bars stay in one hue against the stage (chart_build takes no per-bar colours; never a periwinkle-pink-orange spectrum).
2. Keep the blurred-copy crossfade (72 f = 1.2 s), the widen (1 to 1.5x) and the title at 3.6 s from the full build, then lay a slow single-hue `gradient_field` (`style: "aurora"`, `speed: 0.15`) under the title so the softened field becomes a one-hue living stage.

**Full look** (relies on gradient, orange, purple: only when the person's brand supplies that look):

1. The graphic, built to its end state: `add_motion_block_tool {"block": "chart_build", "position_seconds": 0, "duration_seconds": 5, "params": {"kind": "bar", "values": ["30", "55", "80", "100", "70", "45"], "labels": ["A", "B", "C", "D", "E", "F"], "plate": "none"}}`.
2. Soften it without stepping the blur: `duplicate_clips_tool {"timeline_clip_ids": ["<chart>"], "to_track": "<above>"}`, then `add_effect_tool {"timeline_clip_id": "<copy>", "effect": "Blur"}` at about 48 px at 1080p, and crossfade over 72 f (1.2 s): `set_keyframes_tool {"timeline_clip_id": "<copy>", "property": "alpha", "points": [{"seconds": 3.0, "value": 0}, {"seconds": 4.2, "value": 1, "ease": "ease_in_out_sine"}]}`.
3. On the same span widen and lower contrast: `set_keyframes_tool {"timeline_clip_id": "<copy>", "property": "scale_x", "points": [{"seconds": 3.0, "value": 1}, {"seconds": 4.2, "value": 1.5, "ease": "ease_in_out_sine"}]}` and fade the sharp original to 0.75 alpha on the same curve (25 % toward the stage).
4. Next foreground enters at frame 36 of the soften (0.6 s in, 3.6 s): `add_kinetic_title_tool {"text": "Everything in one place", "style": "editorial", "animation": "rise", "position_seconds": 3.6, "duration_seconds": 2.5}`.
5. If it bands, add `apply_look_preset_tool {"look": "film_grain_35mm_fine", "scope": "all"}`.

Fallback: Per-bar drift (each element sliding its gradient at its own speed) is not available, so the softened field holds still; put a slow `gradient_field` aurora behind the title in the soft hue to restore the motion (the living stage).

## Timing & taste rules

- cinetic's timing (60 fps): The soften takes 72 f (1.20 s) on ease_in_out_sine (RackFocus t from 0 to 1, blur 48 px at 1080p). The widen from 1 to 1.5 and the 25% contrast drop run on the same curve. Each element's gradient drifts at 0.3-0.8% per frame on linear and keeps drifting for 60-120 f (2.00 s) under the next element. The next foreground enters from frame 36.
- Soften 72 f (1.2 s, ease_in_out_sine); crossfade of a sharp and a constant-blur copy, blur about 48 px at 1080p.
- Widen 1 to 1.5x and mix the field 25 % toward the stage colour on the same curve.
- Bring the next foreground in from frame 36 (0.6 s), when the stripes no longer read as objects.
- Fill the bars with a vertical gradient between two adjacent steps of the film's one-hue ramp; keep drift at 0.3-0.8 % per frame for 60-120 f under the next element.
- In full colour the field shifts through several hues as it softens.

## Sound for it

None, or a soft `tail_bloom` (-20 dB) at the start of the soften.

## Common mistakes

- The graphic still carries data the viewer needs to read.
- A UI act where the stage should stay flat.
- Animating a blur filter directly; it steps.
- Avoid when: The graphic carries data the viewer still needs to read, or it is a UI act where the stage should stay flat. When no graphic build comes before the title, use cl-living-stage directly.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-graphic-blurs-into-stage`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
