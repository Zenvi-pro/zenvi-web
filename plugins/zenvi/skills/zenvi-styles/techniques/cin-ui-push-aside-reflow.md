---
id: cin-ui-push-aside-reflow
kind: technique
summary: "When a panel or card arrives beside existing UI, it shoves its neighbour aside so one move shifts two things."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, add_kinetic_title_tool, add_sfx_tool]
pace: medium
mood: [physical, tidy, product]
aspect: ["16:9", "1:1"]
pairs_with: [cin-ui-live-reflow, cin-ui-container-morph, cin-pd-headline-becomes-input]
avoid_with: [cin-ui-genie-launch-from-icon, shot-slam-entrance]
needs: []
drawn: cinetic
---

# Push-aside with bound layout

cinetic `ui-push-aside-reflow` · UI choreography · workhorse · energy medium · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

An incoming panel or card enters from the edge and the neighbouring content moves aside because it is bound to the panel's edge, so one motion moves two elements and nothing overlaps.

Use when: Introducing a detail panel, a new card or a caption beside existing UI, or a joke where the layout itself does the gag.

## Build it in Zenvi

1. Neighbour (content card or headline) and the incoming panel are separate clips on separate tracks: `add_clip_to_timeline_tool {"file_id": "<panel>", "position_seconds": 0.0, "duration_seconds": 3.0, "track": "3"}`.
2. Shove: the dark card (about 62 % of frame width) enters from beyond the right edge over 72 f (1.2 s) on `ease_in_out_expo`: `set_keyframes_tool {"timeline_clip_id": "<panel>", "property": "location_x", "points": [{"seconds": 0.0, "value": 0.85}, {"seconds": 1.2, "value": 0.1, "ease": "ease_in_out_expo"}]}`.
3. Bind the neighbour to the panel's left edge: it does not move until contact at 58 % of the move (0.70 s), when the panel has slowed to 20 px/f or less, then it follows the panel's edge minus a gap: `set_keyframes_tool {"timeline_clip_id": "<neighbour>", "property": "location_x", "points": [{"seconds": 0.70, "value": 0}, {"seconds": 1.2, "value": -0.2, "ease": "ease_in_out_sine"}]}` (sample the same curve as the panel, minus the gap, for a true bind).
4. Make-room variant: side panel 36 % of frame width on `ease_in_out_sine` over 54 f (0.9 s); the content card moves 0.43x the panel travel starting 28 f (0.47 s) BEFORE the panel, `ease_in_out_sine`; exit mirrors over about 50 f (0.83 s).
5. Copy variant: product card glides 0.19 of frame width aside and scales 1 to 0.83 over 48 f (0.8 s) `ease_in_out_sine`; headline: `add_kinetic_title_tool {"text": "<line>", "animation": "rise", "stagger_seconds": 0.1, "position_seconds": 0.08}`.
6. `add_sfx_tool {"recipe": "whoosh_short", "at_seconds": 0.0, "gain_db": -20}`.

## Timing & taste rules

- cinetic's timing (60 fps): Shove: 72 f (1.20 s) (ease_in_out_expo), contact after 58% of the move, word <= 20 px/f. Side panel: 36% FW over 54 f (0.90 s) (ease_out_cubic); neighbour 0.43x travel with a 28 f (0.47 s) lead (ease_in_out_sine); exit ~50 f (0.83 s). Copy: 370 px + scale 0.83 over 48 f (0.80 s) (ease_out_cubic); lines 6 f (0.10 s) apart from +4-6 f (0.10 s).
- Shove 72 f (1.2 s) on ease_in_out_expo; contact only after 58 % of the move so the shoved word is readable (panel at 20 px/f or less).
- Make-room panel 36 % of width, 54 f (0.9 s); neighbour moves 0.43x the travel and starts 28 f (0.47 s) early so it anticipates.
- Copy: card glides 370 px aside and scales to 0.83 over 48 f (0.8 s), headline lines 6 f (0.1 s) apart, starting 4-6 f (0.08 s) after the slide.
- Nothing overlaps at any frame: if two things touch, it is a float, not a push.

## Sound for it

One whoosh_short at -20 dB under the panel entry and a very soft impact_thud at -24 dB on contact; none for the copy variant.

## Common mistakes

- The incoming element should float above (modal, popover) or there is no room to move into.
- Tweening the neighbour on its own clock: it must follow the panel edge or the two drift apart.
- Contact at the fastest frame of the panel: the shoved word smears and cannot be read.
- Avoid when: The incoming element should float above (modal, popover), or there is no room to move into.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ui-push-aside-reflow`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
