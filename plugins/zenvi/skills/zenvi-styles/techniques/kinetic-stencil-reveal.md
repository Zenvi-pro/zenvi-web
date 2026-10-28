---
id: kinetic-stencil-reveal
kind: technique
summary: "When the title should be a window into the shot: footage shows only inside the letters, then opens out."
categories: [food-recipe, gaming-montage, travel-cinematic-montage, movie-game-trailer, sports-hype-edit, brand-story-corporate]
tools: [add_title_tool, set_clip_properties_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [bold, cinematic, graphic]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-title-sequence, kinetic-keyword-slam, kinetic-3d-title]
avoid_with: [kinetic-text-behind-subject, kinetic-echo-stack]
needs: [cutout-title-reveal]
---

# Stencil reveal (footage inside the letters)

## What it is
A black (or flat colour) frame with the title cut out of it; the shot plays through the letters, the letters push in,
then the stencil opens out to the full shot. Chapter opens, recipe titles, game title cards.

## Build it in Zenvi
No one-call tool (`needs: cutout-title-reveal`, no cast shadow on the hole). Fallback that verifies: one white-on-black
title image multiplied over the footage (white × shot = shot, black × shot = black):
```json
add_title_tool {"template": "Standard_1", "text": "BLOOM", "font": "Arial Black", "font_weight": "bold", "font_scale": 3.6,
  "text_color": "#ffffff", "background_color": "#000000", "position_seconds": 0, "duration_seconds": 2.6}
set_clip_properties_tool {"timeline_clip_ids": ["<title clip>"], "properties": {"composite": "multiply"}}
set_keyframes_tool {"timeline_clip_id": "<title clip>", "property": "scale_x", "points": [{"seconds": 0, "value": 1}, {"seconds": 2.2, "value": 1.15}, {"seconds": 2.6, "value": 6}]}
set_keyframes_tool … same points for scale_y
add_sfx_tool {"recipe": "whoosh_rise", "at_seconds": 2.6}
```
It must be **one** title image (add_title_tool with `background_color`): add_kinetic_title_tool's `background` is a
separate card clip, and multiplying separate clips just gives black.

## Timing & taste rules
- Heaviest face available (Arial Black / Anton), the word ≥ 60 % of the frame width, 1 word.
- The shot inside must be bright and readable at letter size (a lit subject, colour); night footage reads as black.
- Push 1.0 → 1.15 over the hold, then open (scale to 6x) in 0.3-0.4 s on a beat.

## Sound for it
A rising whoosh into the open, a hit or the music's downbeat on the full shot.

## Common mistakes
- Dark footage inside the letters (nothing reads).
- A thin face: the window is too small to see the shot.

## Verified
VERIFIED:kinetic-stencil-reveal
