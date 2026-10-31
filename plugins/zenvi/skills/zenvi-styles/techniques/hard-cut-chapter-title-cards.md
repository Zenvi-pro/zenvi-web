---
id: hard-cut-chapter-title-cards
kind: technique
summary: "When a piece has 3-5 parts: full-frame colour cards with one huge caps word, hard cut in on a downbeat with a hit."
categories: [food-recipe, gaming-montage]
tools: [add_kinetic_title_tool, add_sfx_tool, add_title_tool, apply_motion_transition_tool, detect_beats_tool]
pace: fast
mood: [bold, playful, structured]
aspect: ["9:16", "16:9", "1:1", "4:5"]
pairs_with: [overhead-hands-only-recipe-overlays, blackout-and-dead-silence-pause, accelerating-cut-length-ramp]
avoid_with: [soft-bloom-lifted-shadow-grade, negative-space-chapter-breath]
needs: [cutout-title-reveal]
---

# Hard-cut chapter title cards

## What it is
PREP / COOK / PLATE: a flat colour card with one condensed capital word at
14-24 % frame height, 1-3 s, cut in hard on a downbeat with a hit, then the
chapter's footage. Structure you can see.

## Build it in Zenvi
```json
add_kinetic_title_tool {"text": "PREP", "position_seconds": "<t>", "duration_seconds": 1.0,
  "style": "stack", "animation": "slam", "background": "#d4141c", "text_size": 0.2}
add_sfx_tool {"recipe": "impact_slam", "at_seconds": "<t>", "gain_db": -10, "seed": 1}
```
then the chapter's shots from `t + 1.0`. One colour per chapter from the piece's
palette. Snap `t` to a downbeat (`detect_beats_tool` on the music).
The stencil version (word cut out of white card, colour showing through, soft
shadow) needs `cutout-title-reveal`; fallback: the colour card as above.

## Timing & taste rules
- 1.0-1.5 s for a fast piece, 2.4-3.2 s for a calm film.
- 14-24 % frame height; a single word or two; one face (Bebas/Anton).
- 3-5 cards per piece; the same layout every time, only colour and word change.

## Sound for it
A slam or punch on the card at -10 dB (hero level), music hits its downbeat
there; a short `whoosh_short` out is optional.

## Common mistakes
- A static card with no entrance (the judge's top note): `slam` or `pop`.
- Cards that do not match the footage grade family.
- Different fonts per card.

## Verified
2026-10-28: 7.8 s test, three cards (red PREP, yellow COOK, green PLATE) with
slams, each followed by a 1.6 s shot. Contact sheet: clean full-frame cards,
words centred. Watch judge typography 6, overall 5.18 (third best); fixes: more
card motion and a closing beat.
