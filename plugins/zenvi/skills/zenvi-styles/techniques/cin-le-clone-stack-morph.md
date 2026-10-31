---
id: cin-le-clone-stack-morph
kind: technique
summary: "When a big brand shape must become the CTA container: it collapses to a pill and leaves stepped echoes of its edges."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_type_block_tool, set_keyframes_tool, copy_clip_keyframes_tool, duplicate_clips_tool, add_title_tool, add_sfx_tool]
pace: medium
mood: [mechanical, engineered]
aspect: ["16:9", "1:1"]
pairs_with: [cin-le-living-hold, t069]
avoid_with: [cin-le-accordion-cta-collapse]
needs: []
drawn: cinetic
---

# Staircase echo shape morph

cinetic `le-clone-stack-morph` · Logo and end card · accent · energy medium · formats launch, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A large brand shape collapses into a slim pill around the URL, and mid-morph its moving edges show stepped echoes from staggered copies, like a mechanical transformation.

Use when: Turning a big brand shape or frame into the CTA container. Mechanical, engineered or developer-tool brands. One moment that should feel designed rather than tweened.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same shape and collapse, 7 echoes as plain 1.5 px strokes in one tonal step of the stage colour, opacity falling linearly.
2. No rim light, bloom or coloured edges on the copies; skip any `apply_fx_tool` glow.

**Full look** (relies on glow: only when the person's brand supplies that look):

1. The big shape: `add_type_block_tool {"block": "write_on", "paths": ["M0 0 H300 V150 H0 Z"], "fill": true, "ink": "#1d1f24", "width": 0.98, "draw_seconds": 0.1, "x": 0.5, "y": 0.5, "position_seconds": 2.0, "duration_seconds": 4.0}` on track 3.
2. Collapse into the pill over 48 f (0.8 s): `set_keyframes_tool {"timeline_clip_id": "<shape>", "property": "scale_y", "ease": "ease_in_out_sine", "points": [{"seconds": 2.0, "value": 1.0}, {"seconds": 2.8, "value": 0.23}]}` and `scale_x` 1.0 to 0.53 (983 to 227 px high, 1878 to 997 px wide); a pill needs an outline path with rounded ends, so use a pill path for the end state and crossfade the last 4 f.
3. Seven echoes: `duplicate_clips_tool {"timeline_clip_ids": ["<shape>"], "copies": 7, "to_track": "2"}`, switch each to a 1.5 px stroke (`fill` false) with `alpha` 0.6 x (1 - k/9), then `copy_clip_keyframes_tool {"source_clip_id": "<shape>", "timeline_clip_ids": ["<echo_k>"], "timing": "offset"}` delayed 2k f (0.033 k s) so copy k follows the leader k x 2 frames later.
4. URL swaps in at the morph start (8 f fade, 0.13 s): `add_title_tool {"text": "zenvi.com", "template": "Standard_1", "position_seconds": 2.0, "duration_seconds": 3.0, "fade_in_seconds": 0.13, "track": "5"}`; it stays still after the pill lands.
5. `add_sfx_tool {"recipe": "whoosh_short", "at_seconds": 2.0, "gain_db": -16}`.

Fallback: If the keyframe copy with a delay is not accepted, offset each echo with `move_clips_tool` by the same 2 f steps and keyframe it by hand; do not shorten below 7 copies.

## Timing & taste rules

- cinetic's timing (60 fps): Morph: 48 f (0.80 s) on ease_in_out_sine, height 983 -> 227 px (edge peak ~22 px/f), width 1878 -> 997 px with a long tail. 7 copies at a 2 f (0.03 s) delay each (14 f (0.23 s) of echo after the leader stops). The URL stays readable for at least 102 f (1.70 s) afterwards, under the card's 10-15% push (le-living-hold).
- Morph 48 f (0.8 s) ease_in_out_sine, edge peak about 22 px/f; width 1878 to 997 px, height 983 to 227 px.
- 7 echoes each delayed 2 f (0.033 s): 14 f (0.23 s) of staircase after the leader stops, then they coincide and vanish.
- URL readable at least 102 f (1.7 s) after, under a 10-15 % push.
- Moves under about 150 px: the echoes collapse into a smear.

## Sound for it

One short whoosh as the morph starts; nothing on the echoes.

## Common mistakes

- Short moves (under about 150 px) where the echoes smear.
- Elements that already carry motion blur: double trails.
- More than once per film.
- Avoid when: Short moves (under ~150 px the echoes collapse into a smear). Elements that already carry motion blur (double trails). More than once per film.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`le-clone-stack-morph`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
