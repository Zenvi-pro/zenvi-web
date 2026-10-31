---
id: cin-ui-row-cascade
kind: technique
summary: "When a list or table fills, rows appear top to bottom, each rising a few pixels, like data streaming in."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [streaming, tidy, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-ui-card-grid-arrival, cin-ui-shell-first-build]
avoid_with: [cin-ui-top-insert-push]
needs: []
drawn: cinetic
---

# Row cascade

cinetic `ui-row-cascade` · UI choreography · workhorse · energy medium · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

List rows or cards appear one after another from top to bottom, each rising a few pixels as it fades in, so the list reads as data streaming in.

Use when: Populating any list, inbox, table, feed or a pair of mirrored input and output columns.

## Build it in Zenvi

1. Rows as a table: `add_motion_block_tool {"block": "data_table", "params": {"columns": ["Name", "Status", "Owner"], "rows": ["<r1>", "<r2>", "<r3>", "<r4>", "<r5>"], "plate": "solid"}, "position_seconds": 0.0, "duration_seconds": 3.5}` (rows slide up in turn).
2. Or rows as your own cards, one clip per row: start = t0 + 4 f * i (0.067 s * i), `alpha` 0 to 1 and `location_y` +0.0074 (8 px) to 0 over 12 f (0.2 s): `set_keyframes_tool {"timeline_clip_id": "<row_i>", "property": "location_y", "points": [{"seconds": <s>, "value": 0.0074}, {"seconds": <s+0.2>, "value": 0, "ease": "ease_out_expo"}]}`; taller cards stagger 6 f (0.1 s).
3. Mirrored input and output columns share the same row index, so 5 rows finish in about 30 f (0.5 s).
4. Row text starts in a muted grey and darkens to ink 40 f (0.67 s) after its row lands (a second text clip crossfading over 12 f / 0.2 s) so structure is read before the words.
5. Start the cascade about 20 f (0.33 s) before the previous move ends so the scene start hides inside it.

## Timing & taste rules

- cinetic's timing (60 fps): Stagger 4 f (0.07 s) (rows) to 6 f (0.10 s) (cards); each row 12 f (0.20 s) (ease_out_expo), 6-12 px rise; ink-in 12 f (0.20 s) at +40 f (0.67 s); overlap the previous move by ~20 f (0.33 s).
- Stagger 4 f (0.067 s) for rows, 6 f (0.1 s) for tall cards; each row 12 f (0.2 s) on ease_out_expo with a 6-12 px rise.
- 5 rows done in about 30 f (0.5 s); beyond about 12 rows use a scroll.
- Ink-in 12 f (0.2 s) at +40 f (0.67 s).
- Overlap the previous move by about 20 f (0.33 s).

## Sound for it

One ui_tap on the first row at -24 dB, or none; never a tick per row, the cascade is its own rhythm.

## Common mistakes

- Rows added one at a time over a longer beat: use a top insert instead.
- A list that arrives by scrolling: use a flick scroll.
- Rows rising more than 12 px: it reads as bouncing, not streaming.
- Avoid when: Rows are added one at a time over a longer beat (top insert), or the list arrives by scrolling (flick scroll).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ui-row-cascade`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
