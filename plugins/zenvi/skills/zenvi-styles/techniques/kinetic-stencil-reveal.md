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
A black (or flat colour) frame with the title cut out of it; the shot plays through the letters while they push in,
then a cut on the beat to the full shot. Chapter opens, recipe titles, game title cards.

## Build it in Zenvi
No one-call tool (`needs: cutout-title-reveal`, no cast shadow on the hole). Fallback that verifies: one white-on-black
title image multiplied over the footage (white × shot = shot, black × shot = black):
```json
add_title_tool {"template": "Standard_1", "text": "BLOOM", "font": "Arial Black", "font_weight": "bold", "font_scale": 2.5,
  "text_color": "#ffffff", "background_color": "#000000", "position_seconds": 0, "duration_seconds": 2.6}
set_clip_properties_tool {"timeline_clip_ids": ["<title clip>"], "properties": {"composite": "multiply"}}
set_keyframes_tool {"timeline_clip_id": "<title clip>", "property": "scale_x", "points": [{"seconds": 0, "value": 1}, {"seconds": 2.6, "value": 1.12}]}
set_keyframes_tool {"timeline_clip_id": "<title clip>", "property": "scale_y", "points": [{"seconds": 0, "value": 1}, {"seconds": 2.6, "value": 1.12}]}
add_sfx_tool {"recipe": "impact_punch", "at_seconds": 2.6}
```
It must be **one** title image (add_title_tool with `background_color`): add_kinetic_title_tool's `background` is a
separate card clip, and multiplying separate clips just gives black.

## Timing & taste rules
- Heaviest face available (Arial Black / Anton), the word ≥ 60 % of the frame width, 1 word.
- The shot inside must be bright and readable at letter size (a lit subject, colour); night footage reads as black.
- Push 1.0 → 1.12 over the hold, then **cut** to the full shot on a beat. Scaling the stencil up to "open" it (1.15 → 6x
  in 0.4 s, with or without an alpha fade) was tried and judged a cheap linear zoom (2.4-2.8/10): a real iris/expand
  needs the missing tool.

## Sound for it
A hit (or the music's downbeat) on the cut to the full shot; a low riser under the hold if the bed is quiet.

## Common mistakes
- Dark footage inside the letters (nothing reads).
- A thin face: the window is too small to see the shot.

## Verified
2026-10-28, CLI (`zenvi call`, this branch) on Pexels bench footage / generated media: `scripts/kinetic-stencil-reveal.sh` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/skk-kinetic/`, local only) → `techniques/kinetic-stencil-reveal.mp4` and its contact sheet. Checked on the sheet: lilies show only inside BLOOM on black, slow push, then a cut to the full shot. Two 'open' variants (scale to 6x; scale + fade) were judged a cheap zoom (2.5, 2.8), so the cut is what is documented. Watch judge (absolute, isolated 3-5 s test): **3.6/10** overall, typography 5; its main note: "The transition from the letterbox mask to full screen is abrupt and lacks fluid motion polish.".
