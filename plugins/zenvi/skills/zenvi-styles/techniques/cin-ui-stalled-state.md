---
id: cin-ui-stalled-state
kind: technique
summary: "When a task is stuck waiting, a token halts on its rail, the goal dims, status words appear, then all goes still."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_type_block_tool, add_title_tool, set_keyframes_tool]
pace: calm
mood: [stuck, quiet, tense]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-ui-path-fracture-fan, cin-ui-clutter-pileup-strip, cin-pd-agent-status-then-answer]
avoid_with: [kcut-hit-fx, shot-slam-entrance]
needs: [dashed-stroke-degrade]
drawn: cinetic
---

# Stalled state by dimming

cinetic `ui-stalled-state` · UI choreography · accent · energy calm · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A token stops on its rail, the destination greys out, short status words appear one after another, and the frame goes briefly still so the blockage is felt.

Use when: The problem beat: money, a message or a task stuck waiting (closed, pending, rejected) just before the product unblocks it.

## Build it in Zenvi

1. Rail up to the token: `add_type_block_tool {"block": "write_on", "paths": ["M0 0 L0.6 0"], "x": 0.3, "y": 0.5, "width": 0.3, "stroke_width": 3, "position_seconds": 0.0, "duration_seconds": 0.8, "draw_seconds": 0.4}`; the part ahead as a row of dots: `add_title_tool {"text": "· · · · · · ·", "screen_position": "center_right", "position_seconds": 0.0, "duration_seconds": 3.0}`.
2. On the stall frame the destination dims to 30 % over 8 f (0.13 s): `set_keyframes_tool {"timeline_clip_id": "<destination>", "property": "alpha", "points": [{"seconds": 0.8, "value": 1.0}, {"seconds": 0.93, "value": 0.3, "ease": "ease_in_out_sine"}]}`.
3. Status words at +6 f (0.10 s), +28 f (0.47 s), +40 f (0.67 s): `add_title_tool {"text": "<word>", "screen_position": "center", "position_seconds": 0.9, "duration_seconds": 2.0, "fade_in_seconds": 0.13}` each with a 6 px (0.006 of height) rise `set_keyframes_tool {"property": "location_y", "points": [{"seconds": 0.9, "value": 0.006}, {"seconds": 1.03, "value": 0, "ease": "ease_out_expo"}]}`.
4. At +51 f (0.85 s) the first word dims to 40 % (`alpha`, 0.13 s) so the decisive word stands alone.
5. Freeze: hold every layer still for at most 15 f (0.25 s), then a slow drift so nothing is static past 48 f (0.8 s): `set_keyframes_tool {"property": "scale_x", "points": [{"seconds": 1.9, "value": 1.0}, {"seconds": 3.0, "value": 1.012, "ease": "ease_in_out_sine"}]}` (same for scale_y).

Fallback: Without a dotted stroke use a row of dot glyphs; the dim-and-words beat carries the idea even on a plain line.

## Timing & taste rules

- cinetic's timing (60 fps): Node dim 8 f (0.13 s) (ease_in_out_sine) to 30%. Status words at +6/+28/+40 f (0.67 s), 8 f (0.13 s) each (ease_out_expo, 6 px rise); first word dims at +51 f (0.85 s). Freeze <= 15 f (0.25 s) on a silence, then 0.3 px/f drift.
- Destination dims to 30 % in 8 f (0.13 s) with ease_in_out_sine, not a cut.
- Three status words staggered +6 / +28 / +40 f (0.10 / 0.47 / 0.67 s); the first dims at +51 f (0.85 s) so the reason (the day, the status) stands alone.
- Dead stillness at most 15 f (0.25 s), then a drift of about 0.3 px/f; nothing sits fully static past 48 f (0.8 s).
- Whole block under about 1.5 s of dwell.

## Sound for it

None, or music dips 3 dB for the stall; the stillness is the sound. Do not add a hit.

## Common mistakes

- A film with no problem act: this beat only works as the contrast just before the product unblocks it.
- Letting the block sit longer than about 1.5 s: stillness is a short contrast to the motion around it.
- More than three status words: the decisive one gets lost.
- Avoid when: The film has no problem act, or the block would sit longer than about 1.5 s; stillness only works as a short contrast to the motion around it.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ui-stalled-state`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
