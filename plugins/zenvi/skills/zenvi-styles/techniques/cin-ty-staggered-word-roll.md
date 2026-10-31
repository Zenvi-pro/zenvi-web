---
id: cin-ty-staggered-word-roll
kind: technique
summary: "When one claim must turn into the next in place: words roll up and away one by one as replacements rise in from below."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [fluid, editorial]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-le-bookend-replay, cin-ty-reading-order-exit]
avoid_with: [cin-ty-blur-swap-rescale]
needs: []
drawn: cinetic
---

# Staggered word roll

cinetic `ty-staggered-word-roll` · Typography in motion · workhorse · energy medium · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The words of a phrase roll up and away one after another while their replacements rise in from below, so one sentence mutates instead of cutting.

Use when: Swapping one claim for the next in place; a URL replacing a tagline; a category word turning into the product name; a closing bookend that rolls the opening phrase into the brand line.

## Build it in Zenvi

1. Old line: `add_kinetic_title_tool {"text": "Made for makers", "style": "editorial", "animation": "fade", "stagger_seconds": 0, "position_seconds": 0.5, "duration_seconds": 2.5}`.
2. Keep the shared word still (here "Made for") by making the changing word its own title: `add_kinetic_title_tool {"text": "makers", ...}` and `add_kinetic_title_tool {"text": "everyone", "position_seconds": 2.07, "duration_seconds": 2.5, "animation": "rise"}`, same y and size.
3. Old word out (12 f, 0.2 s): `set_keyframes_tool {"timeline_clip_id": "<old>", "property": "location_y", "ease": "ease_in_cubic", "points": [{"seconds": 2.0, "value": 0}, {"seconds": 2.2, "value": -0.02}]}` plus `alpha` 1 to 0 over the same 0.2 s.
4. New word in (24 f, 0.4 s) starting 4 f (0.07 s) after the old one starts leaving: `location_y` from 0.025 to 0 `ease_out_expo`, `alpha` 0 to 1 over 0.17 s.
5. For several words, repeat per slot with a 10 f (0.17 s) offset between slots.
6. `add_sfx_tool {"recipe": "swish_airy", "at_seconds": 2.0, "gain_db": -18}`.

## Timing & taste rules

- cinetic's timing (60 fps): Out 12 f (0.20 s) ease_in_cubic, 0.2 em up; in 24 f (0.40 s) ease_out_expo from +0.25 em (peak about 7 px/f at 120 px type), 4 f (0.07 s) overlap; stagger 6-11 f (0.18 s) per word; a phrase swap takes about 50 f (0.83 s); a whole-line conveyor variant leaves exactly 1 empty frame between the lines.
- Out 12 f (0.2 s) ease_in_cubic, 0.2 em up, fade on a smooth curve (not ease-in, which pops), blur up to 6 px.
- In 24 f (0.4 s) ease_out_expo from +0.25 em, opacity over 10 f (0.17 s), blur 8 px to clear.
- Slot stagger 6-11 f (0.1-0.18 s); a whole phrase swap takes about 50 f (0.83 s).
- Always roll in the same direction; the shared word or icon stays perfectly still.

## Sound for it

One airy swish at the start of the swap, -18 dB; no sound per word.

## Common mistakes

- Swaps where nothing persists: a cut or a blur-swap reads cleaner.
- More than two rolls in a row without a different move between them.
- Rolling some words up and others down: direction must stay constant.
- Avoid when: Swaps where nothing persists (a cut or ty-blur-swap-rescale reads cleaner); more than two rolls in a row without a different move between them.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ty-staggered-word-roll`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
