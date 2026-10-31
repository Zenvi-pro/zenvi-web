---
id: cin-dn-digit-reel-detent
kind: technique
summary: "When a counter should feel mechanical: each digit rolls in its own column, low columns spinning, high ones stepping."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [tactile, product-like]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [big-number-lockup-and-counter, kinetic-counter]
avoid_with: [cin-dn-count-glyph-swap]
needs: [detent-single-column-overshoot]
drawn: cinetic
---

# Mechanical digit reel

cinetic `dn-digit-reel-detent` · Data and numbers · workhorse · energy medium · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Each digit sits in its own masked column and rolls vertically like an odometer: the low columns spin while the high ones step once, landing column by column.

Use when: Counters with a tactile, product-like feel: totals, balances, counters that step on visible events.

## Build it in Zenvi

1. `add_motion_block_tool {"block": "counter", "position_seconds": 1.0, "duration_seconds": 3.0, "placement": "full_frame", "params": {"values": ["0", "12480"], "style": "odometer", "align": "center", "weight": 700}}` (count over 60 f, 1 s, ease out; fixed column count so the width never moves).
2. For an event counter: one counter with `values` stepping at each cause (e.g. `"values": ["0","1","2","3"]`) and place it so each step lands on the cause frame, each column roll 6-8 f (0.1-0.13 s).
3. Ticks on the steps: `add_sfx_tool {"recipe": "keyboard_key", "at_seconds": 1.1, "gain_db": -24}` then every 2-3 f (0.03-0.05 s) while dense, and tick each of the last three steps.
4. The single column that matters (a badge 9 to 10) clicks home with one small overshoot: use a second counter and `set_keyframes_tool` `location_y` with `ease_out_back`, 16 f (0.27 s).

Fallback: The block rolls all columns itself; a hand-built detent strip is only approximated by ease_out_back on a single digit title.

## Timing & taste rules

- cinetic's timing (60 fps): Count 60 f (1.00 s) on ease_out_expo. Column roll 14 f (6-8 f (0.13 s) for event counters). Detent landing ~16 f (0.27 s). Ticks at least 2 f (0.03 s) apart.
- Count 60 f (1 s) ease_out_expo; each column rolls 14 f (0.23 s), event counters 6-8 f (0.1-0.13 s).
- Detent landing about 16 f (0.27 s) with the one small overshoot a detent is allowed.
- Ticks at least 2 f (0.03 s) apart, the last three steps always ticked.
- Keep one counting style per film.

## Sound for it

keyboard_key ticks on step frames, thinned to one per 2-3 f while dense; the final landing gets a slightly louder one.

## Common mistakes

- A film that already counts with plain in-place digits.
- Fewer than 3 changes, where one roll is enough.
- Ticking every frame of a dense spin.
- Avoid when: The film already counts with plain in-place digits (keep one counting style per film); fewer than 3 changes, where one roll is enough.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`dn-digit-reel-detent`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
