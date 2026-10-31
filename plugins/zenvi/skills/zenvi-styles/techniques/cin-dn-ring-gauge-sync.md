---
id: cin-dn-ring-gauge-sync
kind: technique
summary: "When a percentage or score is the claim: a ring sweeps to its value while the centre number counts on the same progress."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [clean, measured]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kinetic-counter, cin-dn-tucked-unit-label]
avoid_with: [cin-dn-unit-grid-tally]
needs: []
drawn: cinetic
---

# Ring gauge filling with its centre number

cinetic `dn-ring-gauge-sync` · Data and numbers · workhorse · energy calm · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A circular gauge sweeps to its value while the number at its centre counts on the same progress, and the ring's end cap leads the eye around.

Use when: Percentages, scores, completion and utilisation; status pills and KPI tiles.

## Build it in Zenvi

1. `add_motion_block_tool {"block": "chart_build", "position_seconds": 1.0, "duration_seconds": 4.0, "placement": "full_frame", "params": {"kind": "donut", "title": "Task completion", "values": ["72", "28"], "labels": ["Done", "Open"], "highlight": 0, "suffix": "%", "decimals": 0, "plate": "none"}}`: the donut sweeps round and the centre number counts on the same progress.
2. Fill time N = max(48, 0.48 x radius x target) frames: 48 f (0.8 s) covers a 160 px ring up to 63 %, a full 160 px ring needs 77 f (1.28 s), so set `duration_seconds` to at least N/60 + 1.5 s hold.
3. For nested rings, one block per ring: `add_motion_block_tool {"block": "chart_build", ... "position_seconds": 1.1}` 6 f (0.1 s) apart, at most 3 rings, the group landing within 30 f (0.5 s).
4. Accent relaxes to the ink tone over 20 f (0.33 s) after landing: set `"rest"` to the ink tone and keep `highlight` on the arc.
5. `add_sfx_tool {"recipe": "tail_bloom", "at_seconds": 1.0, "gain_db": -22}`.

## Timing & taste rules

- cinetic's timing (60 fps): Fill over N = max(48, 0.48 x radius x target) f on ease_out_cubic (48 f (0.80 s) for most gauges, 77 f (1.28 s) for a full 160 px ring). Centre count on the same progress. Accent relaxes over 20 f (0.33 s) after landing. Nested rings 6 f (0.10 s) apart.
- Fill N = max(48, 0.48 x radius x target) f (0.8 s minimum) with a soft ease-out so the end cap stays at or under 60 px/f.
- Centre figure rounded to whole numbers in tabular digits with a tucked % at 0.4x size.
- Arc arrives in the accent and relaxes to ink over 20 f (0.33 s); nested rings 6 f (0.1 s) apart.
- No more than 3 concentric rings.

## Sound for it

A soft tail_bloom as the ring starts, -22 dB; none on the landing.

## Common mistakes

- Values that are not parts of a whole.
- More than 3 concentric rings.
- Fills so short that the end cap exceeds 60 px/f.
- Avoid when: Values that aren't parts of a whole; more than 3 concentric rings.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`dn-ring-gauge-sync`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
