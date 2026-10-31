---
id: cin-ty-kinetic-word-slams
kind: technique
summary: "When a punchy 3-5 word line needs a strong beat: one huge word at a time hits blurred, settles, then is sucked away."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-logo-sting]
tools: [add_type_block_tool, apply_fx_tool, add_sfx_tool]
pace: fast
mood: [punchy, rhythmic]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kcut-hit-fx, kinetic-keyword-slam]
avoid_with: [shot-blur-slide, cin-ty-inplace-light-up-beats]
needs: []
drawn: cinetic
---

# One-word slam sequence

cinetic `ty-kinetic-word-slams` · Typography in motion · signature · energy high · formats launch, sting, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A line is read one huge word at a time: each word hits oversized and blurred, settles, then is sucked away as the next word cuts in.

Use when: A punchy 3-5 word line on a strong beat; a problem statement or rhythmic claim; vertical formats where one word fills the screen.

## Build it in Zenvi

1. `add_type_block_tool {"block": "strobe", "text": "NO MORE GUESSING", "words": ["NO", "MORE", "GUESSING"], "hold_frames": 36, "lockup": "", "ground": "#101010", "ink": "#ffffff", "accent": "#ff3b1f", "position_seconds": 1.0}` for the card-per-word cut (36 f, 0.6 s per word; pass `beats` instead of hold_frames when the music has a grid).
2. Entry of each word: on the strobe clip use `set_keyframes_tool {"timeline_clip_id": "<card_i>", "property": "scale_x", "ease": "ease_out_expo", "points": [{"seconds": <cue_i>, "value": 1.35}, {"seconds": <cue_i + 0.37>, "value": 1.0}, {"seconds": <cue_i + 0.47>, "value": 1.01}]}` (same on `scale_y`) and `alpha` 0 to 1 over 0.05 s.
3. Exit: last 14 f (0.23 s) `scale` 1.0 to 0.6 `ease_in_cubic`, `alpha` to 0, then a hard cut to the next word.
4. `apply_fx_tool {"clip_id": "<card_i>", "effects": [{"effect": "directional_blur", "amount": 0.7, "start": 0, "end": 0.07}]}` for the streak on the first frames only.
5. `add_sfx_tool {"recipe": "impact_punch", "at_seconds": <cue_i>, "gain_db": -8}` per word, plus `whoosh_short` at -16 dB on the exit.

Fallback: If the strobe cards flip grounds too fast, set allow_strobe false (default); the words keep cutting on a held ground.

## Timing & taste rules

- cinetic's timing (60 fps): Entry 22 f (0.37 s) ease_out_cubic from 1.35x (the edges of a 1120 px word start at about 43 px/f, faded and blurred, and are near 22 px/f by frame 4 when the blur clears), blur 12 -> 0 by about frame 4, drift 6 f (0.10 s), exit 14 f (0.23 s) ease_in_cubic to 0.6x (last frame about 72 px/f, nearly transparent); 36-42 f (0.70 s) per word (0.6-0.7 s), last word held at least 54 f (0.90 s) under a 1-2% scale creep; every hit on a beat.
- Entry 22 f (0.37 s) ease_out_expo from 1.35x, never above 1.35x: a bigger start leaves outer letters of a frame-wide word above 20 px/f after the blur clears.
- Blur 12 px to 0 by about f4 (0.07 s); opacity 0 to 1 over 3 f; then a 6 f drift of 1 %.
- Exit 14 f (0.23 s) ease_in_cubic to 0.6x; every cut on a beat.
- 36-42 f (0.6-0.7 s) per word; words fitted to about 77 % of frame width; last word held at least 54 f (0.9 s) with a 1-2 % creep.

## Sound for it

impact_punch at -8 dB on the frame each word lands, a short whoosh at -16 dB on each exit; the cut itself has none.

## Common mistakes

- More than one sequence per film or lines over 5 words.
- Using it in a calm film.
- A separate card for a lone connector word: fold it into the next word.
- Avoid when: More than one sequence per film; lines over 5 words; calm films; a card for a lone connector word (fold it into the next word).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ty-kinetic-word-slams`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
