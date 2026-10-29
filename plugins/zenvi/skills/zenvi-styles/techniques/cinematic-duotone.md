---
id: cinematic-duotone
kind: technique
summary: When a section must look designed and graphic - two inks replace all colour; for openers, chapters and poster frames.
categories: [music-lyric-video, fashion-beauty-ad, brand-story-corporate, movie-game-trailer, kinetic-type-motion-design]
tools: [apply_look_tool, list_looks_tool]
pace: medium
mood: [graphic, stylish, bold, editorial]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cinematic-title-sequence, cinematic-film-emulation, cinematic-push-in, cinematic-montage-rhythm]
avoid_with: [cinematic-teal-orange, cinematic-bleach-bypass, cinematic-warm-nostalgia, cinematic-day-for-night]
needs: []
---

# Duotone

## What it is

A gradient map: shadows become one ink, highlights another, everything in between a
mix. It turns unrelated stock into one designed set. Shines in title sequences,
chapter openers, music videos and brand films that own two colours.

## Build it in Zenvi

1. `list_looks_tool` `{"vibe": "duotone"}`: `duotone_teal_peach`, `duotone_blue_orange`,
   `duotone_navy_red`, `duotone_purple_lime`, `duotone_ink_cream`, `duotone`.
2. `apply_look_tool` `{"clip_ids": "<ids or all>", "look_id": "duotone_teal_peach"}`.
   A brand pair: `"look_id": "duotone #0b1638 #ff3b3b"` (shadow ink first).
3. Optional print texture: add `"stack_grain": true, "grain_preset": "35mm_fine"` to the step 2 call.

## Timing & taste rules

- Dark ink must be dark (luma under 20 %) or the image loses its shape; the light ink
  carries the brand colour.
- Works best on high-contrast silhouettes; flat grey footage turns to mush - check one frame first.
- Use on a whole section (4-12 s) or alternate duotone/full-colour by section, not shot by shot.
- Titles over duotone: set type in the light ink or pure white, never a third colour.

## Sound for it

Follows the music; a soft `pop` or `whoosh_short` on section changes into/out of the duotone.

## Common mistakes

- Two mid-tone inks (no contrast, the picture disappears).
- Duotone on faces in a story film (people look ill); keep it for graphic moments.

## Verified

2026-10-28, `tech/duotone` (three shots of a man in a lake / on a beach, 7.5 s 720p24),
`duotone_teal_peach`. Silhouettes against the sky read cleanly; the reflection shot of
the frame on water is too flat and goes muddy (rule 2). Watch judge (abs): grade 5/10,
"duotone palette establishes an intriguing, moody aesthetic across the clips".
