---
id: cin-ty-oversize-blur-slide-in
kind: technique
summary: "When the type act peaks: a huge two-word claim streaks in from beside the frame and brakes until the words lock."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_type_block_tool, set_keyframes_tool, apply_fx_tool, add_sfx_tool]
pace: fast
mood: [bold, sweeping]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-ty-blur-swap-rescale, kcut-hit-fx]
avoid_with: [cin-ty-inplace-light-up-beats, shot-blur-slide]
needs: []
drawn: cinetic
---

# Oversize word slide-in

cinetic `ty-oversize-blur-slide-in` · Typography in motion · signature · energy high · formats launch, sting, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A huge word arrives streaked from beside the frame and brakes on a long tail, and a trailing word follows from further out and closes the gap so the phrase locks together.

Use when: The energy peak of a type act; a two-word claim; a cold open whose first frame already moves.

## Build it in Zenvi

1. Each word its own big clip: `add_type_block_tool {"block": "wheel", "text": "SHIP", "words": ["SHIP"], "font_family": "anton", "text_size": 0.23, "x": 0.35, "y": 0.5, "position_seconds": 1.0, "duration_seconds": 3.0}` and `{"text": "FASTER", "x": 0.66, "position_seconds": 1.267, ...}` (21-25 % of frame height, 16 f later).
2. Word 1: `set_keyframes_tool {"timeline_clip_id": "<w1>", "property": "location_x", "ease": "ease_out_expo", "points": [{"seconds": 1.0, "value": 0.4}, {"seconds": 2.5, "value": 0}]}` (0.4 of width, 90 f braking tail) and `alpha` 0.2 to 1 over 0.27 s (16 f).
3. Word 2: same curve from 0.6 of width, starting 0.267 s later, `alpha` 0.2 to 1 over 1.13 s; the gap shrinks from 1.7x to 1x over about 1.3 s.
4. Streak the first frames: `apply_fx_tool {"clip_id": "<w1>", "effects": [{"effect": "directional_blur", "amount": 0.9, "start": 0, "end": 0.25}]}`; same for word 2.
5. `add_sfx_tool {"recipe": "whoosh_long", "at_seconds": 1.0, "gain_db": -12}`.

Fallback: The wheel block is a stand-in for a single big word; a one-word add_kinetic_title_tool with animation slam also works, then keyframe its location_x as above.

## Timing & taste rules

- cinetic's timing (60 fps): Brake 90 f (1.50 s) ease_out_expo (feels like a 33 f (0.55 s) time constant); word 1 offset 0.4W (768 px), word 2 0.6W from +16 f (0.27 s); drift 0.5 px/f; opacity from 0.2, readable below 20 px/f from frame 16 (word 2 from frame 21); gap 1.7x -> 1x over 80 f (1.33 s).
- Type height 21-25 % of the frame; word 1 brakes over 90 f (1.5 s) ease_out_expo from 0.4 of width, with a slow drift that never stops (0.5 px/f).
- Word 2 starts 16 f (0.27 s) later from 0.6 of width on the same curve; the gap closes from 1.7x to 1x over about 80 f (1.33 s).
- Opacity starts at 0.2 and is full once speed falls below 20 px/f, about f16 (0.27 s); frame 1 runs about 52 px/f so it must be streaked.
- Two words only.

## Sound for it

One whoosh_long at the first frame, -12 dB; a tiny hit_transient at -18 dB when the gap closes, if on a beat.

## Common mistakes

- Long phrases or small type: the braking tail loses its drama.
- Screen direction that must run the opposite way across the cut.
- Fully opaque words on frame 1: they must travel faded.
- Avoid when: Long phrases; when screen direction must run the other way across the cut; small type.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ty-oversize-blur-slide-in`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
