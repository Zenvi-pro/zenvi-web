---
id: cinematic-bleach-bypass
kind: technique
summary: When the story is gritty (war, sport, crime, protest, industry) - harsh contrast, half saturation, silvery highlights.
categories: [documentary-true-story, sports-hype-edit, movie-game-trailer, automotive-ad, gaming-montage]
tools: [apply_look_tool, add_vignette_tool, unify_grade_tool]
pace: medium
mood: [gritty, tense, raw, serious]
aspect: ["16:9", "2.39:1", "9:16"]
pairs_with: [cinematic-film-emulation, cinematic-silence-before-hit, cinematic-shot-scale-grammar, cinematic-anamorphic-letterbox]
avoid_with: [cinematic-teal-orange, cinematic-warm-nostalgia, cinematic-duotone, cinematic-halation-bloom]
needs: []
---

# Bleach bypass

## What it is

The look of skipping the bleach bath in film processing: a silver layer over the
colour, so contrast is hard, saturation roughly halves and highlights turn metallic.
Shines on faces with texture, metal, crowds, weather, sport; wrong for food, beauty,
weddings and anything that sells colour.

## Build it in Zenvi

1. `unify_grade_tool` `{"strength": 0.7}` first when the shots come from different cameras.
2. `apply_look_tool` `{"clip_ids": "all", "look_id": "bleach_bypass", "stack_grain": true,
   "grain_preset": "35mm_gritty"}` - the generated look plus matching grain, one undo step.
3. `add_vignette_tool` `{"amount": 0.3, "feather": 0.85}`.
4. Softer variant: `"mix": 0.6` on step 2, or `grain_preset: "35mm_classic"`.

## Timing & taste rules

- Use it on the whole piece or a whole act, never on one shot (one bleached shot reads as an error).
- Faces: if skin goes grey-green, lower `mix` to 0.6-0.7; keep the eyes readable.
- Grain: gritty on 1080p+, classic on soft or upscaled footage (gritty on soft footage looks like noise).
- Vignette 0.2-0.3 with feather 0.85+; above that the oval edge shows.

## Sound for it

Dry and close: diegetic hits, low thuds (`impact_thud`), room tone; little reverb.
Pairs with `cinematic-silence-before-hit`.

## Common mistakes

- Stacking it on teal-orange (the split colour disappears, only muddy contrast remains).
- Crushed shadows with no detail: bleach bypass keeps texture in the dark coats.

## Verified

2026-10-28, `tech/bleach-bypass` (press cameras, motorbike corner, two riders; 7.5 s
720p24). The press scrum and helmets read silver and hard; the green trees mute without
going grey. Watch judge (abs): grade 5/10, "high-contrast, desaturated bleach bypass
texture works well to establish a gritty tone across the different subjects".
