---
id: cin-tr-conveyor-line-swap
kind: technique
summary: "When claims come one after another: each line floats up and fades, the next rises into the same spot."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [rhythmic, clean, editorial]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-mask-reveal, shot-blur-slide, t062]
avoid_with: [kinetic-word-pop, cin-tr-select-retype-swap]
needs: []
drawn: cinetic
---

# Conveyor line swap

cinetic `tr-conveyor-line-swap` · Transition · workhorse · energy medium · formats launch, feature, vertical, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The current line floats up and fades, the stage is empty for an instant, and the next line rises from below into the same spot, so a run of statements reads as one upward feed.

Use when: Sequences of short claims, lists of capabilities, a subject that changes while the predicate stays.

## Build it in Zenvi

1. Line A: `add_kinetic_title_tool {"text": "Built for teams", "position_seconds": 0, "duration_seconds": 1.5, "style": "documentary", "animation": "fade"}`. Exit: `set_keyframes_tool {"timeline_clip_id": "<A>", "property": "location_y", "mode": "replace", "points": [{"seconds": 1.0, "value": 0}, {"seconds": 1.5, "value": -0.125, "ease": "ease_in_cubic"}]}` (135 px at 1080p over 30 f / 0.5 s) and `alpha` `[{"seconds": 1.37, "value": 1}, {"seconds": 1.5, "value": 0}]` (fade over the last 8 f / 0.13 s).
2. Leave 2 empty frames (0.03 s), then line B at the same spot: `add_kinetic_title_tool {"text": "Ships in hours", "position_seconds": 1.53, "duration_seconds": 1.5, "style": "documentary", "animation": "rise"}` with `location_y` `[{"seconds": 1.53, "value": 0.174}, {"seconds": 2.03, "value": 0, "ease": "ease_out_expo"}]` (+188 px to 0 over 30 f / 0.5 s) and `alpha` 0 to 1 over the first 10 f (0.17 s), so it flies faded while faster than 20 px/f; colour from muted to ink over 16 f (0.27 s).
3. Repeat for each claim; keep the direction up for the whole run.
4. Word-by-word version: `add_kinetic_title_tool {"text": "...", "animation": "rise", "stagger_seconds": 0.06}` for the arrivals with a 3-4 f (0.05-0.07 s) stagger and a matching exit so each old word rises away as its replacement rises in.
5. One soft `add_sfx_tool {"recipe": "swish_airy", "at_seconds": 1.53, "gain_db": -20}` per bar at most.

## Timing & taste rules

- cinetic's timing (60 fps): Exit: 30 f (0.50 s) on ease_in_cubic (last frame about 26 px/f, while fading). Gap 2 f (0.03 s). Entry: 30 f (0.50 s) on ease_out_expo (first frame about 37 px/f, while faded); colour over 16 f (0.27 s). Per-word stagger 3-4 f (0.07 s). One line per bar or half bar.
- Exit: 30 f (0.5 s) on ease_in_cubic, last frame ~26 px/f, fading over its last 8 f (0.13 s) and blurring out.
- Gap 2 f (0.03 s).
- Entry: 30 f (0.5 s) on ease_out_expo, first frame ~37 px/f while faded; colour in 16 f (0.27 s).
- Per-word stagger 3-4 f (0.05-0.07 s).
- One line per bar or half bar; keep one direction (up) for the run.

## Sound for it

Optional airy swish at -20 dB, at most one per line; none is fine.

## Common mistakes

- Lines of very different length or alignment (the eye loses the slot), or more than 4-5 lines in a row without another seam type (avoid_when).
- Reversing direction mid-run.
- Overlapping A and B: the 2-frame gap is what makes the empty stage.
- Avoid when: Lines of very different length or alignment (the eye loses the slot), or more than 4-5 lines in a row without another seam type.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tr-conveyor-line-swap`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
