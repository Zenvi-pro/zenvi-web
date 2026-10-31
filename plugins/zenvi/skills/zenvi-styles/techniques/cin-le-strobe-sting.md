---
id: cin-le-strobe-sting
kind: technique
summary: "When a loud sign-off follows a quiet end card: brand states hard-cut past in under a second, ending on the glyph."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting]
tools: [add_type_block_tool, add_clip_to_timeline_tool, add_sfx_tool]
pace: frantic
mood: [loud, playful]
aspect: ["16:9", "1:1", "9:16"]
pairs_with: [kinetic-beat-strobe]
avoid_with: [cin-le-living-hold, blackout-and-dead-silence-pause]
needs: [grid-cell-reflow]
drawn: cinetic
---

# Stop-motion brand strobe

cinetic `le-strobe-sting` · Logo and end card · accent · energy high · formats sting, launch, loop, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A burst of hard-cut brand states (the poster, the lockup tiled in ever denser grids, one flood, the boxed wordmark, the glyph) flickers past in under a second as a punchy sign-off.

Use when: Social stings and launch films with a poster-driven or stop-motion identity. A re-energising coda after a quiet end card. Autoplay loops that need a clean reset point.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same strobe block, but replace the cream flood with the film's single accent flood (or the stage's darker step) as the only bright state and keep all others on the dark stage.
2. The strobe changes shape and density rather than luminance: one bright state, no more.

**Full look** (relies on beige: only when the person's brand supplies that look):

1. After the lockup's hold (at least 1.5 s), cut through full-frame states: `add_type_block_tool {"block": "strobe", "text": "ZENVI", "words": ["ZENVI", "ZENVI", "ZENVI", "ZENVI", "ZENVI", "ZENVI"], "hold_frames": 5, "lockup": "ZENVI", "layouts": ["fit", "bleed", "outline", "mirror", "tall", "stack"], "ground": "#101010", "ink": "#ffffff", "accent": "#ff3b1f", "position_seconds": 5.0}`.
2. The poster state first (7 f, 0.12 s) and the grids of 3, 4, 5 columns: lay the lockup tile with `add_clip_to_timeline_tool` x 9-25 only if needed; hold times in frames 7, 5, 5, 2, 2, 5, 5, 5, 7 (43 f, 0.72 s) by trimming each state.
3. Keep every state on the same dark stage with the accent flood as the only bright state: no more than 3 large light-dark flips per second (leave `allow_strobe` false).
4. End on the glyph alone for at most 30 f (0.5 s), about 2 % of height; export the poster from the lockup frame.
5. A tick cluster under it: `add_sfx_tool {"recipe": "hit_transient", "at_seconds": 5.0, "gain_db": -14}` on each state change at -22 dB.

Fallback: Tiled grid states of the lockup are not a block layout; the strobe block's layouts (fit, bleed, outline, mirror, tall, stack) stand in for the density steps.

## Timing & taste rules

- cinetic's timing (60 fps): Holds 7, 5, 5, 2, 2, 5, 5, 5, 7 f (43 f (0.72 s), ~0.72 s). Glyph ~2% of H, centred, for at most 30 f (0.50 s). A tick cluster under it that matches the opening's sound.
- Holds 7, 5, 5, 2, 2, 5, 5, 5, 7 f = 43 f (0.72 s).
- Grids n = 3, 4, 5, 5 columns with a half-tile offset on alternate states, so the cuts read as a stepped pull-back.
- Large light-dark flips at most 3 per second; glyph about 2 % of height centred for at most 30 f (0.5 s).
- Quiet version: keep only the last two states (boxed name 5 f, glyph 7 f) as a loop point.

## Sound for it

Tick cluster on state changes matching the opening's sound, -22 dB; one hit on the glyph.

## Common mistakes

- Calm or premium brands.
- Any film where large light-dark flips cannot stay under 3 per second (photosensitivity).
- Cutting the lockup's hold below 1.5 s to fit it.
- Avoid when: Calm or premium brands. Any film where you cannot keep large light-dark flips under 3 per second (photosensitivity). Any case where it would cut the lockup's hold below 1.5 s.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`le-strobe-sting`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
