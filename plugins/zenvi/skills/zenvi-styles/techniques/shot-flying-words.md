---
id: shot-flying-words
kind: technique
summary: "When a feature list needs depth behind a title: keywords fly past the camera one after another as a word tunnel."
categories: [kinetic-type-motion-design, saas-app-launch, product-launch-film, tech-review, movie-game-trailer]
tools: [add_kinetic_title_tool, get_clip_properties_tool, set_keyframes_tool, add_sfx_tool]
pace: fast
mood: [dense, kinetic, immersive]
aspect: ["16:9", "9:16"]
pairs_with: [kinetic-emphasis-scale, kinetic-title-sequence, shot-blur-slide]
avoid_with: [kinetic-quote-card, kinetic-typewriter, kinetic-word-pop]
needs: [word-tunnel-3d]
---

# Flying words tunnel

## What it is
Twenty-odd keywords are laid out on a flat ellipse around the axis and travel along z from far away to just past the camera. The
viewer reads three to five at a time but feels "many". It is a background layer: the camera is still, the words move, so a
title or a UI can sit on top. Deep-dark ground, light glowing type.

## Build it in Zenvi
No block flies text through depth (`needs: word-tunnel-3d`). Native fallback: each word is its own title clip whose scale and
position are keyframed to fake the approach; 10-14 words is enough on a short shot.
```json
add_kinetic_title_tool {"text": "FAST", "style": "documentary", "animation": "fade", "emphasis": "none", "ink": "#c3cbe2",
  "text_size": 0.08, "y": 0.5, "position_seconds": 0.2, "duration_seconds": 1.8}
get_clip_properties_tool {"timeline_clip_id": "<id>"}            (base scale s0, location x0 y0, from the receipt box also the text centre T)
set_keyframes_tool {"timeline_clip_id": "<id>", "property": "scale_x", "ease": "ease_in_quad", "points": [{"seconds": 0, "value": <s0*0.15>}, {"seconds": 1.8, "value": <s0*3.2>}]}
(same for scale_y; then location_x and location_y so the word's centre travels from 0.5 + 0.5*d to 0.5 + 1.9*d, d = its direction vector out of the centre)
set_keyframes_tool {"timeline_clip_id": "<id>", "property": "alpha", "interpolation": "linear",
  "points": [{"seconds": 0, "value": 0}, {"seconds": 0.45, "value": 1}, {"seconds": 1.08, "value": 0.5}, {"seconds": 1.53, "value": 0.2}, {"seconds": 1.8, "value": 0}]}
```
Start each word 0.12-0.2 s after the previous one, with directions spread by the golden angle (137.5 degrees) and a squashed vertical
radius (0.6). The position that keeps a scaled title centred is `centre - s*c`, as in shot-lead-word-zoom-assemble. For one pass of numbers or one
long phrase, `add_motion_template_tool {"template": "word_scroll"}` is the nearest ready-made scroll.

## Timing & taste rules
- 22 words in the source, 20-36 px at 480 wide (64-120 px at 1920), 700 weight plus a few serif italics; fewer than 12 reads sparse, more than 30 clumps near the camera.
- Travel from far (z -1750) to past the camera (+800) with perspective 1100 (x4 at 1920): the end must pass zero or the words only "fly at your face" and stop.
- Opacity curve 0, 1, 0.5, 0.2, 0 at 0, 25, 60, 85, 100 % of the pass: the mid-run dip to 0.5 gives room to the title in front. Full brightness all the way makes the layer fight the foreground.
- Drift outward 0.5 + 1.35 u (u = progress): near words are thrown off the frame, far words stay near the centre.
- Last 14 % of the approach gets blur; the loop (6 s, two full cycles, integer count) must be a whole number so the end meets the start.
- Dark ground only; keep a still title over the middle at 20 % word opacity inside its box.

## Sound for it
A low air bed with a quiet filtered whoosh every few words (-24 dB); nothing on individual words.

## Common mistakes
- Using it as the hero layer: the words are to be read two at a time at most.
- A fractional number of loops, so the loop jumps.
- Long words or wide scripts at the source font size: the near words fill the screen; shrink the size.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/typography/flying-words.md` (Apache-2.0; see ../NOTICE).
