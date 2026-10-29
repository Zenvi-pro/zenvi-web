---
id: cinematic-warm-nostalgia
kind: technique
summary: When the edit is memory (weddings, family, travel diaries, origin stories) - golden film colour, Super 8 grain.
categories: [wedding-event-film, travel-cinematic-montage, brand-story-corporate, music-lyric-video, documentary-true-story]
tools: [add_sfx_tool, add_shape_mask_tool, apply_look_tool, apply_fx_tool, add_vignette_tool, unify_grade_tool]
pace: calm
mood: [nostalgic, warm, tender, hopeful]
aspect: ["16:9", "4:3", "9:16"]
pairs_with: [cinematic-light-leak, cinematic-film-emulation, cinematic-j-l-cut, cinematic-title-sequence]
avoid_with: [cinematic-teal-orange, cinematic-cold-thriller, cinematic-bleach-bypass, cinematic-day-for-night]
needs: []
---

# Warm nostalgia

## What it is

Home-movie warmth: faded golden colour, lifted blacks, coarse grain, soft corners and
an occasional warm light leak. Shines for memories, weddings, summer travel and
"where it all began" brand stories.

## Build it in Zenvi

1. Mixed cameras only: `unify_grade_tool` `{"strength": 0.7}` first (they warm up unevenly otherwise).
2. `apply_look_tool` `{"clip_ids": "all", "look_id": "golden_years_film", "lut_intensity": 0.8,
   "stack_grain": true, "grain_preset": "super_8"}`. Alternatives: `faded_memories`,
   `vintage_400_film`, `warm_roast_film`; grain `16mm_classic` for a cleaner memory.
3. One leak every 6-10 s, on a shot with sky or window light:
   `apply_fx_tool` `{"clip_id": "<id>", "effects": [{"effect": "light_leak", "amount": 0.45,
   "params": {"style": "leak", "color": "#ff9a3c", "seed": 3}}]}` (vary `seed`).
4. `add_vignette_tool` `{"amount": 0.25, "feather": 0.9}` (over 0.3 or under 0.85 feather the oval shows).

## Timing & taste rules

- Footage that is already warm (tungsten interiors, sunsets) gets `lut_intensity` 0.5 or it
  turns solid orange; check the warmest shot.
- Leaks 0.3-0.5 amount, at most one per 6 s; a leak on every shot is a filter, not a memory.
- Shots hold 2-4 s; dissolves are fine here (0.5-1 s), whips are not.
- Optional 4:3 window (`add_shape_mask_tool` rectangle `width` 0.75) for a home-movie frame.

## Sound for it

Music-led, soft; projector flutter or room tone under the opening (`add_sfx_tool`
`room_tone`, gain -24 dB); voices and ambience carried across cuts (`cinematic-j-l-cut`).

## Common mistakes

- Full-strength LUT on warm shots (orange skin, lost detail).
- Super 8 grain on a 4K hero product: nostalgia and product sharpness fight; use `35mm_fine`.

## Verified

2026-10-28, `tech/warm-nostalgia` (riders, a man on a beach, a man asleep in tungsten light;
7.5 s 720p24). Golden film colour, grain and the leak on the beach shot read as a memory;
the tungsten shot went fully orange (rule 1). Watch judge (abs): grade 4/10, "warm vintage
film emulation with light leaks and grain captures the intended retro aesthetic well".
