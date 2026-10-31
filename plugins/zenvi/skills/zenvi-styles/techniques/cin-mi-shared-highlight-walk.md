---
id: cin-mi-shared-highlight-walk
kind: technique
summary: "When a menu choice should feel decided, one rounded highlight follows the cursor row to row and settles."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, add_title_tool, set_keyframes_tool, add_motion_block_tool, add_sfx_tool]
pace: calm
mood: [smooth, human, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-mi-guide-cursor-hover-press, cin-mi-velocity-stretch-dot, shot-picker-carousel]
avoid_with: [cin-ui-clutter-pileup-strip]
needs: []
drawn: cinetic
---

# Shared highlight walks the menu

cinetic `mi-shared-highlight-walk` · Micro-interaction · workhorse · energy calm · formats walkthrough, feature, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

One rounded highlight slides from row to row of a sidebar or menu, trailing the cursor, and the chosen row settles into a pale accent tint.

Use when: Navigation through a menu, sidebar or list should read as a small human decision, with spatial continuity.

## Build it in Zenvi

1. The sidebar or menu is a clip (real recording or screenshot): `add_clip_to_timeline_tool {"file_id": "<menu>", "position_seconds": 0.0, "duration_seconds": 5.0, "track": "1"}`. One highlight clip behind the rows' labels: `add_title_tool {"text": " ", "background_color": "<white_or_mist>", "fit_text": false, "position_seconds": 0.0, "duration_seconds": 5.0, "track": "2"}` with `corner_radius` 8 px (or row height / 2).
2. It moves to each target row's rect over 12 f (0.2 s) on `ease_out_expo`, starting 4 f (0.07 s) after the cursor reaches the row, about 24 f (0.4 s) per row: `set_keyframes_tool {"timeline_clip_id": "<highlight>", "property": "location_y", "points": [{"seconds": <row1_t>, "value": <y1>}, {"seconds": <row1_t+0.2>, "value": <y2>, "ease": "ease_out_expo"}]}` and `scale_y` when the row heights differ. The first hover can appear in one frame.
3. The pointer: `add_motion_block_tool {"block": "cursor_path", "params": {"background": "<menu>", "points": [...], "clicks": true}, "position_seconds": 0.0, "duration_seconds": 5.0}`.
4. On the click the chosen row takes a 10 % accent tint over 8 f (0.13 s) (`alpha` 0 to 0.1 on a tint clip) and its label goes to ink; then the moving highlight fades over 8 f (0.13 s) (`alpha` 1 to 0). The row text never moves.
5. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": <click>, "gain_db": -22}`.

## Timing & taste rules

- cinetic's timing (60 fps): 12 f (0.20 s) ease_out_expo per hop; about 24 f (0.40 s) per row; trails the cursor by 4 f (0.07 s); click tint 8 f (0.13 s) ease_in_out_cubic; highlight fade 8 f (0.13 s).
- 12 f (0.2 s) per hop on ease_out_expo, about 24 f (0.4 s) per row, trailing the cursor by 4 f (0.07 s).
- Click tint 8 f (0.13 s); highlight fade 8 f (0.13 s).
- White highlight on a dark sidebar, mist grey on a light one.
- Only the highlight moves; the row text stays put.

## Sound for it

One ui_tap at -22 dB on the click; hovering rows is silent.

## Common mistakes

- Rows too small to read at the framing: push in first.
- Adding a soft radial bloom to the highlight.
- Letting the row text move with the highlight.
- Avoid when: The rows are too small to read at the shot's framing (push in first), or a soft radial bloom would be added to the highlight.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`mi-shared-highlight-walk`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
