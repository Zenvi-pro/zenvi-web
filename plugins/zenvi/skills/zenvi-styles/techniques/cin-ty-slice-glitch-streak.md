---
id: cin-ty-slice-glitch-streak
kind: technique
summary: "When a speed claim needs a hit: a word jolts into sliced bands for two frames, stretches to a capsule and races off."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, apply_fx_tool, set_keyframes_tool, add_type_block_tool, add_sfx_tool]
pace: fast
mood: [fast, glitchy]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kcut-hit-fx, shot-glitch-tear-cut]
avoid_with: [cin-ty-slice-band-assembly, kinetic-scramble-decode]
needs: [per-band-slice-displace]
drawn: cinetic
---

# Slice glitch into a speed streak

cinetic `ty-slice-glitch-streak` · Typography in motion · accent · energy high · formats launch, sting, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A word jolts into sideways-displaced horizontal slices for two frames, then stretches into a solid capsule that races off as a streak, and the next word lands in its wake.

Use when: A speed or performance claim, where the word itself turns into motion. Handing a name off to a thread, packet or line that carries into the next scene. The 2 f slice alone on 'private', 'encrypted' or 'blocked'.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Slice as above but only in the film's own two tones (no purple tint): `apply_fx_tool {"clip_id": "<title>", "effects": [{"effect": "glitch", "amount": 0.9, "start": 2.0, "end": 2.033}]}`, no chromatic_aberration.
2. Capsule in flat ink or white (`write_on` with `"fill": true`), no bloom or glow on the type or the streak, the tail keeps the capsule's one tone via `directional_blur` scaled to speed (tail up to 240 px). Then the next word as in the full build.

**Full look** (relies on glow, purple: only when the person's brand supplies that look):

1. `add_kinetic_title_tool {"text": "Faster", "style": "stack", "animation": "slam", "text_size": 0.2, "position_seconds": 2.0, "duration_seconds": 0.5}`; slice it for 2 f only: `apply_fx_tool {"clip_id": "<title>", "effects": [{"effect": "glitch", "amount": 0.9, "start": 2.0, "end": 2.033}, {"effect": "chromatic_aberration", "amount": 0.4, "start": 2.0, "end": 2.033}]}`.
2. Smear from 2.033 s: `set_keyframes_tool {"timeline_clip_id": "<title>", "property": "scale_x", "ease": "ease_in_cubic", "points": [{"seconds": 2.033, "value": 1.0}, {"seconds": 2.333, "value": 1.8}]}` and `alpha` 1 to 0 over the last 0.17 s, with `apply_fx_tool` directional_blur amount 0.9 on that window.
3. Capsule: `add_type_block_tool {"block": "write_on", "paths": ["M10 50 a40 40 0 0 1 40 -40 h300 a40 40 0 0 1 0 80 h-300 a40 40 0 0 1 -40 -40z"], "fill": true, "ink": "#ffffff", "width": 0.28, "position_seconds": 2.17, "duration_seconds": 0.5}` fading in over 0.17 s, its height shrinking to 0.35 with `scale_y`.
4. Streak: `location_x` from 0 to 1.2 over 0.27 s `ease_in_cubic`. Next word enters in its wake: `add_kinetic_title_tool {"text": "than ever", "animation": "slide_up", ...}` at 2.4 s, `location_x` -0.167 to 0 over 0.4 s `ease_out_expo`, `alpha` over 0.13 s.
5. `add_sfx_tool {"recipe": "glitch_burst", "at_seconds": 2.0, "gain_db": -10}` and `{"recipe": "whoosh_fall", "at_seconds": 2.4, "gain_db": -12}`.

Fallback: Per-band slice displacement is not native: the glitch FX stands in for the 2 f of slices; keep it exactly 2 f.

## Timing & taste rules

- cinetic's timing (60 fps): Slice: 2 f (0.03 s) via fd, clean on frame 3. Smear: 18 f (0.30 s) on ease_in_cubic, scaleX 1 -> 1.8; for a word up to 450 px wide the right edge ends near 70 px/f. Text-to-capsule crossfade over the last 10 f (0.17 s). The streak cruises at that speed and clears a 1920 frame in about 15 f (0.25 s), with a tail of at most 240 px. Next word: 320 px over 24 f (0.40 s) on ease_out_cubic from e + 4 (58 px/f on frame 1, under 20 px/f from frame 7), opacity over 8 f (0.13 s). Hold it at least 54 f (0.90 s).
- Slice 2 f (0.033 s), clean on frame 3; smear 18 f (0.3 s) scaleX 1 to 1.8, right edge reaching about 70 px/f (words up to 450 px wide).
- Text to capsule crossfade over the last 10 f (0.17 s); capsule height from cap height to 0.35 of it.
- Streak clears a 1920 frame in about 15 f (0.25 s), tail at most 240 px.
- Next word 320 px over 24 f (0.4 s) ease_out_expo from 4 f after the streak starts, readable under 20 px/f from f7.

## Sound for it

glitch_burst on the slice frames, a falling whoosh as the capsule leaves; nothing under the next word.

## Common mistakes

- Calm films or more than one per film.
- Words wider than about 450 px at the smear, where the edge passes 80 px/f.
- Coloured fringes or a tint shift along the trail.
- Avoid when: Calm films. More than once per film. Words wider than about 450 px at the smear, where the edge would pass 80 px/f. Long lines. Coloured fringes or a tint shift along the trail.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ty-slice-glitch-streak`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
