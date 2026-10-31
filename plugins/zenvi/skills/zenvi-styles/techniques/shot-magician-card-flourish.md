---
id: shot-magician-card-flourish
kind: technique
summary: "When one card or poster is conjured: a 0.3 s blue star flash, the card is thrown out spinning and freezes front-on."
categories: [movie-game-trailer, product-launch-film, brand-story-corporate, music-lyric-video]
tools: [add_motion_block_tool, set_keyframes_tool, apply_fx_tool, add_sfx_tool]
pace: fast
mood: [magical, dramatic, glossy]
aspect: ["16:9", "1:1", "9:16"]
pairs_with: [shot-brand-ink-open, kcut-hit-fx, cinematic-silence-before-hit]
avoid_with: [shot-fracture, shot-spotlight-hero-card]
needs: []
---

# Conjured card

## What it is
On near-black, a sharp X-shaped star of light flashes for 0.3 s (the needles rotate 90 degrees), and the card is flicked out of the flash point: tiny and far,
spinning fast along an arc, slowing as it nears the camera, then frozen dead on frame 86 % of the frame high. A light pulse and a sheen sweep follow, and the
copy beside it reveals line by line. One card per shot.

## Build it in Zenvi
Flash: a `particle_burst` of sparks with rings, centred on the launch point (left third), 0.3 s of light before the card appears.
```json
add_motion_block_tool {"block": "particle_burst", "params": {"shape": "lines", "count": 24, "origin": [{"x": 0.33, "y": 0.5}], "colors": ["#3f9bff", "#2277f2", "#ffffff"], "rings": false, "gravity": 0}, "position_seconds": 0.1, "duration_seconds": 0.8}
```
Card still (printed card art you supply) on the track above, keyframed from the flash point to the freeze:
```json
set_keyframes_tool {"timeline_clip_id": "<card>", "property": "scale_x", "ease": "ease_out_quart", "points": [{"seconds": 0.35, "value": 0.11}, {"seconds": 0.55, "value": 0.2}, {"seconds": 1.9, "value": 0.86}]}
set_keyframes_tool {"timeline_clip_id": "<card>", "property": "rotation", "ease": "ease_out_cubic", "points": [{"seconds": 0.35, "value": 0}, {"seconds": 1.9, "value": 4680}]}
set_keyframes_tool {"timeline_clip_id": "<card>", "property": "location_y", "ease": "ease_in_out_sine", "points": [{"seconds": 0.35, "value": 0}, {"seconds": 1.1, "value": -0.22}, {"seconds": 1.9, "value": 0}]}
```
`scale_y` as `scale_x`; `location_x` goes from 0 to the freeze x. 4680 degrees is 13 whole turns, so it ends facing front. Last point on the freeze frame, then nothing more.
After the freeze: a `particle_burst {"shape": "rings", "count": 1, "origin": [...card centre...]}` pulse and `apply_fx_tool {"clip_id": "<card>", "effects": [{"effect": "bloom", "amount": 0.4}]}`
for the sheen. The copy: `kinetic_headline` at the right, lines rising 4-10 frames apart.

## Timing & taste rules
- Flash 9 frames (0.3 s): 2.5-frame fade-up, a flicker, a collapse. Over 15 frames the flash outshines the card. Rotate the star 90 degrees in that time (a static angle is not seen as turning).
- Beams pure saturated blue, the centre a small hot dot (26 px) with a 140 px glow and ~10 short spikes; a white ball in the centre reads as a cheap effect.
- Launch curve: slow start (14 % of time = 6 % of travel), then a kick, then an eased arrival (cubic out). Plain linear or ease-out has no throw.
- Spin is near-constant for the first 40 % of the path, then falls off with a 2.4 power; a whole number of turns guarantees the frontal freeze.
- Freeze: complete stop, no bounce (a bounce makes it a toy). Card height 86 % with copy beside it; ~94 % when the card is alone.
- Stage the flash as the only light (dim the stage), then bring up the card's backlight at the freeze.
- Do not wrap the thin star needles in motion blur (rotation turns into striped ghosts); blur the card only.

## Sound for it
A `riser_tonal` ending at the flash (-14), `swoosh_hit` for the throw (-10, `pan` from -0.4 to 0.4), `impact_slam` on the freeze (-6), `sparkle` on the sheen (-16).

## Common mistakes
- A decaying tail on the freeze.
- Several cards at once (that is a deal or flip shot).

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/opening/magician-card-flourish.md` (Apache-2.0; see ../NOTICE).
