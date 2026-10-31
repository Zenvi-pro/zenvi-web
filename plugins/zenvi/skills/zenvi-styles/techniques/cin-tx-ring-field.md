---
id: cin-tx-ring-field
kind: technique
summary: "When type-led copy changes on a dark stage: big ellipse outlines turn in opposite directions and whip on each swap."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting]
tools: [add_type_block_tool, set_keyframes_tool, add_kinetic_title_tool, add_sfx_tool]
pace: medium
mood: [abstract, signature, orbital]
aspect: ["16:9", "1:1"]
pairs_with: [shot-orbit-ring-title-open, kinetic-text-on-path, cin-cl-one-hue-light-ramp]
avoid_with: [cin-tx-scanline-transmute]
needs: [gradient-stroke]
drawn: cinetic
---

# Intersecting ring field

cinetic `tx-ring-field` · Texture and finish · signature · energy medium · formats launch, loop, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Above and below a centred band of type, families of huge overlapping ellipse outlines rotate slowly in opposite directions and whip on every copy swap, giving the words an ownable abstract environment.

Use when: Type-led launch cards or a statement sequence on a dark stage that needs a signature environment and a motivated way to change copy without cuts.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Every ring a crisp 2 px stroke in one neutral, white at 15-60 % on ink, normal blend, depth carried by per-ring opacity alone: the same `add_type_block_tool {"block": "write_on", ..., "ink": "#ffffff", "stroke_width": 2}` clips with `alpha` 0.6 (outer) down to 0.15 (inner).
2. Same opposite-direction `rotation` keyframes and swap timing (14 degrees over 12 f, text swap on f6).
3. Keep the rings out of the accent so the accent keeps its one meaning; no glow look.

**Full look** (relies on glow, gradient: only when the person's brand supplies that look):

1. Two ring groups, each a single outline clip holding 6-8 ellipses (rx about 47 % of the frame width, ry about 32 % of the height), one centred above the text band and one below: `add_type_block_tool {"block": "write_on", "paths": ["M 1023 270 a 903 346 0 1 0 0.1 0 Z", "..."], "view_box": [0, 0, 1920, 1080], "stroke_width": 2, "ink": "#ffffff", "position_seconds": 0, "duration_seconds": 8, "draw_seconds": 0.5}` for the upper group; the same for the lower group on the next track. Make the outer rings brighter and the inner ones fainter by splitting each group into two clips (outer at alpha 0.6, inner at 0.15 via `set_keyframes_tool`).
2. Turn the groups in opposite directions, drift 0.2 degrees per frame (12 degrees per second) plus a 14 degree whip over 12 f (0.2 s) on each swap: `set_keyframes_tool {"timeline_clip_id": "<upper_group>", "property": "rotation", "points": [{"seconds": 0, "value": 0}, {"seconds": 2.0, "value": 24}, {"seconds": 2.2, "value": 38, "ease": "ease_in_out_sine"}, {"seconds": 4.2, "value": 62}, {"seconds": 4.4, "value": 76, "ease": "ease_in_out_sine"}]}` and the same with negative values on `<lower_group>`.
3. Copy swaps hard on each whip's peak frame (swap start plus 6 f = 0.1 s): `add_kinetic_title_tool {"text": "Draft", "style": "documentary", "animation": "fade", "position_seconds": 0.5, "duration_seconds": 1.6}` then `{"text": "Cut", ... "position_seconds": 2.1, "duration_seconds": 2.2}` (the title stays static at the band's centre).
4. `add_sfx_tool {"recipe": "whoosh_short", "at_seconds": 2.0, "gain_db": -16}` at each whip.

Fallback: The soft-lit two-hue gradient strokes and inner blur of the full cinetic look are not available as strokes; the rings are crisp single-colour lines. This is also the ban-safe look.

## Timing & taste rules

- cinetic's timing (60 fps): Drift 0.2 degrees/f between swaps; whip +12-16 degrees over 12 f (0.20 s) on ease_in_out_sine (peak ~3 degrees/f, ~50 px/f at the outer rim); copy swaps every 60-120 f (2.00 s) on the whip's peak frame.
- Drift 0.2 degrees per frame between swaps; whip +12-16 degrees over 12 f (0.2 s, ease_in_out_sine), peak about 3 degrees per frame (about 50 px per frame at the outer rim).
- Copy swaps every 60-120 f (1-2 s), on the whip's peak frame; the text stays static.
- Opacity steps 0.6 on the outer ring to 0.15 nearest the band.
- No more than about 4 s of pure ambience.

## Sound for it

A short whoosh at each whip, peaking on the swap frame; nothing between swaps.

## Common mistakes

- UI demos, where it competes with the product.
- Light stages, where 2 px rings vanish.
- More than about 4 s of pure ambience with no copy change.
- Avoid when: UI demos, where it competes with the product; light stages, where 2 px rings vanish; more than ~4 s of pure ambience.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tx-ring-field`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
