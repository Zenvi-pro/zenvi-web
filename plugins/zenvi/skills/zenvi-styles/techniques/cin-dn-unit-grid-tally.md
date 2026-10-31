---
id: cin-dn-unit-grid-tally
kind: technique
summary: "When a share needs to feel tangible: a grid of unit squares fills in a diagonal wave to the total, one cell in accent."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [tangible, tidy]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [t054, kinetic-counter]
avoid_with: [cin-dn-ring-gauge-sync]
needs: []
drawn: cinetic
---

# Unit grid that fills to the count

cinetic `dn-unit-grid-tally` · Data and numbers · accent · energy calm · formats launch, feature, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A grid of small squares, each standing for a fixed number of units, fills in a diagonal wave while a counter beside it reaches the total, and one cell lands in the accent.

Use when: Shares and proportions ('3 in 10 teams'), quotas, capacity; making a large count tangible without a chart.

## Build it in Zenvi

1. `add_motion_block_tool {"block": "pictogram_morph", "position_seconds": 1.0, "duration_seconds": 6.0, "placement": "full_frame", "params": {"groups": ["Teams on it", "Teams not yet"], "unit": 1, "icon": "square", "layouts": ["grid"], "captions": ["3 in 10 teams"], "focus": 0, "keep": 0, "backdrop": false}}`: the squares pop in icon by icon, each standing for a fixed number of units.
2. The counter beside it, computed from filled cells x unit: `add_motion_block_tool {"block": "counter", "position_seconds": 1.0, "duration_seconds": 3.0, "placement": "over_video", "params": {"values": ["0", "30"], "suffix": "%", "style": "count", "align": "left"}}`.
3. The accent cell pulses on the last cell: the block's `focus` icon; if you need an extra beat add a 15 % scale pulse to the clip from 3.0 s, 2 f attack, 8 f decay.
4. 2 % push through the hold: `set_keyframes_tool` `scale_x/y` 1.0 to 1.02.
5. `add_sfx_tool {"recipe": "pop", "at_seconds": 1.0, "gain_db": -24}`.

Fallback: The diagonal wave fill is not an option of the pictogram block; icons pop in a fixed order.

## Timing & taste rules

- cinetic's timing (60 fps): Diagonal wave over 30 f (0.50 s) on stagger with ease_out_expo. Each cell fades over 8 f (0.13 s), with an ease_out_cubic scale. Accent cell pulse: attack 2 f (0.03 s), tau 8 f (0.13 s). Hold at least 36 f (0.60 s) with a 2% push.
- Diagonal wave over 30 f (0.5 s) ease_out_expo; each cell fades over 8 f (0.13 s) with a 0.6 to 1 scale; last cell filled by fraction.
- Cells 14-20 px (0.013-0.019 of height); under 12 px on a phone frame they become noise.
- Accent cell pulses 15 %, 2 f attack, 8 f decay; hold at least 36 f (0.6 s) with a 2 % push.
- The counter and the grid must always agree.

## Sound for it

A single very soft pop at the first cell, none per cell.

## Common mistakes

- Exact values with many significant digits, which a grid cannot show honestly.
- Cells under 12 px on a vertical phone format.
- Counter and grid showing different numbers on any frame.
- Avoid when: Exact values with many significant digits, which the grid can't show honestly; cells under 12 px on vertical phone formats.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`dn-unit-grid-tally`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
