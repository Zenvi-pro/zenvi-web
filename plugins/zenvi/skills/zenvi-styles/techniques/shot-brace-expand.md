---
id: shot-brace-expand
kind: technique
summary: "When a technical title should be unwrapped: a tiny pair of braces springs open once and reveals the text between."
categories: [kinetic-type-motion-design, saas-app-launch, tech-review, product-launch-film, animated-explainer]
tools: [add_kinetic_title_tool, get_clip_properties_tool, add_effect_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [technical, crisp, developer]
aspect: ["16:9", "1:1"]
pairs_with: [kinetic-scramble-decode, kinetic-typewriter, shot-blur-slide]
avoid_with: [kinetic-word-pop, kinetic-beat-strobe, kinetic-letter-cascade]
needs: [bracket-curtain-reveal]
---

# Brace-expand title

## What it is
A caret blinks in the centre, a pair of small touching braces replaces it, then the braces spring apart to the sides, growing to
title size, and the text is uncovered from the middle outward exactly as far as the braces have travelled, like a curtain pulled
open. After the settle the letter-spacing relaxes a touch. One symbol does the whole reveal. Code-adjacent product titles, chapter openers.

## Build it in Zenvi
No block draws this, so build it from three native titles; the text's reveal width must be tied to the brace positions (`needs: bracket-curtain-reveal` for the one-click version).
```json
add_kinetic_title_tool {"text": "{", "style": "documentary", "animation": "fade", "ink": "#4f8bff", "text_size": 0.3, "y": 0.5, "position_seconds": 0.1, "duration_seconds": 3.6}
add_kinetic_title_tool {"text": "}", ... same ...}
add_kinetic_title_tool {"text": "ship the shot", "style": "documentary", "animation": "fade", "ink": "#ffffff", "text_size": 0.16, "y": 0.5, "position_seconds": 0.1, "duration_seconds": 3.6}
get_clip_properties_tool {"timeline_clip_id": "<text>"}      (base scale s0 and location x0, to turn frame fractions into crop fractions)
add_effect_tool {"timeline_clip_id": "<text>", "effect": "Crop", "properties": {"left": [{"time": 0.43, "value": 0.46}, {"time": 0.7, "value": 0.05}], "right": [same mirrored]}}
set_keyframes_tool {"timeline_clip_id": "<left brace>", "property": "location_x", "ease": "ease_out_back", "points": [{"seconds": 0.43, "value": -0.02}, {"seconds": 0.7, "value": -0.43}]}
```
The right brace mirrors it. Both braces and the crop edge use the same two times and the same `ease_out_back`, so the text edge never lags a brace.
Scale the braces from 0.4 to 1 over the same window (keyframe scale_x/scale_y, compensating the position as in shot-lead-word-zoom-assemble). The braces are visible 6 frames (0.2 s) before the move; hold them touching for 8 frames first.
```json
add_sfx_tool {"recipe": "toggle", "at_seconds": 0.43, "gain_db": -14}
```

## Timing & taste rules
- Caret 0 to 6 frames, then a hard cut (not a fade) to the touching braces at 0.4x, hold 8 frames, then open.
- Spring open: reaches the edge in about 8 frames, peaks ~9 % past at frame 11, settles by frame 24 (damping 14, stiffness 130 in the source). One visible rebound only; stiffer reads as a slide, softer wobbles twice (jelly).
- This is the only overshoot in the shot; no other element bounces.
- The text must fit the opened gap (about 1224 of 1920 px, 64 % of the width); a text much narrower shows whole before the braces arrive, a wider one is clipped.
- After the settle (frames 40-64) relax tracking from -0.05 em to -0.03 em: the text takes a breath.
- Subtitle after the settle (frame 44 on), 70 % of the shot, a slow 1.0 to 1.012 push on the whole frame.

## Sound for it
One short mechanical / wooden open click on the move (-14 dB); silence after the settle.

## Common mistakes
- Letting the text fade or wipe on its own: the braces become decoration and the curtain feeling is gone.
- Separate scale curves for braces and text (the braces land, the text is still growing).
- A long or off-centre sentence: it uncovers from the centre, so the visual weight must be central.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/typography/brace-expand.md` (Apache-2.0; see ../NOTICE).
