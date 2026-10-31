---
id: cin-dn-count-glyph-swap
kind: technique
summary: "When a count tells a from-to story: a small icon on the number swaps to its end state mid-count."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, search_emojis_tool, add_emoji_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [clever, tidy]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kinetic-counter, cin-dn-tucked-unit-label]
avoid_with: [big-number-lockup-and-counter]
needs: []
drawn: cinetic
---

# Companion glyph swaps mid-count

cinetic `dn-count-glyph-swap` · Data and numbers · accent · energy medium · formats launch, feature, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A small icon riding a counting number (a flag, an avatar, a status glyph) swaps to its destination state when the count crosses a threshold, then drops from superscript to the baseline.

Use when: The count carries a from-to story (origin to destination, free to paid, pending to done) that one icon can tell.

## Build it in Zenvi

1. `add_motion_block_tool {"block": "counter", "position_seconds": 1.0, "duration_seconds": 2.5, "placement": "full_frame", "params": {"values": ["173", "195"], "label": "countries", "style": "count", "align": "center"}}` (a 28 f count, 0.47 s, starting just below the target).
2. Superscript glyph before the swap: `search_emojis_tool {"query": "package"}`, then `add_emoji_tool {"emoji": "<origin>", "position_seconds": 1.0, "duration_seconds": 0.28, "size": 0.045, "screen_position": "center", "track": "4"}` at the number's top-right.
3. At 60 % of the count (f17, 0.28 s in, so 1.28 s) cut to the destination: `add_emoji_tool {"emoji": "<destination>", "position_seconds": 1.28, "duration_seconds": 2.2, "size": 0.045, "track": "4"}` (hard swap, no crossfade).
4. Drop to the baseline over 8 f: `set_keyframes_tool {"timeline_clip_id": "<dest>", "property": "location_y", "ease": "ease_out_expo", "points": [{"seconds": 1.27, "value": -0.012}, {"seconds": 1.4, "value": 0}]}` (8-12 px at 1080p).
5. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 1.28, "gain_db": -20}`, separate from the count ticks.

Fallback: The glyph is placed by eye next to the counter; check the corner on inspect_timeline_tool and nudge with set_keyframes_tool location_x/y.

## Timing & taste rules

- cinetic's timing (60 fps): Swap at ~60% of the count (frame 17 of a 28 f (0.47 s) count). Drop 8-12 px at 1080p over 8 f (0.13 s) on ease_out_expo through arrive. The count lands 10-11 f (0.18 s) after the swap.
- Glyph 0.45 em at the number top-right as a superscript (0.35 em up); swap at about 60 % of the count (f17 of 28, 0.28 s).
- Drop 8-12 px at 1080p over 8 f (0.13 s) ease_out_expo so it seats on the baseline while the count finishes 10-11 f later.
- Cut between the two icons, no crossfade.
- Counts under 20 f (0.33 s) lose the swap.

## Sound for it

One soft ui_tap on the swap frame, apart from the count ticks.

## Common mistakes

- A glyph that is only decoration: it must tell the from-to story.
- Counts shorter than 20 f, where the swap gets lost.
- Crossfading the two icons.
- Avoid when: The glyph would only be decoration; counts shorter than 20 f, where the swap gets lost.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`dn-count-glyph-swap`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
