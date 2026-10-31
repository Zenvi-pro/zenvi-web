---
id: cinematic-film-emulation
kind: technique
summary: When digital footage should feel shot on 35mm - grain, soft highlight shoulder, halation glow, a breath of gate weave.
categories: [brand-story-corporate, wedding-event-film, travel-cinematic-montage, documentary-true-story, music-lyric-video, fashion-beauty-ad]
tools: [color_grade_clip_tool, apply_look_tool, apply_fx_tool, set_keyframes_tool, add_vignette_tool]
pace: calm
mood: [organic, nostalgic, premium, warm]
aspect: ["16:9", "4:3", "2.39:1", "9:16"]
pairs_with: [cinematic-halation-bloom, cinematic-warm-nostalgia, cinematic-anamorphic-letterbox, cinematic-push-in, cinematic-title-sequence]
avoid_with: [cinematic-duotone]
needs: [film-emulation-fx]
---

# Film emulation (35mm)

## What it is

The texture of a film print: grain that moves, highlights that roll off instead of clipping,
blacks a touch lifted, a warm glow (halation) around bright edges, and a picture that breathes
by a pixel or two in the gate. Shines on brand films, weddings, travel and anything that should
feel crafted rather than recorded.

Related shot card: `shot-grain-dissolve` (grain as a transition into a wordmark).

## Build it in Zenvi

1. Tone: `color_grade_clip_tool` `{"timeline_clip_ids": [...], "highlights": -0.3, "shadows": 0.06,
   "saturation": 0.9, "temperature": 0.08, "curves": {"all": [[0, 0.03], [0.25, 0.22], [0.75, 0.8], [1, 0.95]]}}`.
   (A stock film LUT is optional at 0.4-0.5; `classic_film` at 0.6 blew a blue sky to cyan in the test.)
2. Grain: `apply_look_tool` `{"clip_ids": "all", "look_id": "grain:35mm_classic"}` (`grain:35mm_fine`
   for clean product shots, `grain:16mm_classic` for documentary).
3. Halation: `apply_fx_tool` `{"clip_id": "<clip_id>", "effects": [{"effect": "bloom", "amount": 0.3,
   "params": {"threshold": 0.72, "radius": 0.35}}]}` on shots with bright edges.
4. Gate weave: `set_keyframes_tool` `scale_x`/`scale_y` 1.01, then `location_x` and `location_y` with
   8-9 points over the shot, values within +-0.002 (e.g. 0, 0.0018, -0.0012, 0.0022, -0.0019, 0.0008, ...),
   x and y out of phase.
5. Optional: `add_vignette_tool` `{"amount": 0.15, "feather": 0.95}` - skip it on bright skies.
A one-call film FX (grain + halation + weave + gate flicker) is missing (`film-emulation-fx`).

## Timing & taste rules

- Weave is felt, not seen: under 0.25 % of the frame; more looks like camera shake.
- Grain on every shot of the piece, including titles over footage.
- Halation on 30-50 % of shots (the ones with light sources), not everywhere.
- Pick footage with motion or texture; on flat skies film emulation only adds noise.

## Sound for it

Optional: a projector flutter or room tone at -28 dB under the opening.

## Common mistakes

- Heavy vignette as "film" (the judge flagged it twice; real lenses vignette subtly).
- Film LUT at full strength on top of an already graded clip.

## Verified

2026-10-28, `tech/film-emulation` (lake aerial + man in a lake, 6 s 720p24). The judge saw "subtle
grain and gate instability" (the weave reads), but marked the vignette heavy-handed and, with
`classic_film`, the sky cyan (grade 3/10, overall 2.6-2.7, mostly for two unrelated shots). The recipe
above drops the LUT and the vignette. In context - the brand-film showcase (`show/brand`, 11 detail shots,
this tone + `grain:35mm_fine` + halation on two shots + vignette 0.15/0.95) - the judge gave grade 8/10,
overall 8.1.
