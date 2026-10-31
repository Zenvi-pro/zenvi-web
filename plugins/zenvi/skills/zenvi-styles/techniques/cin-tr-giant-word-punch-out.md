---
id: cin-tr-giant-word-punch-out
kind: technique
summary: "When one word is the claim: cut to a giant close-up that brakes, then out to the whole word as tracking slams shut."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, set_keyframes_tool, apply_fx_tool, add_sfx_tool]
pace: fast
mood: [loud, bold, graphic]
aspect: ["9:16", "16:9", "1:1"]
pairs_with: [kinetic-keyword-slam, kcut-slam-word, kinetic-emphasis-scale]
avoid_with: [kinetic-word-pop, cin-tr-defocus-cut]
needs: [tracking-animation]
drawn: cinetic
---

# Giant word punch-out

cinetic `tr-giant-word-punch-out` · Transition · signature · energy high · formats launch, sting, vertical, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A hard cut lands on an extreme close-up of an oversized word sliding fast and braking, its letters resolving one by one. A second cut jumps out to the whole word at reading size, arriving with wide tracking that slams together.

Use when: A one-word claim or product name that deserves two beats: read it, then see it whole. Vertical cut-downs where one huge word fills the frame.

## Build it in Zenvi

1. Close-up act (18-22 f / 0.3-0.37 s): `add_kinetic_title_tool {"text": "FASTER", "position_seconds": 0, "duration_seconds": 0.35, "style": "stack", "animation": "letters", "stagger_seconds": 0.033, "text_size": 0.45, "y": 0.5}` at 2-2.5x its final size, cropped by the frame.
2. The slide brakes by x0.92 per frame (70 px/f falling to ~18 px/f by f16): `set_keyframes_tool {"timeline_clip_id": "<close>", "property": "location_x", "mode": "replace", "points": [{"seconds": 0, "value": 0.35}, {"seconds": 0.35, "value": 0.0, "ease": "ease_out_expo"}]}`. Letters resolve over 12 f (0.2 s) with a 2 f (0.033 s) stagger from f4; the first letter is sharp by f16 (0.27 s). Cut while the word still moves at 13-20 px/f.
3. Wide act: `add_kinetic_title_tool {"text": "FASTER", "position_seconds": 0.35, "duration_seconds": 1.2, "style": "stack", "animation": "slam", "text_size": 0.18}` with `scale_x/scale_y` `[{"seconds": 0.35, "value": 1.38}, {"seconds": 0.85, "value": 1.0, "ease": "ease_out_expo"}]` (30 f).
4. Wide-tracking smear: `apply_fx_tool {"clip_id": "<wide>", "effects": [{"effect": "directional_blur", "amount": 0.7, "params": {"angle": 0}, "start": 0, "end": 0.3}]}` gone by 60 % of the move; opacity `alpha` `[{"seconds": 0.35, "value": 0.5}, {"seconds": 0.48, "value": 1.0}]`.
5. Hold 30-60 f (0.5-1.0 s), then exit 6-12 f (0.1-0.2 s) with `ease_in_cubic` alpha. `add_sfx_tool {"recipe": "swoosh_hit", "at_seconds": 0.35, "gain_db": -8}`.

Fallback: No block animates letter spacing from 0.8 em to rest; the closest is the 1.38x to 1x scale with the horizontal blur and the 'slam' entrance.

## Timing & taste rules

- cinetic's timing (60 fps): Close-up 18-22 f (0.37 s): starts at ≤ 70 px/f and slows ×0.92 per frame (about 18 px/f by frame 16); letters resolve over 12 f (0.20 s) with a 2 f (0.03 s) stagger from frame 4. Cut at 13-20 px/f residual speed. Wide entry 30 f (0.50 s) on ease_out_expo: scale 1.38 → 1, tracking 0.8 em → rest, horizontal blur of 18 px gone by 60% of the move, outer letters ≤ 60 px/f. Colour settles in 17 f (0.28 s). Hold 30-60 f (1.00 s). Exit 6-12 f (0.20 s) on ease_in_cubic.
- Close-up 18-22 f (0.30-0.37 s): starts at 70 px/f at most and slows x0.92 per frame (~18 px/f by f16); letters resolve over 12 f (0.2 s), 2 f (0.033 s) stagger from f4.
- Cut at 13-20 px/f residual speed.
- Wide entry 30 f (0.5 s) on ease_out_expo: scale 1.38 to 1, tracking 0.8 em to rest, blur (18 px horizontal) gone by 60 % of the move, outer letters <= 60 px/f.
- Colour settles from muted to ink in 17 f (0.28 s); hold 30-60 f (0.5-1.0 s); exit 6-12 f (0.1-0.2 s).
- One or two words, under ~10 letters.

## Sound for it

`swoosh_hit` peaking on the second cut (the wide reveal), a soft `whoosh_short` under the close-up slide; none on the letters.

## Common mistakes

- Lines of more than two words or words over about 10 letters (avoid_when): the close-up loses the word.
- Needing the word small within a second: the wide hold should be 30-60 f.
- Cutting to the wide while the word is still travelling fast: the cut should be at 13-20 px/f.
- Avoid when: Lines of more than two words, or words over about 10 letters (the close-up loses the word); or when the next shot needs the word small within a second.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tr-giant-word-punch-out`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
