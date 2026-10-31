---
id: cin-ty-scaled-echo-extrusion
kind: technique
summary: "When a short hero title needs weight: two or three faint scaled copies sit behind it and compress as it lands."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, duplicate_clips_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [weighty, dimensional]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [shot-slam-entrance, kinetic-emphasis-scale]
avoid_with: [kinetic-echo-stack, cin-ty-kinetic-word-slams]
needs: []
drawn: cinetic
---

# Scaled-echo extrusion

cinetic `ty-scaled-echo-extrusion` · Typography in motion · accent · energy medium · formats launch, sting, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A hero title carries two or three faint copies scaled out behind it, a short depth extrusion that compresses as the title lands and then holds.

Use when: A product name or a hero title of one to three words that needs weight in a flat sans. A giant cropped word that needs physical depth. A title card between two energetic acts.

## Build it in Zenvi

1. `add_kinetic_title_tool {"text": "Pulse", "style": "stack", "animation": "slam", "text_size": 0.2, "position_seconds": 2.0, "duration_seconds": 2.0}` on track 4, then `duplicate_clips_tool {"timeline_clip_ids": ["<title>"], "copies": 3, "to_track": "3"}` so the copies sit below the title.
2. Copy k (k = 1, 2, 3 from the nearest): `alpha` constant 0.55, 0.35, 0.2 and a colour half way to the ground via `edit_title_tool {"timeline_clip_id": "<copy_k>", "text_color": "<mid>"}`.
3. Scale each copy about the text centre and collapse as the title lands: `set_keyframes_tool {"timeline_clip_id": "<copy_k>", "property": "scale_x", "ease": "ease_out_expo", "points": [{"seconds": 1.967, "value": <1 + 0.03 k>}, {"seconds": 2.33, "value": <1 + 0.012 k>}, {"seconds": 3.0, "value": <1 + 0.012 k + 0.01>}]}`, same on `scale_y` (22 f collapse).
4. Slide each copy's `location_x` by 0.02 over the hold, opposite to the line drift, so the echoes shift like real depth.
5. `add_sfx_tool {"recipe": "impact_thud", "at_seconds": 2.0, "gain_db": -12}`.

## Timing & taste rules

- cinetic's timing (60 fps): Converge over 22 f (0.37 s) on ease_out_expo (step 0.03 -> 0.012; outer copy edges stay under 7 px/f on a 500 px title). Copy opacity 0.55 / 0.35 / 0.2. Hold the whole card (36-60 f (1.00 s)) with a vanishing-point slide of about 40 px on linear and a line drift of 0.3 px/f. The solid-block variant uses 8-12 one-pixel steps that do not animate relative to the face; the card still drifts at 0.3 px/f.
- Three copies at scale steps of 3 % shrinking to 1.2 % as the title lands; copies at 55 / 35 / 20 % opacity, tinted half way to the ground.
- Converge over 22 f (0.37 s) ease_out_expo; outer copy edges stay under 7 px/f.
- Hold 36-60 f (0.6-1 s) with a 40 px (0.02) slide of the echoes and a 0.3 px/f line drift.
- Solid-block variant for a giant cropped word: 8-12 copies stepped 1 px / 1.5 px, each a shade darker, no blur, bevel or shadow.

## Sound for it

One impact_thud at -12 dB on the landing frame.

## Common mistakes

- Body copy or lines over 3 words: the copies tangle in the counters.
- Low-contrast grounds where the copies turn to haze.
- Blur, glow, bevels or drop shadows on the copies, or pairing with another echo device.
- Avoid when: Body copy or lines over 3 words (the copies tangle inside the counters). Low-contrast stages, where the copies turn to haze. Blur, glow, bevels or drop shadows on the copies. A film that already uses the motion-trail echo of the word slams: pick one echo device.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ty-scaled-echo-extrusion`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
