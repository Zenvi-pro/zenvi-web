---
id: cinematic-anamorphic-letterbox
kind: technique
summary: When 16:9 footage should feel like cinema - 2.39:1 bars, glowing highlights, edge fringing; the flare streak is missing.
categories: [movie-game-trailer, automotive-ad, travel-cinematic-montage, wedding-event-film, brand-story-corporate, music-lyric-video]
tools: [add_shape_mask_tool, apply_fx_tool, pop_out_tool, color_grade_clip_tool, set_clip_property_tool]
pace: medium
mood: [cinematic, epic, premium]
aspect: ["16:9", "2.39:1"]
pairs_with: [cinematic-teal-orange, cinematic-halation-bloom, cinematic-film-emulation, cinematic-aspect-ratio-reveal, cinematic-title-sequence]
avoid_with: [cinematic-duotone]
needs: [anamorphic-streak-flare]
---

# Anamorphic letterbox and lens character

## What it is

The widescreen frame of anamorphic cinema (2.39:1 inside 16:9) plus its lens signature: glowing
highlights, colour fringing toward the edges and the horizontal blue streak flare. The bars alone
do most of the work. Shines on trailers, car films, travel and wedding highlight films.

## Build it in Zenvi

1. Bars on every footage clip: `add_shape_mask_tool` `{"shape": "rectangle", "width": 1.2,
   "height": 0.744, "feather": 0}` (no `clip_ids` = all footage and photos; titles stay full
   frame). 0.744 = (16/9) / 2.39; use 0.889 for 2:1. A 4:3 home-movie window is a pillarbox instead:
   `"width": 0.75, "height": 1.2` (0.75 = (4/3) / (16/9)).
2. Lens character per clip: `apply_fx_tool` `{"clip_id": "<clip_id>", "effects": [{"effect": "bloom", "amount": 0.45,
   "params": {"threshold": 0.7, "radius": 0.45}}, {"effect": "chromatic_aberration", "amount": 0.25}]}`.
3. Person breaking the bars (hero moment): `pop_out_tool` `{"clip_id": "<clip_id>", "band_aspect": 2.39}`.
4. The horizontal streak flare is missing (`anamorphic-streak-flare`): bloom is radial. Fallback:
   leave it out; never fake it with `directional_blur` on the whole frame (it smears the image).

## Timing & taste rules

- Bars on from the first frame to the last, or opened/closed once on purpose
  (`cinematic-aspect-ratio-reveal`); never on some shots only.
- Keep titles inside the band, and lower thirds above the bottom bar.
- Fringing amount 0.2-0.3; at 0.5 faces get coloured edges.
- Vertical (9:16) deliverables: do not letterbox; use the grade and bloom only.

## Sound for it

None of its own; it sets up `cinematic-trailer-sound`.

## Common mistakes

- 2.39 bars on top of footage that is already letterboxed (double bars) - crop-fill first
  (`set_clip_property_tool {"clip_id": "<clip>", "property": "scale", "value": 0}`).
- Text in the bars (looks like a broadcast ticker).

## Verified

2026-10-28, `tech/anamorphic-letterbox` (two night car shots, 6 s 720p24, teal-orange + bloom +
fringing + bars). Watch judge (abs): grade 7/10, overall 5.0, "the anamorphic aesthetic hits its
target well with convincing letterboxing, soft teal-and-orange street lighting, and glowing lens
fringing". Used across the trailer showcase.
