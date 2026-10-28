---
id: kinetic-title-sequence
kind: technique
summary: "When an edit opens like a film: restrained credits over picture, then the title card on black with a boom."
categories: [movie-game-trailer, documentary-true-story, wedding-event-film, travel-cinematic-montage, automotive-ad, sports-hype-edit, fashion-beauty-ad, video-essay-explainer]
tools: [add_kinetic_title_tool, add_title_tool, fade_clip_tool, add_sfx_tool]
pace: calm
mood: [cinematic, moody, restrained]
aspect: ["16:9", "2.39:1", "9:16"]
pairs_with: [kinetic-mask-reveal, kinetic-3d-title, kinetic-stencil-reveal, kinetic-quote-card]
avoid_with: [kinetic-word-pop, kinetic-beat-strobe, kinetic-emphasis-scale]
needs: []
---

# Title sequence / restrained title card

## What it is
Small light credits (3.5-9 % of frame height, serif or thin sans) over 2-6 s shots with slow fades, then the title on
black, held 2-3 s, dissolving or cutting into picture. Also hard-cut chapter cards (14-24 % caps on a downbeat).

## Build it in Zenvi
```json
add_kinetic_title_tool {"text": "a film by Ines Marlow", "style": "documentary", "animation": "fade", "text_size": 0.04, "y": 0.82,
  "position_seconds": 0.5, "duration_seconds": 1.8}
add_kinetic_title_tool {"text": "music by Tomas Reyes", "style": "documentary", "animation": "fade", "text_size": 0.04, "y": 0.82,
  "position_seconds": 3.0, "duration_seconds": 1.8}
add_kinetic_title_tool {"text": "NIGHTSHIFT", "style": "editorial", "animation": "rise", "emphasis": "none", "text_size": 0.16,
  "background": "#000000", "position_seconds": 7, "duration_seconds": 2.5}
add_sfx_tool {"recipe": "impact_boom", "at_seconds": 7, "gain_db": -10}
add_sfx_tool {"recipe": "reverse_swell", "at_seconds": 7, "gain_db": -14}
```
Chapter cards: kinetic-keyword-slam with `style: "stack"` and a flat `background`. Desktop-native single title:
`add_title_tool` + `fade_clip_tool`.

## Timing & taste rules
- Credits 1.5-2.5 s each, one per shot, same spot, same size; never over the subject's face.
- Title 2-3 s; the first frame after it is a strong wide.
- Pace is set by the shots (2-6 s each); no flashes, no whooshes.
- One face family (serif) for everything, title in caps with tracking, credits sentence case.

## Sound for it
Music or ambience only under the credits; a reverse swell into a low boom on the title (-10 dB), then silence or the
theme. CRAFT: hero hit -10 LUFS momentary.

## Common mistakes
- Credits in the display face or with pops (it stops being restrained).
- Title card on black without sound: it reads as a gap.

## Verified
VERIFIED:kinetic-title-sequence
