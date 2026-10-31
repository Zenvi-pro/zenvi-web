---
id: cin-le-card-to-pill-flank
kind: technique
summary: "When the last card closes the film: it empties into a small pill while tagline words fly in to flank it."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, add_type_block_tool, add_title_tool, set_keyframes_tool, apply_fx_tool, add_sfx_tool]
pace: medium
mood: [neat, resolving]
aspect: ["16:9", "1:1"]
pairs_with: [cin-le-living-hold, cin-le-bookend-replay]
avoid_with: [cin-le-accordion-cta-collapse]
needs: []
drawn: cinetic
---

# Card shrinks to a pill, words close in

cinetic `le-card-to-pill-flank` · Logo and end card · accent · energy medium · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The last content card empties and shrinks into a small pill while the tagline words slide in from beyond the frame edges, blurred to sharp, to sit on either side of it; then the logo appears inside the pill.

Use when: Films that opened with a gap or pill inside a headline (the reverse closes the bookend). Products whose output is a card, post, message or result. A tagline that brackets the brand: [wordL] [mark] [wordR].

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same sequence, but the pill is opaque: a solid tonal step of the stage colour (`add_type_block_tool {"block": "write_on", "paths": ["<pill d>"], "fill": true, "ink": "<stage step>"}`), optionally a 1.5 px stroke, and no translucent fill, no frosted backdrop and no shape-mask rim.
2. The words and the logo as in the full build.

**Full look** (relies on glass: only when the person's brand supplies that look):

1. The card clip fades its content out first (6 f, 0.1 s): `set_keyframes_tool {"timeline_clip_id": "<card>", "property": "alpha", "points": [{"seconds": 4.0, "value": 1}, {"seconds": 4.1, "value": 0}]}` over a second pill-shaped plate underneath.
2. Shrink to the pill on a whip curve (30 f, 0.5 s): the plate `scale_x` 1.0 to 0.25 (1240 to 310 px) and `scale_y` to 0.2 with `ease_in_out_expo`; the full look frosts the pill with `add_shape_mask_tool {"clip_ids": ["<plate>"], "shape": "rectangle", "width": 0.16, "height": 0.1, "feather": 0.04}` over the footage below.
3. The words come in from beyond the edges, blurred to sharp: `add_title_tool {"text": "Make", ...}` and `{"text": "magic", ...}` with `location_x` -0.25 to 0 / +0.25 to 0 over 0.5 s `ease_in_out_expo` (each travels about 470 px, peak 58 px/f), `alpha` 0 to 1, `apply_fx_tool` directional_blur on the flight.
4. The logo fades into the pill over 14 f (0.23 s) starting 8 f (0.13 s) after it lands: `add_clip_to_timeline_tool {"file_id": "<logo>", "position_seconds": 4.63, "duration_seconds": 3.0, "track": "5"}` + `fade_clip_tool` 0.23 s.
5. `add_sfx_tool {"recipe": "whoosh_short", "at_seconds": 4.1, "gain_db": -14}`.

## Timing & taste rules

- cinetic's timing (60 fps): Content fade: 6 f (0.10 s). Shrink: 30 f (0.50 s) on ease_in_out_expo (card ~1240 -> ~310 px; each word travels ~470 px at a peak of ~58 px/f with the motion-blur pass on, faded until it lands). Logo fade: 14 f (0.23 s), starting 8 f (0.13 s) after the pill lands. Then hold 90-120 f (2.00 s) under a 10-15% push (le-living-hold).
- Content fade 6 f (0.1 s) before the slot moves fast; shrink 30 f (0.5 s) on a whip curve (about 1240 to 310 px).
- Each word travels about 470 px at a peak of about 58 px/f, faded until it lands, motion blur on.
- Logo fade 14 f (0.23 s), starting 8 f (0.13 s) after the pill lands; then hold 90-120 f (1.5-2 s) under a 10-15 % push.
- The row stays centred throughout.

## Sound for it

A short whoosh_short on the shrink at -14 dB; nothing when the logo fades in.

## Common mistakes

- No card on screen to collapse.
- Words too long to fit beside the pill inside the safe width.
- Light-on-light stages where the pill loses its edge.
- Avoid when: There is no card on screen to collapse. Words too long to fit beside the pill inside the safe width. Light-on-light stages where the pill loses its edge.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`le-card-to-pill-flank`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
