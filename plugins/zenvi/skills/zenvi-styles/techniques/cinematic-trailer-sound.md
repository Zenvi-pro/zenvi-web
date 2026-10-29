---
id: cinematic-trailer-sound
kind: technique
summary: When a cut must sound like a trailer - rumble bed, booms on cards, risers cut on the hit, reverse swells.
categories: [movie-game-trailer, automotive-ad, sports-hype-edit, gaming-montage, product-launch-film]
tools: [add_sfx_tool, auto_sound_design_tool, automate_volume_tool, search_sound_library_tool, generate_sfx_tool]
pace: medium
mood: [epic, ominous, tense, huge]
aspect: ["16:9", "2.39:1", "9:16"]
pairs_with: [cinematic-silence-before-hit, cinematic-montage-rhythm, cinematic-title-sequence, cinematic-anamorphic-letterbox, cinematic-rack-focus]
avoid_with: [cinematic-warm-nostalgia, cinematic-j-l-cut]
needs: [braam-generator]
---

# Trailer sound design

## What it is

The sound grammar of trailers: a low bed (rumble, room, drone) under the build; a huge low
boom ("braam") on each title card; a riser that grows into the drop and is cut on it; a
reverse swell sucking into a slam; sub drops under the big hits. Levels and spacing are in
`~/zenvi-motion/sound/CRAFT.md` (hype and trailer palettes).

Related shot card: `shot-trailer-grammar-moves`.

## Build it in Zenvi

Per moment, with `add_sfx_tool` (every recipe peaks on `at_seconds`):
- Bed: `{"recipe": "room_tone", "at_seconds": 0, "align": "start", "duration": 8, "gain_db": -24}` plus a rumble:
  `{"recipe": "riser_noise", "pitch": -12, "brightness": 0.05, "duration": <build>, "gain_db": -12}` (one cue is at most 8 s: chain two for a longer build).
- Title card / braam stand-in: `{"recipe": "impact_boom", "pitch": -6 .. -9, "intensity": 0.9}` +
  `{"recipe": "sub_drop", "gain_db": -8 .. -12}` on the same frame.
- Into a hit: `{"recipe": "reverse_swell", "duration": 1.2}` ending on the hit, or
  `{"recipe": "riser_tonal", "duration": <2-4 bars>}` ending where the music stops.
- The drop: `impact_slam` (`intensity` 1) + `sub_drop`.
- Whole-edit first pass: `auto_sound_design_tool` `{"genre": "hype", "intensity": "normal"}`, then hand-place the
  card booms and the drop.
A real brass braam: `search_sound_library_tool` has none (checked 2026-10-28); `generate_sfx_tool`
(`"huge low brass braam with a long dark tail"`) needs `ELEVENLABS_API_KEY` on the CLI. Until a
procedural braam exists (`braam-generator`), the pitched `impact_boom` + `sub_drop` stack is the fallback.

## Timing & taste rules

- Riser = 1, 2 or 4 bars, cut at the hit frame, never ringing past it.
- Booms on cards >= 250 ms apart; at most one boom per card.
- Sound cue density 0.25-0.5 per cut; whoosh on < 10 % of cuts (trailer dossier, item 4).
- Keep dynamic range: master around -16 LUFS for social, -20 to -24 for a festival/theatrical cut.
- Pitch heavier (-6 to -12 semitones) rather than louder.

## Sound for it

This is the sound. Pair with `cinematic-silence-before-hit` for the drop.

## Common mistakes

- A whoosh on every cut (template sound; the best trailers do not).
- Riser that keeps rising after the hit.
- Booms at the same pitch on every card (vary `pitch` +-2 and `seed`).

## Verified

2026-10-28. Isolated test `tech/trailer-sound` (moon, car, tunnel; 7 s): the cue grammar plays
correctly but the judge scored the clip low (2.9) for unrelated footage. In the trailer showcase
(`show/trailer`, 22 s) the same palette scored sound_design 7/10, mix 6, ending 7: "structure,
tension build, silence drop, and sound design hits effectively establish an ominous nighttime
teaser feel".
