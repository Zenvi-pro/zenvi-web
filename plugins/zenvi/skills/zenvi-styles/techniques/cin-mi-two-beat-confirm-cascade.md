---
id: cin-mi-two-beat-confirm-cascade
kind: technique
summary: "When several switches turn on, each confirms in two beats, label or knob first, fill a beat later, at uneven gaps."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [deliberate, human, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-mi-spinner-to-check, cin-pd-single-control-hero, shot-control-state-change]
avoid_with: [kinetic-beat-strobe, cin-ui-clutter-pileup-strip]
needs: []
drawn: cinetic
---

# Two-beat confirm cascade

cinetic `mi-two-beat-confirm-cascade` · Micro-interaction · workhorse · energy calm · formats feature, walkthrough, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A row of buttons or toggles confirms one by one: the label or knob changes first, the fill follows a beat later, and the rows go at uneven, human gaps.

Use when: Several integrations, permissions or capabilities switch on, and each confirmation must stay legible at video speed.

## Build it in Zenvi

1. Fast version: `add_motion_block_tool {"block": "toggle_panel", "params": {"title": "<panel>", "rows": ["<a>", "<b>", "<c>", "<d>"], "done": "All set", "cursor": true}, "position_seconds": 0.0, "duration_seconds": 8.0}` (a pointer turns each switch on in turn, the count ticks up).
2. To control the gaps, build rows as clips with irregular starts, never a metronome: four toggles at frames 0 / 4 / 19 / 37 (0 / 0.07 / 0.32 / 0.62 s); two buttons at 0 / 10 (0 / 0.17 s).
3. Toggle: knob `location_x` 0 to +20 px (0.01 of width) over 8 f (0.13 s) on `ease_out_expo` with no overshoot, and the track clip fades from the line colour to the accent over 10 f (0.17 s) `ease_in_out_sine` from the same frame: `set_keyframes_tool {"timeline_clip_id": "<knob>", "property": "location_x", "points": [{"seconds": <t0>, "value": 0}, {"seconds": <t0+0.13>, "value": 0.01, "ease": "ease_out_expo"}]}` and `alpha` of an accent track clip 0 to 1.
4. Button: swap the label at t0 with a 4 f (0.07 s) crossfade or a 6 f (0.1 s) roll (old label rises 8 px and leaves, new enters from 8 px below); then the background goes from ink to accent over 8 f (0.13 s) starting at t0 + 12 f (0.2 s).
5. `add_sfx_tool {"recipe": "toggle", "at_seconds": <t0>, "gain_db": -24, "pan": <x - 0.5>}` per state change (light, weight about 0.3, panned by x).

## Timing & taste rules

- cinetic's timing (60 fps): Label 4-6 f (0.10 s); fill 8 f (0.13 s) ease_out_expo at +12 f (0.20 s). Knob 8 f (0.13 s) ease_out_expo; track 10 f (0.17 s) ease_in_out_sine. Row gaps such as 4, 15 and 18 f (0.30 s).
- Irregular starts [0, 4, 19, 37] f (0 / 0.07 / 0.32 / 0.62 s) for four toggles, [0, 10] f for two buttons; gaps like 4, 15 and 18 f.
- Label 4-6 f (0.07-0.1 s); fill 8 f (0.13 s) on ease_out_expo at +12 f (0.2 s).
- Knob 8 f (0.13 s), no overshoot; track 10 f (0.17 s) on ease_in_out_sine.
- Keep to four rows or fewer per shot.

## Sound for it

A light toggle click at -24 dB on each state change, panned by the row position; no sound on the fills.

## Common mistakes

- Only one control: use a press envelope instead.
- Every row starting at the same interval: it reads as a loop, not a person.
- Overshoot on the knob: it turns a confirm into a bounce.
- Avoid when: There is only one control (use the press envelope), or every row would start at the same interval.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`mi-two-beat-confirm-cascade`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
