---
id: cin-dn-flag-then-select
kind: technique
summary: "When many are narrowed to one: status marks appear on cards one by one, then a single card turns accent."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [deliberate, focused]
aspect: ["16:9", "1:1", "4:5"]
pairs_with: [shot-control-state-change, kcut-hit-fx]
avoid_with: [shot-bento-light-up]
needs: []
drawn: cinetic
---

# Flag cascade, then one chosen

cinetic `dn-flag-then-select` · Data and numbers · workhorse · energy calm · formats feature, walkthrough, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Status marks appear on a set of cards one after another, then a single card switches to the accent state: many flagged, one picked.

Use when: Triage, review, matching, anomaly detection: anything that narrows many down to one.

## Build it in Zenvi

1. `add_motion_block_tool {"block": "data_table", "position_seconds": 1.0, "duration_seconds": 6.0, "placement": "full_frame", "params": {"title": "Review queue", "columns": ["Item", "Status"], "rows": ["Invoice 204 | In review", "Invoice 205 | In review", "Invoice 206 | Blocked", "Invoice 207 | In review"], "highlight": 2, "plate": "glass"}}`.
2. The table's rows slide up in turn, status chips pop in (6 f, 0.1 s apart), neutral for every flag so the accent can mean chosen.
3. About 28 f (0.47 s) after the first flag, `highlight` takes the chosen row: border to accent, tint and filled dot over 8 f (0.13 s).
4. Slow 2 % push toward the chosen row: `set_keyframes_tool {"timeline_clip_id": "<table>", "property": "scale_x", "ease": "ease_in_out_sine", "points": [{"seconds": 3.0, "value": 1.0}, {"seconds": 3.8, "value": 1.02}]}` (same on `scale_y`).
5. `add_sfx_tool {"recipe": "pop", "at_seconds": 1.2, "gain_db": -24}` on the first flag and `{"recipe": "ui_tap", "at_seconds": 1.67, "gain_db": -14}` on the pick.

Fallback: If the table block is not the right shape for your cards, use glass_cards with `click` set to the chosen card.

## Timing & taste rules

- cinetic's timing (60 fps): Flags 6 f (0.10 s) apart, 6 f (0.10 s) each. Selection ~28 f (0.47 s) after the first flag, an 8 f (0.13 s) change. Hold at most 48 f (0.80 s) with a 2% push. The chosen card exits on ease_in_cubic.
- Flags 6 f (0.1 s) apart, 6 f each; flags stay neutral grey.
- Selection about 28 f (0.47 s) after the first flag, an 8 f (0.13 s) change with a 2 % pop.
- Hold at most 48 f (0.8 s) with a 2 % push; the chosen card leaves first, ease_in_cubic, into the cut.
- No more than about 12 cards.

## Sound for it

A very quiet pop on the flags; one ui_tap on the pick frame.

## Common mistakes

- A pick that is not what the product actually outputs.
- Grids of more than about 12 cards, where the cascade reads as a queue.
- Colouring the flags: the accent must belong to the chosen one.
- Avoid when: The pick isn't what the product actually outputs; grids of more than ~12 cards, where the cascade reads as a queue.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`dn-flag-then-select`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
