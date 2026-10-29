---
id: cinematic-halation-bloom
kind: technique
summary: When highlights should glow like film or a dream - headlights, stage lights, sun on water bloom and bleed warm.
categories: [automotive-ad, music-lyric-video, wedding-event-film, movie-game-trailer, fashion-beauty-ad, travel-cinematic-montage]
tools: [apply_fx_tool, update_fx_tool, color_grade_clip_tool]
pace: medium
mood: [dreamy, glossy, nocturnal, romantic]
aspect: ["16:9", "9:16", "2.39:1"]
pairs_with: [cinematic-film-emulation, cinematic-anamorphic-letterbox, cinematic-teal-orange, cinematic-warm-nostalgia]
avoid_with: [cinematic-bleach-bypass, cinematic-cold-thriller]
needs: []
---

# Halation and bloom

## What it is

Bright sources spill light into their surroundings: bloom is the soft glow, halation the warm
red-orange fringe film adds around hard highlights. It makes night footage expensive and day
footage dreamy. Shines on headlights, practicals, stage lights, candles, sun glints.

Related shot cards: `shot-light-play-moves`, `shot-spotlight-sweep-moves`.

## Build it in Zenvi

1. `apply_fx_tool` `{"clip_id": "<id>", "effects": [{"effect": "bloom", "amount": 0.6,
   "params": {"threshold": 0.6, "radius": 0.6}}]}` (ffmpeg render, one undo step; `radius` is 0-1).
2. Halation tint: `color_grade_clip_tool` `{"timeline_clip_ids": [...], "wheels": {"highlights":
   {"color": "#ff7a4a", "amount": 0.1}}, "shadows": 0.05}` - warms only what blooms.
3. Retune later: `update_fx_tool` on the same clip (the FX stack is kept on the clip).
4. Subtle film halation inside `cinematic-film-emulation`: amount 0.3, threshold 0.72, radius 0.35.

## Timing & taste rules

- Night: amount 0.4-0.6, threshold 0.6-0.7. Day: amount 0.2-0.3, threshold 0.75+ (or the sky blooms).
- Only on shots with distinct light sources; on flat grey shots bloom is just haze.
- Same settings across a sequence; a glow that changes shot to shot reads as a mistake.
- Render cost: one ffmpeg pass per clip - apply after the cut is locked.

## Sound for it

None of its own.

## Common mistakes

- Threshold under 0.5: the whole frame lifts and contrast dies.
- Bloom plus a heavy light leak on the same shot (the image whites out).

## Verified

2026-10-28, `tech/halation-bloom` (concert stage, night car with headlights; 6 s 720p24). Stage
lights and headlights glow with a warm edge, blacks stay. Watch judge (abs): overall 4.55,
"the bloom on the car headlights effectively demonstrates warm highlight diffusion" (it marked
down the low-resolution concert stock, not the effect).
