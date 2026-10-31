---
id: cin-ty-vertical-word-stack
kind: technique
summary: "When a phone-sized frame needs a speaking-pace statement: each word lands on its own line and the stack rises one line."
categories: [cinetic-launch-film, cinetic-teaser]
tools: [add_title_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [direct, mobile]
aspect: ["9:16", "4:5"]
pairs_with: [cin-ty-reading-order-exit, shot-blur-slide]
avoid_with: [cin-ty-recentre-line-build]
needs: []
drawn: cinetic
---

# Vertical word stack

cinetic `ty-vertical-word-stack` · Typography in motion · workhorse · energy medium · formats vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

In a tall frame each new word lands on its own line under the last while the stack rises one line, so the newest word always sits on the optical centre.

Use when: Vertical cut-downs where a horizontal line would be too small; speaking-pace statements on a phone-sized frame; one word per beat.

## Build it in Zenvi

1. One title per word on a 9:16 project, each centred in the same column: `add_title_tool {"text": "Shoot", "template": "Standard_1", "font_scale": 2.6, "position_seconds": 1.0, "duration_seconds": 3.5, "track": "3"}`; then "once.", "Publish" and "everywhere." on tracks 4-6 at 1.43, 1.87, 2.3 s (a word every 26 f).
2. Drop-in per word: `set_keyframes_tool {"timeline_clip_id": "<w_k>", "property": "location_y", "ease": "ease_out_expo", "points": [{"seconds": <land_k>, "value": 0.05}, {"seconds": <land_k + 0.3>, "value": 0}]}` (0.35 em, 18 f), `alpha` 0 to 1 over 0.1 s.
3. Stack rise: for all earlier words add `location_y` -0.055 per new landing (one line of pitch 1.05x the font size) over 0.45 s `ease_in_out_sine`.
4. Fade lines older than two steps: `alpha` 1 to 0 over 0.3 s on each word two landings later, so at most 3 words show.
5. Keep the stack inside the title-safe band, clear of feed UI. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": <final landing>, "gain_db": -18}`.

## Timing & taste rules

- cinetic's timing (60 fps): A word every 24-30 f (0.50 s); word rise 18 f (0.30 s) ease_out_expo; stack step ease_out_quart (97% in 27 f (0.45 s)); at most 3 lines visible; final hold at least 36 f (0.60 s) + 6 f (0.10 s) per word with a 0.3 px/f drift.
- Pitch 1.05x font size; statement type 110-140 px in 9:16 (about 6-7 % of frame height).
- A word every 24-30 f (0.4-0.5 s); rise 18 f (0.3 s) ease_out_expo; stack step settles in about 27 f (0.45 s), peak about 11 px/f.
- At most 3 words visible; older lines fade through a soft top edge.
- Final word may arrive in the accent colour and relax to ink; hold at least 36 f + 6 f per word.

## Sound for it

A single ui_tap at -18 dB on the final word; never one per word.

## Common mistakes

- 16:9 masters: use the re-centring line instead.
- Statements over 6 words.
- Stacking two separate statements in the same column.
- Avoid when: 16:9 masters (use ty-recentre-line-build); statements over 6 words; stacking two separate statements.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ty-vertical-word-stack`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
