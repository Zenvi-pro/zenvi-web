---
id: cin-lc-arc-carousel
kind: technique
summary: "When an inventory should feel endless: cards ride a wide smile arc, rush in, drift through the middle and speed out."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_clip_to_timeline_tool, set_keyframes_tool, apply_fx_tool]
pace: medium
mood: [abundant, smooth, showcase]
aspect: ["16:9", "1:1"]
pairs_with: [shot-picker-carousel, shot-carousel-ring, cin-lc-one-centred-subject]
avoid_with: [cin-lc-bento-cell-takeover, shot-multiplane-slider]
needs: [arc-carousel-rig]
drawn: cinetic
---

# Arc carousel

cinetic `lc-arc-carousel` · Layout and composition · signature · energy medium · formats launch, feature, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A row of cards rides a wide smile-shaped arc across the lower part of the frame, each tilted tangent to the curve, rushing in, coasting slowly through the middle and speeding out.

Use when: Showing an inventory or collection (templates, cards, products, integrations) where several items should read at once and the set should feel endless; a looping feature beat.

## Build it in Zenvi

1. Dome behind the cards: `add_motion_block_tool {"block": "gradient_field", "position_seconds": 0, "duration_seconds": 3.0, "params": {"style": "orbs", "speed": 0.3}}` (or a flat accent title card faded to transparent).
2. Place 7-9 card clips (260-300 px wide at 1080p, 0.14-0.16 of the frame width) on tracks 2 and up, centre card on the highest track: `add_clip_to_timeline_tool {"file_id": "<card_i>", "position_seconds": 0, "duration_seconds": 3.0, "track": 2}`.
3. Circle R = 1750 px (1.62 of the frame height) centred 0.73 of the height above the top edge, so the arc bottoms at 0.89 of the height. Card i at angle theta = theta0(t) + 11 deg x i: `location_x = 0.91 * sin(theta)`, `location_y = -1.23 + 1.62 * cos(theta)`, `rotation = -theta` (check the lean on one card in the preview). Per card `set_keyframes_tool {"timeline_clip_id": "<card_i>", "property": "location_x", "mode": "replace", "points": [...]}` with points at 0 s (theta0 = 12 deg), 0.75 s (0, `ease_out_expo`), 1.5 s (a slow drift of -0.25 deg/f, so about -11 deg from the start), 3.0 s (exit through another -7.6 deg, `ease_in_cubic`); the same times for `location_y` and `rotation`.
4. Soft drop shadow: bake it into each card image (a transparent PNG with a shadow) before import; no clip effect draws it.
5. `apply_fx_tool {"clip_id": "<card_i>", "effects": [{"effect": "directional_blur", "amount": 0.5, "start": 0, "end": 0.25}, {"effect": "directional_blur", "amount": 0.5, "start": 2.65, "end": 3.0}]}` for the fast ends.

Fallback: Per-card arc keyframes are long; with fewer than five cards the arc looks like a plain slide, so use `add_motion_template_tool` template `ui_cards` (a fan of up to three) or keep 7 cards and accept the repeat work.

## Timing & taste rules

- cinetic's timing (60 fps): 90 f (1.50 s) per pass. Card speed 58 px/f on entry, about 8 px/f through the middle, 39 px/f on exit (angular 1.9, then 0.25, then 1.3 deg/f). Spacing 11 deg, about 336 px of arc, for cards 260-300 px wide.
- 90 f (1.5 s) per pass in cinetic's own timing; 3 s here lets one card dwell.
- Speed: 58 px/f on entry (1.9 deg/f), about 8 px/f through the middle (0.25 deg/f), 39 px/f on exit (1.3 deg/f): a U shape, ease_out_expo in and ease_in_cubic out.
- Spacing 11 deg (about 336 px of arc, 0.31 of the frame width) for cards 260-300 px wide.
- Blur only while a card moves faster than 12 px/f: about the first 15 f (0.25 s) and the last 20 f (0.33 s).
- 12 opaque cards with soft shadows in the original; the centre card is on top.

## Sound for it

A soft whoosh_short at -16 dB under the entry rush and nothing through the slow middle; no sound per card.

## Common mistakes

- Dense text on cards: the tilted edge cards are glanced at, not read.
- Vertical frames: the arc gets too tight; use a column or the picker carousel instead.
- Moving the cards at one constant speed: the rush, drift, rush shape is the point.
- Avoid when: Items with dense text that must be read at the edges (tilted edge cards are glanced at, not read), or vertical frames where the arc gets too tight.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`lc-arc-carousel`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
