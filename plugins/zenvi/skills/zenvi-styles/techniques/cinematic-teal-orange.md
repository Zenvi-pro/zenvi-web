---
id: cinematic-teal-orange
kind: technique
summary: When footage should read as blockbuster or car film - warm skin and lights against teal shadows, on every shot.
categories: [movie-game-trailer, automotive-ad, sports-hype-edit, travel-cinematic-montage, gaming-montage]
tools: [unify_grade_tool, color_grade_clip_tool, list_looks_tool, inspect_color_tool]
pace: medium
mood: [epic, glossy, heroic, night]
aspect: ["16:9", "2.39:1", "9:16"]
pairs_with: [cinematic-anamorphic-letterbox, cinematic-halation-bloom, cinematic-film-emulation, cinematic-speed-ramp]
avoid_with: [cinematic-bleach-bypass, cinematic-duotone, cinematic-day-for-night, cinematic-warm-nostalgia]
needs: []
---

# Teal-orange grade

## What it is

Complementary split: shadows and backgrounds pushed to teal, skin, headlights and
practicals kept orange. Shines on night city, dusk roads, cars, sport and anything
with warm light sources against a dark ground; weak on flat daylight with no warm
subject (it just turns the sky cyan).

## Build it in Zenvi

1. Match first, then look, in one call: `unify_grade_tool` `{"look":
   "teal_&_orange_cinema", "look_intensity": 0.8, "strength": 0.7}` (all footage
   clips). Other LUTs in the family: `signature_teal_&_orange` (stronger),
   `teal_punch`, `moonlight_orange` (night), `western_sunset` (dusk) - pick with
   `list_looks_tool` `{"vibe": "teal_orange"}`.
2. A shot that still sticks out: `color_grade_clip_tool` on that clip only
   (`temperature`, `exposure`, `mix`), never a second LUT on top.
3. Footage at 2048x1080 or 2.39:1 inside a 16:9 project shows black bars:
   `set_clip_property_tool` `{"property": "scale", "value": 0}` (crop to fill) on
   those clips before grading, or the bars read as a grading mismatch.
4. Fallback without LUT files: `color_grade_clip_tool` `{"look": "teal_orange"}`.

## Timing & taste rules

- `look_intensity` 0.6-0.85. Full strength turns skin orange-red and blacks green.
- One look for the whole piece; `strength` 0.6-0.8 keeps some of each shot's
  character (1.0 makes dusk and night shots look identical, which flattens a trailer).
- Check skin on the closest face: if it goes past orange into red, drop the intensity
  0.1 rather than adding a correction.
- Keep true black somewhere in the frame; teal-lifted blacks look like a phone filter.

## Sound for it

Nothing specific; it is the default palette of the hype and trailer beds
(`zenvi-sound-designer`, genre `hype`).

## Common mistakes

- A different teal-orange LUT per shot (the shots stop belonging together).
- Grading before cropping wide sources (bars + grade read as two looks).
- Teal-orange on top of `bleach_bypass` or a duotone: the second look fights the split.

## Verified

2026-10-28, `tech/teal-orange` (3 shots, 7.5 s, 720p24: night car, dusk road, night
car). unify_grade + `teal_&_orange_cinema` 0.8: the split reads on all three, the dusk
sky lands orange-cyan, headlights stay warm. Watch judge (abs): grade 5/10; its notes:
dusk aerial "overly saturated" against the night shots and black bars on the 2048-wide
clip, which led to rules 2 and 3 above (crop to fill, strength 0.7).
