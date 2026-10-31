---
id: cinematic-dolly-zoom
kind: technique
summary: When a realisation must hit (vertigo) - subject holds size while the background stretches; needs a clean plate.
categories: [movie-game-trailer, documentary-true-story, music-lyric-video]
tools: [replace_background_tool, set_keyframes_tool, generate_subject_matte_tool, add_sfx_tool]
pace: calm
mood: [unsettling, dramatic, tense]
aspect: ["16:9", "2.39:1"]
pairs_with: [cinematic-trailer-sound, cinematic-silence-before-hit, cinematic-cold-thriller]
avoid_with: [cinematic-push-in, cinematic-whip-cut, cinematic-montage-rhythm]
needs: [clean-plate-inpaint, parallax-layer-camera-rig]
---

# Dolly zoom (vertigo effect)

## What it is

The camera dollies one way while the lens zooms the other: the subject stays the same size,
the background swells or collapses behind them. One per film, on the moment of realisation.

Related shot card: `shot-tension-camera-moves` (pull-back isolation and bullet time - buildable for graphics).

## Build it in Zenvi

Not buildable cleanly today. The emulation is two layers: `replace_background_tool`
`{"clip_id": "<clip_id>", "background": "blur", "blur": 2}` (footage below, the person cut out above by the
subject matte), then `set_keyframes_tool` on the lower layer's `scale_x`/`scale_y`
`[{"seconds": 0, "value": 1.0}, {"seconds": 4, "value": 1.35, "ease": "ease_in_out_sine"}]`.
The lower layer still contains the person, so as it scales a second, larger copy of them
appears behind the cut-out (the ghost). Missing: `clean-plate-inpaint` (remove the person from
the background plate) and a layer camera rig (GAPS #28 `parallax-layer-camera-rig`).

Fallback that looks good today:
1. Shots where the subject is small or centred against sky, sea or a plain wall: the ghost hides
   behind the cut-out; keep the background scale change under 12 % and check every frame.
2. Otherwise do not fake it: use `cinematic-push-in` (1.0 -> 1.12 over 3 s) with
   `cinematic-silence-before-hit` underneath - the same story beat, no artefact.

## Timing & taste rules

- 2-4 s, ease in-out, background 1.0 -> 1.2-1.35 (or reversed).
- The subject must be still; any motion breaks the illusion.
- Once per film.
- Pull-back isolation, the buildable cousin (video-shotcraft, Apache-2.0, `shot-tension-camera-moves`): scale 2.2 -> 0.62 over ~3.7 s (110 f) ease-out cubic about the subject, the surroundings dimming nearest-first; then hold >= 1.3 s still. At most two emotional camera moves per film, each once.

## Sound for it

A tonal riser or a low drone swell for the length of the move (`riser_tonal`, -14 dB),
ending in silence rather than a hit.

## Common mistakes

- Scaling the whole clip (that is a zoom, not a dolly zoom).
- Shipping the ghost: always watch the render.

## Verified

2026-10-28, `tech/dolly-zoom` (man in a lake holding a frame, 4 s 720p24, background 1.0 -> 1.35).
The ghost appeared: the judge read it as "floating red frames multiplying around the subject"
instead of a vertigo move (overall 4.3). Hence `needs:` and the fallback.
