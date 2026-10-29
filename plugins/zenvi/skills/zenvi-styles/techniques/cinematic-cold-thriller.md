---
id: cinematic-cold-thriller
kind: technique
summary: When the tone is suspense, crime, tech dread or a cold city - steel teal, low saturation, hard contrast, clean blacks.
categories: [movie-game-trailer, documentary-true-story, tech-review, gaming-montage, automotive-ad]
tools: [unify_grade_tool, color_grade_clip_tool, add_vignette_tool]
pace: medium
mood: [tense, cold, clinical, ominous]
aspect: ["16:9", "2.39:1", "9:16"]
pairs_with: [cinematic-anamorphic-letterbox, cinematic-silence-before-hit, cinematic-trailer-sound, cinematic-rack-focus, cinematic-push-in]
avoid_with: [cinematic-warm-nostalgia, cinematic-teal-orange, cinematic-light-leak, cinematic-halation-bloom]
needs: []
---

# Cold thriller grade

## What it is

The look of modern suspense: everything pulled toward steel blue-teal, skin desaturated but not
grey, contrast hard, whites cool. It makes offices, streets and screens feel watched. Shines in
thriller and crime trailers, cyber/tech stories, true crime openers.

## Build it in Zenvi

1. `unify_grade_tool` `{"look": "icy_drama", "look_intensity": 0.85, "strength": 0.8}`. Other LUTs:
   `cold_shadows`, `cool_haze`, `spy_night`, `teal_horror` (darker).
2. Push it on the same clips: `color_grade_clip_tool` `{"timeline_clip_ids": [...], "contrast": 0.3,
   "saturation": 0.5, "temperature": -0.45, "wheels": {"shadows": {"color": "#0f3a4a", "amount": 0.25},
   "highlights": {"color": "#cfe6ff", "amount": 0.1}}}`.
3. `add_vignette_tool` `{"amount": 0.3, "feather": 0.9}`.

## Timing & taste rules

- Saturation 0.45-0.6; under 0.4 it turns into black and white with a tint.
- Leave one warm element if the story needs it (a lamp, a screen, blood); it becomes the accent.
- Vignette `feather` 0.85+; with lower feather the oval edge shows on flat walls.
- Works best with slow push-ins and long holds; at hype cut rates use bleach bypass instead.

## Sound for it

Low drones, sub pulses, clock ticks, distant city; dry hits. `cinematic-silence-before-hit` is
its natural partner.

## Common mistakes

- A blue LUT alone: green offices stay green (the second, wheel-based pass is what makes it cold).
- Crushing blacks to zero on night streets (detail vanishes; keep shadows at 3-6 %).

## Verified

2026-10-28, `tech/cold-thriller` (night street timelapse, a man asleep at an office desk, an eye;
7.5 s 720p24). First pass (LUT + temperature only) left the desk green and the vignette oval;
with the wheel pass and feather 0.9 the three read as one cold set. Watch judge (abs):
grade 5/10, overall 4.45, "the cold, desaturated thriller grade successfully links the disparate
shots into a cohesive moody atmosphere".
