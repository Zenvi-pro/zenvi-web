---
id: cinematic-day-for-night
kind: technique
summary: When a scene must be night but the footage is day - cool, underexposed, desaturated moonlight; pick shots without sky.
categories: [movie-game-trailer, music-lyric-video, documentary-true-story, gaming-montage]
tools: [color_grade_clip_tool, inspect_color_tool]
pace: calm
mood: [mysterious, nocturnal, quiet, ominous]
aspect: ["16:9", "2.39:1", "9:16"]
pairs_with: [cinematic-cold-thriller, cinematic-anamorphic-letterbox, cinematic-trailer-sound]
avoid_with: [cinematic-teal-orange, cinematic-warm-nostalgia, cinematic-light-leak, cinematic-halation-bloom]
needs: []
---

# Day for night

## What it is

The old film trick of shooting in daylight and grading it into moonlight: underexposed by about
two thirds of a stop, pulled hard to blue, desaturated, highlights held down. Shines on water,
foliage, rocks, roads seen from above, silhouettes; the sky is what gives it away.

## Build it in Zenvi

`color_grade_clip_tool` `{"timeline_clip_ids": [...], "reset": true, "exposure": -0.6,
"temperature": -0.9, "tint": 0.03, "saturation": 0.3, "highlights": -0.6, "shadows": 0,
"contrast": 0.15, "wheels": {"global": {"color": "#2a4f9e", "amount": 0.12},
"highlights": {"color": "#bcd0ff", "amount": 0.1}}}`.
Check with `inspect_color_tool`: mean luma 15-30 %, nothing above ~75 %.

## Timing & taste rules

- Choose shots with no sky, or with the sun behind the subject (backlit rim reads as moonlight).
- Exposure -0.5 to -0.8; at -1.1 with a crushing curve it turns to mud (the first test).
- No vignette at these levels (it reads as a black oval); keep shadows at 3-6 %, not 0.
- Keep the same values on every shot of the scene; vary only exposure.

## Sound for it

Night sound sells it: crickets/room tone, distant traffic, a low drone (`room_tone` -28 dB);
no birdsong.

## Common mistakes

- Bright daylit skies and green fields (instantly reads as a dark day).
- Practical lights that are off: real night has some warm sources; this look has none, so keep
  it to landscapes and silhouettes.

## Verified

2026-10-28, `tech/day-for-night`. Pass 1 (exposure -1.3, vignette 0.5) on a sunny aerial and a
road: the contact sheet read as a dark day with green fields. Pass 2 (-1.1 + a crushing curve,
vignette 0.3): judge grade 2/10, "crushing shadow details into pure mud ... heavy vignette". Pass 3 (the values above, no vignette, top-down surf and a fern - no sky):
grade 6/10, overall 4.1, "a moody, desaturated cool-toned moonlight aesthetic across both shots".
