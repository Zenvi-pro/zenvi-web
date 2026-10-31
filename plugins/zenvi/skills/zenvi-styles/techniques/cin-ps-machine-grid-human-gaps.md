---
id: cin-ps-machine-grid-human-gaps
kind: technique
summary: "When a demo has a user and a product: the product's work ticks on a metronome while the person's moves arrive uneven."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [organic, precise, demo-ready]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [prompt-bar-typing-hero, cin-ps-fixed-ask-variable-answer, shot-control-state-change]
avoid_with: [kinetic-beat-strobe, cin-ps-silent-ui-steady-bed]
needs: []
drawn: cinetic
---

# Machine on the grid, hands off it

cinetic `ps-machine-grid-human-gaps` · Pacing and structure · workhorse · energy medium · formats walkthrough, feature, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Work the product does (rows inserting, items stacking, text streaming) ticks on a strict metronome, while what a person does (moving the cursor, flipping toggles, clicking) arrives on uneven, deliberating gaps, so the viewer can feel who is acting.

Use when: Product demos where a person gives an instruction and the product or an agent responds, walkthroughs that mix input with generated output, and any sequence where automation should feel tireless next to a human.

## Build it in Zenvi

1. Tag every event as SYS (product work: rows inserting, items stacking, text streaming) or USER (cursor travel, clicks, toggles, drags).
2. SYS on a strict step, the same curve and length each time: `add_motion_block_tool {"block": "data_table", "position_seconds": 0, "duration_seconds": 6, "params": {"columns": ["Name", "Status"], "rows": ["Draft | Done", "Review | Pending", "Ship | Live"]}}`; rows land every 15 f (0.25 s, an 8th at 120 BPM) or every 7-8 f (0.12-0.13 s) in bursts, each a 12 f (0.2 s) reveal. Streams run at 25-40 characters per second.
3. USER on a hand-written uneven list, at least 2x between the shortest and the longest gap, no two neighbours within 15 %: toggles at 0, 4, 19, 37 f (0, 0.07, 0.32, 0.62 s): `add_motion_block_tool {"block": "toggle_panel", "position_seconds": 0, "duration_seconds": 6, "params": {"rows": ["Notifications", "Auto-save", "Sync", "Share"], "cursor": true}}`.
4. Cursor travel for a trip of D px lasts max(14, D/20) f (at least 0.23 s), peak under 60 px/f; a dwell of 6-18 f (0.1-0.3 s) before each press: `add_motion_block_tool {"block": "cursor_path", "position_seconds": 0, "duration_seconds": 6, "params": {"background": "<capture>", "points": [{"x": 0.3, "y": 0.4}, {"x": 0.6, "y": 0.5}], "clicks": true}}`.
5. Only the decisive press of each scene lands on a beat (within 1 f); the rest of the user layer stays off the grid.
6. Sound: `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 0.25, "gain_db": -22}` on each SYS insert (dropped once inserts pass about 3 per second over a bed); USER actions silent except `mouse_click` at the decisive press.

Fallback: The blocks time their own events; to impose your own uneven gaps, build the USER layer as separate cursor_path and toggle blocks placed at hand-chosen offsets.

## Timing & taste rules

- cinetic's timing (60 fps): SYS: one event every 15 f (0.25 s) (an 8th at 120 BPM), or every 7-8 f (16ths) in bursts; identical 12 f (0.20 s) ease_in_out_cubic reveals; streams at 25-40 characters per second. USER: gaps such as 4, 15 and 18 f (0.30 s), or 10, 26 and 14 f (0.23 s); cursor travel max(14, D/20) f on ease_out_cubic, peak under 60 px/f, with motion blur above 12 px/f; dwell 6-18 f (0.30 s); press 12 f (0.20 s) via pressAt; the decisive press on the beat ±1 f (0.02 s).
- SYS: one event every 15 f (0.25 s), or every 7-8 f (0.12 s) in bursts; identical 12 f (0.2 s) reveals; streams at 25-40 characters per second.
- USER gaps such as 4, 15, 18 f (0.07, 0.25, 0.3 s) or 10, 26, 14 f (0.17, 0.43, 0.23 s); cursor travel max(14, D/20) f on ease_in_out_sine; dwell 6-18 f; press 12 f.
- The decisive press on a beat within +/-1 f; everything else human-uneven.
- Blur above 12 px/f.

## Sound for it

Each SYS insert gets one soft tick so the metronome is heard; USER actions stay silent except the decisive click.

## Common mistakes

- Pure type films or brand stings with no user in the story.
- Musical montages where every event must land on the beat.
- Even USER gaps: the cursor then looks like a script, not a hand.
- Avoid when: Pure type films or brand stings with no user in the story; polyrhythm grids, which run their own clocks; musical montages where every event must land on the beat.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ps-machine-grid-human-gaps`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
