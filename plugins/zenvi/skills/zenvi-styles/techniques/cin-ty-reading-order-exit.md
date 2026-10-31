---
id: cin-ty-reading-order-exit
kind: technique
summary: "When one word must be left alone on screen: the others lift and vanish one by one in reading order before the next move."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, set_keyframes_tool]
pace: medium
mood: [clean, focused]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-ty-blur-swap-rescale, shot-title-demote-to-label]
avoid_with: [kinetic-word-pop]
needs: []
drawn: cinetic
---

# Reading-order word exit

cinetic `ty-reading-order-exit` · Typography in motion · workhorse · energy any · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Words leave one by one in reading order, each lifting a few pixels and vanishing, until only the hero element is left on screen.

Use when: Isolating a hero word or object before a match cut or zoom; clearing a statement gently before a calmer UI moment; mirroring a word-by-word entry.

## Build it in Zenvi

1. Build the line as separate titles so each word can leave on its own: `add_kinetic_title_tool {"text": "Everything you need", "style": "editorial", "animation": "fade", "stagger_seconds": 0, "emphasis": "none", "position_seconds": 0.5, "duration_seconds": 3.0}` for the leaving words and `add_kinetic_title_tool {"text": "Everything", "style": "editorial", ...}` style the hero word as its own clip at the same position.
2. For each leaving word i, exit at o_i = out + 4i f (0.067 s): `set_keyframes_tool {"timeline_clip_id": "<word_i>", "property": "location_y", "ease": "ease_in_cubic", "points": [{"seconds": <o_i>, "value": 0}, {"seconds": <o_i + 0.167>, "value": -0.012}]}` (0.12 em, about 14 px) and `alpha` 1 to 0 over the same 10 f.
3. The hero stays put; start the next move (zoom, match cut, `apply_motion_transition_tool`) within 6 f (0.1 s) of the last word clearing.
4. Calm loosen variant: each word drifts apart by 10-20 px (0.01-0.02) with a 2 degree `rotation`, 20 f (0.33 s) `ease_in_out_sine`, 6 f apart.

## Timing & taste rules

- cinetic's timing (60 fps): Per word 10 f (0.17 s), lift 0.12 em (about 14 px), stagger 4 f (2-6), a 5-word line clears in about 26 f (0.43 s); loosen variant 20 f (0.33 s) per word, 6 f (0.10 s) apart, about 32-44 f (0.73 s) in all.
- Per word 10 f (0.17 s), lift 0.12 em, stagger 4 f (0.07 s, range 2-6); a five-word line clears in about 26 f (0.43 s).
- Fade with a smooth curve over the same 10 f, never with an ease-in on the opacity.
- Loosen variant: 20 f (0.33 s) per word, 6 f apart, 32-44 f (0.5-0.7 s) in all.
- Before a camera move, finish the exit 0-56 f (up to 0.9 s) ahead of it or fade the whole caption at once over 26 f.

## Sound for it

None; the exit is a clearing gesture, any sound belongs to the next move.

## Common mistakes

- Walkthrough captions right before a camera move: fade the whole caption at once instead.
- Hurrying the exit of a payoff line.
- Fading on an ease-in curve so words pop out.
- Avoid when: Walkthrough captions just before a camera move: fade the whole caption at once over 26 f on ease_in_out_sine and finish 0-56 f before the move starts; exits that would hurry a payoff line.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ty-reading-order-exit`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
