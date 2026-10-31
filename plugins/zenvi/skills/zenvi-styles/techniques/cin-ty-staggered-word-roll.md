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

2026-10-31, `~/zenvi-motion/fleet/artifacts/x2-cinetic/verify/cin-ty-staggered-word-roll.mp4` (1280x720p60, editorial titles over a flat card: Made for makers (0.5-2.2 s, last word clip trimmed) then the last word clip of Made for everyone from 2.067 s; old word location_y 0.4304 to 0.4104 with alpha 1 to 0 over 0.2 s, new word 0.4572 to 0.4322 on ease_out_expo with alpha 0 to 1 over 0.17 s, swish_airy at 2.0 s): the frames 2.00-2.42 s show Made for staying fixed, makers lifting and fading, everyone rising into the same slot; watch judge 2.7/10 (flat stand-in background, generic serif).

Found when rendering it (apply before building):

- Step 2: add_kinetic_title_tool has no x parameter, so a separate title for the changing word lands on top of Made for (every title centres on the frame, all words overlap). Add the whole phrase twice instead (Made for makers 0.5-4.0 s, then Made for everyone at the same position and size), delete the second title's Made and for word clips (a title makes one clip per word, g0w0, g0w1, g0w2, on separate tracks) and keep only the last word clip of each. Shorten the old word (trim_clips_tool, or zenvi trim <clip> --edge right --to 2.2) and split the new word at 2.067 keeping the right side (zenvi split <clip> --at 2.067 --keep right); the split drops the baked entrance, so the keyframes in steps 3-4 do the whole entrance.
- Steps 3-4: set_keyframes_tool points with seconds count from the clip start, not the timeline; for a clip that does not start at 0 use timeline_seconds in each point (seconds 2.0 on a clip starting at 0.5 is refused as outside the clip).
- Steps 3-4: title word clips are gravity Top Left and place themselves with absolute location_x/location_y (here 0.508 / 0.4304 for makers and 0.4953 / 0.4322 for everyone); location_y values of -0.02 / 0.025 / 0 throw the word to the top of the frame. Read the clip first (get_clip_properties_tool) and animate around those: old word 0.4304 to 0.4104, new word 0.4572 to 0.4322, and set the new word location_x to the old word's 0.508 so it starts where makers started. Use mode merge on alpha for the old word to keep its baked fade.

Translated from cinetic's technique library (`ty-staggered-word-roll`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
