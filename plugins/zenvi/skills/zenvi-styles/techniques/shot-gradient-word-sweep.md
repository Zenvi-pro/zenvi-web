---
id: shot-gradient-word-sweep
kind: technique
summary: "When one slogan keyword must feel charged: a colour with a bright front sweeps over it left to right, the rest still."
categories: [kinetic-type-motion-design, saas-app-launch, product-launch-film, tech-review, gaming-montage]
tools: [add_kinetic_title_tool, get_clip_properties_tool, add_effect_tool, set_keyframes_tool, add_sfx_tool]
pace: fast
mood: [energetic, electric, confident]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-emphasis-scale, kinetic-keyword-slam, kinetic-counter]
avoid_with: [shot-blur-slide, kinetic-quote-card, kinetic-karaoke]
needs: [type-gradient-sheen]
---

# Keyword charge sweep

## What it is
In a white sentence on black, one selling word is "powered up": a colour sweeps across its letters in about half a second,
brightest at the front edge and settling behind it, then the word holds in the accent. The rest of the line never moves.
Verb or benefit words ("supercharged", "faster", "AI"), the energy peak of a slogan, black-ground brand frames.

## Build it in Zenvi
Native, no block: the same word three times (white base, accent copy, bright front copy); the two copies are revealed by a
keyframed `Crop` on the title picture. Titles are full-frame pictures scaled by a base scale s0 from a left offset x0, so a
fraction of the word's width maps to a crop fraction of ((frame x) - x0) / s0 (read both with `get_clip_properties_tool`).
```json
add_kinetic_title_tool {"text": "Every cut feels", "style": "documentary", "animation": "fade", "background": "#000000",
  "text_size": 0.07, "y": 0.36, "position_seconds": 0, "duration_seconds": 3.4, "stagger_seconds": 0}
add_kinetic_title_tool {"text": "SUPERCHARGED", "style": "documentary", "animation": "fade", "emphasis": "none", "ink": "#ffffff",
  "text_size": 0.2, "y": 0.58, "position_seconds": 0.1, "duration_seconds": 3.3}
add_kinetic_title_tool {"text": "SUPERCHARGED", ... "ink": "#ff3fa4" ...}      (accent copy, same size and y)
add_kinetic_title_tool {"text": "SUPERCHARGED", ... "ink": "#ffe3f4" ...}      (front copy)
add_effect_tool {"timeline_clip_id": "<accent>", "effect": "Crop", "properties": {"right": [
  {"time": 0.5, "value": 0.94}, {"time": 0.61, "value": 0.72}, {"time": 0.78, "value": 0.5}, {"time": 0.94, "value": 0.28}, {"time": 1.05, "value": 0}]}}
add_effect_tool {"timeline_clip_id": "<front>", "effect": "Crop", "properties": {"right": [ same ], "left": [
  {"time": 0.5, "value": 0.06}, {"time": 0.61, "value": 0.06}, {"time": 0.78, "value": 0.2}, {"time": 0.94, "value": 0.42}, {"time": 1.05, "value": 0.64}]}}
set_keyframes_tool {"timeline_clip_id": "<front>", "property": "alpha", "interpolation": "linear",
  "points": [{"seconds": 1.05, "value": 1}, {"seconds": 1.38, "value": 0}]}
add_sfx_tool {"recipe": "whoosh_rise", "at_seconds": 0.5, "gain_db": -16}
```
(The numbers are the span-fractions for that title; compute yours as a0 + (a1 - a0) * p with p from 0 to 1.) `right` reveals
left to right; `left` trails it by a 34 % band so only the front is bright. Glow, the multi-layer bloom and the thin
sparks between the letters are not available on native titles (`needs: type-gradient-sheen`); a `title_3d` gradient is Blender-only.

## Timing & taste rules
- Sweep 15-20 frames (0.5-0.65 s); over 28 frames it reads as a progress bar.
- A wave front about 34 % of the word wide, brightest at the edge, settling to the accent behind it; without the gradient it is
  a static colour wipe.
- Glow restrained (opacity 0.55-0.72 of full); sparks, if any: thin, magenta-violet, at most 2 on screen, gaps over 8 frames.
- No light dots following the sweep: they look cheap.
- Only the keyword moves; the sentence stays pure white and still. The keyword must be the selling word.

## Sound for it
A short rising whoosh peaking at the end of the sweep (-16 dB) and an optional sparkle on the settle (-22 dB); a low hit
would give the weight the judge missed.

## Common mistakes
- Crop fractions taken from the frame instead of the picture: the sweep starts late or stops short of the word's end.
- A sweep that is a flat colour change with no front edge; a wide soft glow that turns the word to mush.
- Colouring several words so the viewer does not know which to remember.

## Verified
2026-10-29, CLI on generated media (no footage): scripts/shot-gradient-word-sweep.sh → shots/shot-gradient-word-sweep.mp4 (local only). Checked on the sheet: the white keyword fills pink left to right in about half a second, a pale front band travels ahead of the fill, the sentence stays still; there is no glow and no sparks. Watch judge (absolute): **3.0/10**; main note: "The basic wipe across the keyword delivers the intended concept on a functional level. However, the movement lacks an energetic leading wave edge, glow, or kinetic easing, making it feel stiff and rudimentary."

Adapted from video-shotcraft card `shots/typography/gradient-word-sweep.md` (Apache-2.0; see ../NOTICE).
