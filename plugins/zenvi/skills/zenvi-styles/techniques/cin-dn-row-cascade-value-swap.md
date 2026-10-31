---
id: cin-dn-row-cascade-value-swap
kind: technique
summary: "When a table refreshes on a filter: a thin scan line crosses each row in turn as its values change behind it."
categories: [cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_shape_mask_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [responsive, technical]
aspect: ["16:9", "1:1", "4:5"]
pairs_with: [shot-type-and-filter, shot-control-state-change]
avoid_with: [cin-dn-digit-reel-detent]
needs: [row-staggered-scan-wipe]
drawn: cinetic
---

# Top-to-bottom row refresh

cinetic `dn-row-cascade-value-swap` · Data and numbers · accent · energy medium · formats walkthrough, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

When a filter changes, a thin scan line crosses each table row in turn from top to bottom, and the row's icon, label and values change behind it.

Use when: Tables, activity feeds or leaderboards that refresh on a filter or a new period.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same two tables and wipe, but the scan hairline is one neutral 1.5 px `add_title_tool` line per row (use the accent only on the row the story is about).
2. No rainbow-tinted streak and no glow: skip any `apply_fx_tool` bloom on the wipe edge.

**Full look** (relies on glow, gradient: only when the person's brand supplies that look):

1. Old table: `add_motion_block_tool {"block": "data_table", "position_seconds": 1.0, "duration_seconds": 4.0, "placement": "full_frame", "params": {"title": "This week", "columns": ["Name", "Orders"], "rows": ["A | 41", "B | 37", "C | 22"], "plate": "solid"}}`; new table on the track above from the filter chip frame with the changed values.
2. Wipe the new table in across each row, 2 f (0.03 s) after the chip lands: `add_shape_mask_tool {"clip_ids": ["<new_table>"], "shape": "rectangle", "x": 0.5, "y": 0.5, "width": 1.0, "height": 1.0, "feather": 0, "keyframes": [{"seconds": 2.03, "grow": -1.0}, {"seconds": 2.37, "grow": 0}]}`; a single mask moves all rows together, so the 3 f (0.05 s) stagger per row is approximated by cutting the table into one clip per row if needed.
3. A 1.5 px hairline rides the wipe edge (a thin `add_title_tool` line with `location_x` keyframes) and fades over its last 6 f (0.1 s); the accent marks only the row the story is about.
4. `add_sfx_tool {"recipe": "swish_airy", "at_seconds": 2.03, "gain_db": -22}`.

Fallback: Per-row stagger needs one table clip per row; if that is too heavy, a single left-to-right wipe is the stand-in.

## Timing & taste rules

- cinetic's timing (60 fps): Starts 2 f (0.03 s) after the chip lands. 3 f (0.05 s) row stagger. 20 f (0.33 s) per row, linear (at most 60 px/f across a 1,250 px row). Six rows finish within ~35 f (0.58 s). Hairline fades over 6 f (0.10 s).
- Start 2 f (0.03 s) after the chip lands; 3 f (0.05 s) row stagger; 20 f (0.33 s) per row, linear, at most 60 px/f across a 1,250 px row.
- Six rows finish within about 35 f (0.58 s); hairline fades over 6 f (0.1 s).
- Nothing crossfades: each cell changes as the line crosses it.
- Small numeric changes roll for 12 f (0.2 s) once the line reaches them.

## Sound for it

One quiet airy swish at the start of the scan, -22 dB; no per-row sound.

## Common mistakes

- Only one cell changing: a roll on that cell is enough.
- More than 8 rows, where the cascade reads as a queue.
- Crossfading old to new values.
- Avoid when: Only one cell changes, so a Roll on it is enough; more than 8 rows, where the cascade reads as a queue.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`dn-row-cascade-value-swap`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
