---
id: cin-mi-badge-count-bump
kind: technique
summary: "When incoming activity should register, a badge digit rolls to the next value and the badge pulses once per increment."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_title_tool, add_shape_mask_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [small, countable, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-ui-top-insert-push, cin-mi-chip-bloom, shot-stack-press-count]
avoid_with: [kinetic-counter, cin-ui-clutter-pileup-strip]
needs: []
drawn: cinetic
---

# Badge count bump

cinetic `mi-badge-count-bump` · Micro-interaction · accent · energy medium · formats feature, walkthrough, loop, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A notification badge or counter chip ticks up: the digit rolls to the next value while the badge gives a small pulse, once per increment.

Use when: Incoming activity (messages, leads, approvals) should register as small, countable events on the UI.

## Build it in Zenvi

1. The badge is a pill clip in the accent (`add_title_tool {"text": " ", "background_color": "<accent>", "fit_text": false, "position_seconds": 0.0, "duration_seconds": 4.0, "track": "3"}`) with the digits as one title clip per value on the track above, each clipped to the pill with `add_shape_mask_tool {"clip_ids": ["<digit>"], "shape": "rectangle", "x": <bx>, "y": <by>, "width": <bw>, "height": <bh>}` so it stays in its slot.
2. On each increment frame c, the old digit rolls up and out and the new one in from below, one line height over 8 f (0.13 s): `set_keyframes_tool {"timeline_clip_id": "<digit_old>", "property": "location_y", "points": [{"seconds": <c>, "value": 0}, {"seconds": <c+0.13>, "value": -<line_h>, "ease": "ease_out_expo"}]}` and the new digit from `+<line_h>` to 0.
3. Pulse the badge: `set_keyframes_tool {"timeline_clip_id": "<badge>", "property": "scale_x", "points": [{"seconds": <c>, "value": 1.12}, {"seconds": <c+0.1>, "value": 1.0, "ease": "ease_out_expo"}]}` (same for scale_y; attack 2 f = 0.03 s, tau 5 f = 0.08 s). Widen the pill over 8 f (0.13 s) when the digit count changes (9 to 10).
4. First appearance: the badge pops from its icon's corner (`origin_x`/`origin_y` there) with scale 0 to 1 over 8 f on `ease_out_back`.
5. Space the increments unevenly, at least 12 f (0.2 s) apart. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": <c>, "gain_db": -26}` per increment.

## Timing & taste rules

- cinetic's timing (60 fps): Digit roll 8 f (0.13 s) ease_out_expo; pulse hitPulse(t, 2, 5) x 0.12; width 8 f (0.13 s) ease_out_expo; first appearance on ease_out_cubic; increments at least 12 f (0.20 s) apart, uneven.
- Digit roll 8 f (0.13 s) on ease_out_expo, one line height of travel.
- Pulse 1.12 with attack 2 f (0.03 s), tau 5 f (0.08 s); width change 8 f (0.13 s).
- Increments uneven and at least 12 f (0.2 s) apart.
- White tabular digits on a flat accent pill.

## Sound for it

A light ui_tap at -26 dB on each increment; the first appearance gets a soft pop at -22 dB.

## Common mistakes

- The count is the hero number of the shot: use a full counter.
- Increments faster than one per 12 f (0.2 s): the pulses fuse.
- Proportional digits that make the pill jitter: use tabular figures.
- Avoid when: The count is the hero number of the shot (use a full counter), or increments would come faster than about one per 12 f.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`mi-badge-count-bump`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
