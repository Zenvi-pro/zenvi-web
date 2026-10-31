---
id: cin-ui-fan-resolve-to-slots
kind: technique
summary: "When many options become an orderly set, a tilted card stack spreads into a row or flips into a grid."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [set_clip_properties_tool, set_keyframes_tool, add_motion_block_tool, add_clip_to_timeline_tool, add_sfx_tool]
pace: medium
mood: [organised, satisfying, tactile]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-ui-card-grid-arrival, shot-card-stack-fan, shot-picker-carousel]
avoid_with: [cin-ui-clutter-pileup-strip, shot-glitch-tear-cut]
needs: [card-flip-3d]
drawn: cinetic
---

# Fanned stack resolves into slots

cinetic `ui-fan-resolve-to-slots` · UI choreography · signature · energy medium · formats launch, feature, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A tilted, overlapping stack of cards spreads into an even row, or each card flips to show its face and flies small into a slot of a list grid where its label resolves.

Use when: Many options, offers, integrations or tools becoming an orderly set: the 'all in one place' or 'compare them all' beat.

## Build it in Zenvi

1. Stack of 4-6 cards, one clip each, offset 20 px (0.019 of height) apart with seeded tilts: `set_clip_properties_tool {"timeline_clip_id": "<card_i>", "properties": {"rotation": <seed +-6>, "location_x": <0.01*i>}}`.
2. Row preset: card i starts at t0 + 2 f * i (0.033 s * i) and moves to its slot over T = max(24 f, 0.09 x travel) = at least 0.4 s: `set_keyframes_tool {"timeline_clip_id": "<card_i>", "property": "location_x", "points": [{"seconds": <s>, "value": <stack_x>}, {"seconds": <s+0.4>, "value": <slot_x>, "ease": "ease_out_expo"}]}` plus `rotation` seed to 0; farthest card under 70 px/f, no overshoot.
3. Flip preset: card i at t0 + 6 f * i (0.1 s * i). Squash `scale_x` 1 to 0 over 3 f (0.05 s) `ease_in_cubic`, swap to a second clip with the face (muted back to full face), `scale_x` 0 to 1 over 3 f, then drift 12 f (0.2 s) and move to the grid slot at scale 0.25 over max(12 f, travel/20) with `ease_in_out_sine`.
4. Ready-made grid landing: `add_motion_block_tool {"block": "masonry_grid", "params": {"media_1": "<f1>", "media_2": "<f2>", "media_3": "<f3>", "columns": 3}, "position_seconds": <t0>, "duration_seconds": 5.0}`.
5. Six cards should land inside about 60 f (1.0 s); label rises 6 px over 8 f (0.13 s) as a title.

Fallback: The true Y-axis card flip is not available; use the two-clip squash flip (scale_x to 0 and back), which reads as a flip at 3 f per half.

## Timing & taste rules

- cinetic's timing (60 fps): Row: 2 f (0.03 s) stagger, T = max(24, 0.09 x travel) f (ease_out_expo), tilt +-6 deg. Flip: 6 f (0.10 s) stagger, flip 6 f (8 f (0.13 s) over 200 px wide, linear), drift 12 f (0.20 s) (ease_out_expo), FLIP to slot max(12, travel/20) f (ease_out_cubic), label 8 f (0.13 s); six cards in ~60 f (1.00 s).
- Row: 2 f (0.03 s) stagger, T at least 24 f (0.4 s), tilt +-6 degrees, nothing overshoots.
- Flip: 6 f (0.1 s) stagger, 6 f (0.1 s) flip (8 f / 0.13 s for cards wider than about 10 % of the frame) so the edge stays near 50 px/f edge-on.
- Six cards land in about 60 f (1.0 s); slot move max(12 f, travel/20).
- Cards need a soft shadow so the stack has depth.

## Sound for it

One soft whoosh_short at -20 dB under the first spread; each flip landing gets a ui_tap at -26 dB, at most four.

## Common mistakes

- Cards that must be read while they move: only the settled row is readable.
- A single card: there is no set to resolve.
- Mixing both presets in one beat: pick spread or flip.
- Avoid when: The cards must be read while they move, or there is only one card.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ui-fan-resolve-to-slots`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
