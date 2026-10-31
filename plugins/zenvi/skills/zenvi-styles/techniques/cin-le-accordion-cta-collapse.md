---
id: cin-le-accordion-cta-collapse
kind: technique
summary: "When the closing line is a sentence plus a URL: its words start far apart and close up, the URL travelling farthest."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_title_tool, set_keyframes_tool, apply_fx_tool, add_sfx_tool]
pace: calm
mood: [resolving, confident]
aspect: ["16:9", "1:1"]
pairs_with: [cin-le-living-hold]
avoid_with: [cin-le-words-part-url-types, cin-le-card-to-pill-flank]
needs: [focus-pull-between-planes]
drawn: cinetic
---

# CTA line closes its gaps

cinetic `le-accordion-cta-collapse` · Logo and end card · accent · energy calm · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The end line starts with exaggerated spaces between its words, which close as the line settles centred; the last word, often the URL, travels farthest, so the eye ends there.

Use when: A one-line CTA (a sentence plus a URL) after a large type beat. Type-led films whose last beat is a phrase locking together.

## Build it in Zenvi

1. One title per word in their final centred slots on tracks 3-6: `add_title_tool {"text": "Start", "template": "Standard_1", "position_seconds": 4.0, "duration_seconds": 3.5, "track": "3"}`, then "free", "today", "zenvi.com".
2. Word i starts offset off_i = 70 + 80 i px (capped at 290 px, i.e. 0.036 + 0.042 i of width) in the direction of travel: `set_keyframes_tool {"timeline_clip_id": "<w_i>", "property": "location_x", "ease": "ease_out_expo", "points": [{"seconds": 4.0, "value": <off_i>}, {"seconds": 4.73, "value": 0}]}` (a close with tau about 14.6 f: 55 % closed in 10 f, 0.17 s, 95 % by 44 f, 0.73 s; the last word starts at no more than 20 px/f).
3. Enter on a hard cut from a larger line whose total width matches this line's stretched width.
4. The URL focus resolve (soft for 8 f, 0.13 s, then sharp over 14 f, 0.23 s) needs a focus pull; skip it here.
5. `add_sfx_tool {"recipe": "swish_airy", "at_seconds": 4.0, "gain_db": -22}`.

Fallback: A true focus pull on the URL is not available (needs focus-pull-between-planes); skip it rather than fake it with a streak.

## Timing & taste rules

- cinetic's timing (60 fps): tau = 14.6 f (0.24 s): 55% closed in 10 f (0.17 s), 95% by 44 f (0.73 s). The last word starts at no more than 20 px/f and only slows from there. Gaps of ~150/115/80 px close to a normal word space (~0.25 em). URL focus: soft for 8 f (0.13 s), resolved over 14 f (0.23 s).
- Offsets 70 + 80 i px capped at 290 px; last word farthest, so the eye ends on it.
- Pure exponential close: no overshoot; gaps of about 150/115/80 px close to a normal word space (~0.25 em).
- The last word starts at no more than 20 px/f and only slows.
- URL soft for 8 f (0.13 s), resolved over 14 f (0.23 s) when a focus pull is possible.

## Sound for it

One quiet airy swish at -22 dB at the start of the close, or none.

## Common mistakes

- Lines that wrap to two rows.
- Films that already closed a word gap earlier.
- Vertical frames where the stretched line would exceed the safe width.
- Avoid when: Lines that wrap to two rows. Films that already closed a word gap earlier. Vertical frames where the stretched line would exceed the safe width.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`le-accordion-cta-collapse`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
