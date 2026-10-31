---
id: cin-ty-slice-band-assembly
kind: technique
summary: "When a product name should feel assembled: thin horizontal slices slide in at slightly different moments and lock solid."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, duplicate_clips_tool, add_shape_mask_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [digital, built]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-le-mark-slide-name-follow, kcut-assemble]
avoid_with: [kinetic-scramble-decode, cin-ty-slice-glitch-streak]
needs: [per-letter-band-offsets]
drawn: cinetic
---

# Slice-band glyph assembly

cinetic `ty-slice-band-assembly` · Typography in motion · accent · energy medium · formats launch, sting, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Each letter builds up from thin horizontal slices that slide in from slightly different offsets at slightly different moments, faint and pale at first, until the word locks solid.

Use when: A product or feature name that should feel assembled or digital. A name set beside a modular or pixel mark, including the one end-lockup build when the film bookends with it. A short title after a quiet beat.

## Build it in Zenvi

1. `add_kinetic_title_tool {"text": "Pulse", "style": "documentary", "animation": "fade", "stagger_seconds": 0, "text_size": 0.2, "position_seconds": 2.0, "duration_seconds": 3.0}`, then `duplicate_clips_tool {"timeline_clip_ids": ["<title>"], "copies": 4, "to_track": "4"}` for five copies (6 for type above 160 px).
2. Band each copy to a fifth of the word height: `add_shape_mask_tool {"clip_ids": ["<copy_b>"], "shape": "rectangle", "x": 0.5, "y": <0.4 + 0.04 * b>, "width": 0.6, "height": 0.042, "feather": 0}` (overlap neighbours by 1 px so no seam shows).
3. Each band slides in at its own moment: `set_keyframes_tool {"timeline_clip_id": "<copy_b>", "property": "location_x", "ease": "ease_out_expo", "points": [{"seconds": <2.0 + d_b>, "value": <+-0.0125>}, {"seconds": <2.0 + d_b + 0.333>, "value": 0}]}` with d_b from 0 to 0.2 s in random order, alternate signs, and `alpha` 0 to 1 over 0.133 s.
4. On the frame the last band lands (about 2.53 s) cut the bands to one intact title: `delete_from_timeline_tool` on the four extra copies and keep copy 0 whole (remove its band mask with `add_shape_mask_tool {"clip_ids": ["<copy_0>"], "remove": true}`), then tighten it with a 1 % `scale_x` ease over 0.73 s `ease_out_expo` for the tracking tighten.
5. `add_sfx_tool {"recipe": "static", "at_seconds": 2.0, "gain_db": -22}` and `{"recipe": "hit_transient", "at_seconds": 2.53, "gain_db": -14}`.

Fallback: Per-letter delays are not available; every letter shares its band delay. If the bands show seams, use the text_scramble block instead.

## Timing & taste rules

- cinetic's timing (60 fps): Each band takes 20 f (0.33 s) on ease_out_expo, with opacity over 8 f (0.13 s) on linear and colour over the same 20 f (0.33 s). Band delays are 0-12 f (0.20 s) from rand (plus 1 f (0.02 s) per glyph if biased). The whole word is built in about 32 f (0.53 s) (about 40 f (0.67 s) with the bias). Offsets are 0.12 em sideways and 0.04 em vertical: about 4 px/f on frame 1 at 120 px type, so no blur. The swap to intact text takes 1 f (0.02 s), then the tracking tightens over 44 f (0.73 s) on ease_out_expo. Hold at least 60 f (1.00 s) with a drift of 0.3 px/f.
- Each band 20 f (0.33 s) ease_out_expo, offset 0.12 em sideways (about 4 px/f), 0.04 em vertical; opacity over 8 f (0.13 s).
- Band delays 0-12 f (0-0.2 s) in random order; whole word built in about 32 f (0.53 s), 40 f (0.67 s) with a left-to-right bias.
- Swap to the intact text on the frame the last band lands; tracking tightens over 44 f (0.73 s).
- Hold at least 60 f (1 s); not under 48 px type (bands under 3 px alias).

## Sound for it

A short static burst at -22 dB under the build and one hit_transient at -14 dB on the lock.

## Common mistakes

- Lines over about 3 words or type under 48 px.
- Delay spreads wide enough that the half-built word reads as broken for over 30 f.
- Using it in a film that already has a scramble decode.
- Avoid when: Lines over about 3 words, or type under 48 px (bands thinner than 3 px alias into noise). Prose. Delay spreads wide enough that the half-built word reads as broken for more than about 30 f. A film that already has a scramble decode.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ty-slice-band-assembly`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
