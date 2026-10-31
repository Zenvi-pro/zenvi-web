---
id: shot-stroke-segment-build
kind: technique
summary: "When a name is a held-back reveal: a word built of 16 detached strokes lights in random order, readable only at the end."
categories: [movie-game-trailer, kinetic-type-motion-design, brand-story-corporate, science-curiosity]
tools: [add_motion_block_tool, add_kinetic_title_tool, add_sfx_tool]
pace: medium
mood: [suspenseful, neon, dramatic]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cinematic-silence-before-hit, kinetic-scramble-decode, cinematic-trailer-sound]
avoid_with: [kinetic-letter-cascade, shot-brand-ink-open]
needs: [segmented-stroke-reveal]
---

# Broken-stroke reveal

## What it is
A short word (4-6 letters the audience already knows) is split into ~16 detached neon strokes. They light in a scrambled order, so for ~70 % of the shot only mystery fragments
are visible; the last three key strokes drop in and the meaning snaps shut on one frame, the sign powers up, a surge, a held poster. The moment of recognition is the hook.

## Build it in Zenvi
No per-stroke build (`needs: segmented-stroke-reveal`). Nearest fallback keeps the idea: the meaning arrives late.
```json
add_motion_block_tool {"block": "text_scramble", "params": {"text": "LIVE", "glyphs": "blocks", "align": "center", "size": 200, "label": "", "highlight": false}, "position_seconds": 0.4, "duration_seconds": 5.0, "placement": "over_video"}
add_motion_block_tool {"block": "gradient_field", "params": {"style": "aurora", "colors": ["#1a0a2e", "#3a1250"], "speed": 0.2, "grain": true}, "position_seconds": 0, "duration_seconds": 5.4, "placement": "full_frame"}
add_kinetic_title_tool {"text": "LIVE", "style": "stack", "animation": "slam", "emphasis": "none", "ink": "#ff5ad0", "text_size": 0.3, "position_seconds": 3.5, "duration_seconds": 1.9}
```
(the block decodes left to right over its whole length and the glyph blocks make it unreadable early; give it 3.1 s and let the clean word slam in on the hit at 3.5 s). Better: draw the strokes yourself as 16 stills and key each one's `alpha` with `set_keyframes_tool` in a script (order below). A `glitch` FX on each is optional.

## Timing & taste rules
- Phases for 165 frames: dark wall 0-12; scrambled lighting 12-72 (13 strokes, gaps 9 -> 3 frames ease-out so it speeds up); hold-breath 72-86 (no new stroke, only a faint hum); key strokes at 86 / 93 / 99; reveal 105; hold to 165.
- Each stroke strikes in 7 frames with a flicker (on, off, on, half, on) then rests at 58 % brightness. At 80 % or brighter the reveal has no power-up contrast.
- Reveal: all strokes 0.58 -> 1.0 with a surge to 1.25, the sign's own glow swells once (no separate light blob), scale 1 -> 1.02 only.
- The key strokes (the pieces that make the word legible) go last; QA by looking at a mid frame: if you can guess the word, reorder.
- Unlit strokes are not rendered (not opacity 0). Wall light grows with the share of lit strokes (0.12 + 0.5 x share).
- The word must be known (a product, SHIP, LIVE); invented words have no recognition. 4-6 letters is the limit.

## Sound for it
A sparse electrical `glitch_burst` tick per stroke with a falling level (-26 to -18), only a low hum in the held breath, `impact_slam` (-6) on the reveal and a `riser_noise` ending there.

## Common mistakes
- Lighting in reading order (no suspense).
- Leaving the headline glow as a separate blob in the letter gaps.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/opening/stroke-segment-build.md` (Apache-2.0; see ../NOTICE).
