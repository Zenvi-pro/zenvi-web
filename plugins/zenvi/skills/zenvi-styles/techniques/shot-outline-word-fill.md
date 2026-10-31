---
id: shot-outline-word-fill
kind: technique
summary: "When one short word is the nail: it slams in hollow from 3x, a dashed circle closes in, then it fills solid in a frame."
categories: [kinetic-type-motion-design, product-launch-film, saas-app-launch, brand-story-corporate, tech-review]
tools: [add_kinetic_title_tool, get_clip_properties_tool, set_keyframes_tool, add_motion_block_tool, add_sfx_tool]
pace: fast
mood: [decisive, technical, punchy]
aspect: ["16:9", "1:1"]
pairs_with: [kinetic-keyword-slam, kinetic-emphasis-scale, kcut-hit-fx]
avoid_with: [shot-blur-slide, kinetic-word-rotator, kinetic-quote-card]
needs: [outline-text-style]
---

# Outline word, instant fill (and the three-word relay)

## What it is
A single short word ("Faster") is the benefit. It arrives hollow (thin warm-grey stroke) and enormous, contracting to size in 11
frames. A dashed circle at 2.8x then settles around it slowly while a pair of dashed horizontal rules reach in from the frame edges
with before/after readings: the "aiming" half. The stroke warms up, then on one exact frame the word turns solid white-hot with a
single bright flash and a ring. The nail is two settles: size first, then material. Variant: three benefit words, each with its own geometry.

## Build it in Zenvi
No outline text (`needs: outline-text-style`): fake the hollow state with a dim thin-looking copy, and the solid state with a bright copy
switched on by a stepped keyframe.
```json
add_kinetic_title_tool {"text": "Faster", "style": "documentary", "animation": "fade", "ink": "#6e6258", "text_size": 0.2, "y": 0.5, "position_seconds": 0.07, "duration_seconds": 3}     (the dim "hollow" copy)
add_kinetic_title_tool {"text": "Faster", "style": "documentary", "animation": "fade", "ink": "#fff5ee", "text_size": 0.2, "y": 0.5, "position_seconds": 0.07, "duration_seconds": 3}     (the lit copy)
set_keyframes_tool {"timeline_clip_id": "<dim>", "property": "scale_x", "ease": "ease_out_quart", "points": [{"seconds": 0, "value": <s0*3.2>}, {"seconds": 0.37, "value": <s0>}]}     (scale_y the same; hold the centre with location)
set_keyframes_tool {"timeline_clip_id": "<lit>", "property": "alpha", "interpolation": "constant", "points": [{"seconds": 1.73, "value": 0}, {"seconds": 1.77, "value": 1}]}
add_motion_block_tool {"block": "hud_callouts", "position_seconds": 0.2, "duration_seconds": 2.8, "placement": "over_video",
  "params": {"title": "", "grid": "crosshair", "labels": ["BEFORE", "AFTER"], "values": ["1 week", "4 hrs"], "points": [{"x": 0.2, "y": 0.5}, {"x": 0.8, "y": 0.5}]}}
add_motion_block_tool {"block": "particle_burst", "position_seconds": 1.77, "duration_seconds": 0.8, "placement": "over_video", "params": {"shape": "rings", "origin": [{"x": 0.5, "y": 0.5}]}}
add_sfx_tool {"recipe": "impact_punch", "at_seconds": 1.77, "gain_db": -8}
```
The lit copy's switch is a constant (stepped) keyframe so there is no in-between frame. Variant relay: reuse for three words, giving the first a
`line_trails` orbit (`pattern: orbit`), the second `particle_burst` rings, the third a chrome sweep, `add_3d_scene_tool {"scene": "title_3d", "params": {"text": "WORD"}}` (Blender, CLI only).

## Timing & taste rules
- Contraction 3.2x to 1 in 11 frames (0.37 s) with a snappy ease: under 2x is a plain zoom, over 20 frames a slow zoom with no impact.
- Word 220 px at 1080p, weight 500 (hollow type this heavy turns into a balloon); stroke 2 px, never above 4.
- Dashed circle r=410 px, dash 22/18, 2.8x to 1 over 44 frames (1.5 s) - the slowest curve of the shot; it turns 0.22 degrees a frame and stops when the word lights.
- Horizontal dashed rules reach in from the frame edges to 28 px outside the circle in frames 28-46; going through the circle makes a crosshair.
- Stroke warms up in frames 44-53 (grey to bright orange-white with a little glow); the fill is a hard cut on frame 54 (1.8 s). Any fill slower than 3 frames turns the nail into decoration.
- Flash white 14 px + accent 60 px glow decays in 8 frames; one shock ring, 14 frames, once. Hold at least 36 frames after the fill.
- Relay of three: segments of about 60 frames (2 s) overlapping 6 frames; entrance 14 frames, exit 10 frames (shrink to 0.86 and fade, shorter than the entrance); each word has its own geometry (spinning ring with a fast comet, three rings that grow one after another then close to 300 px apart with rivet points, a chrome sweep) and only the last word gets the chrome-to-white upgrade, once.
- One short word only (6 letters): font, circle radius and rule ends are one set of coordinates; a longer word pierces the circle. Dark warm ground.

## Sound for it
One short, hard accent on the exact fill frame (-8 dB, metal / switch / low thud); that sound is half the effect.

## Common mistakes
- Normalised time windows for the fill: after a re-time they become a visible fade. Fix it to a frame/second.
- Two hollow-to-solid words in one film, or this plus a relay for the same word.
- Light ground: a hollow word on light has no impact.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft cards `shots/typography/outline-word-fill.md` and `shots/typography/word-relay-geometry.md` (Apache-2.0; see ../NOTICE).
