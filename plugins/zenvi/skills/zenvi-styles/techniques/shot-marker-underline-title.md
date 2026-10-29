---
id: shot-marker-underline-title
kind: technique
summary: "When one title word needs a human touch: after the title lands, a marker stroke is drawn under it left to right."
categories: [kinetic-type-motion-design, brand-story-corporate, saas-app-launch, ugc-ad-testimonial, kids-education]
tools: [add_kinetic_title_tool, add_title_tool, add_shape_mask_tool, add_effect_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [warm, handmade, friendly]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-blur-slide, kinetic-quote-card, kinetic-write-on]
avoid_with: [shot-glitch-cycle, kinetic-beat-strobe, kinetic-scramble-decode]
needs: [marker-stroke-shape]
---

# Marker underline on a keyword

## What it is
A printed headline settles, then a hand-drawn marker stroke sweeps under one keyword in about a third of a second: wider in the
middle, ragged at the edges, tilted up to the right along an italic word, sitting right on the baseline. The material contrast
(print against pen) picks the word out like a person circling it on a poster. Quiet emphasis for "new", "free", "AI".

## Build it in Zenvi
A ragged variable-width stroke is not available (`needs: marker-stroke-shape`). Native approximation: a flat colour bar, cut to a
thin rectangle with a shape mask, drawn on by a keyframed Crop and tilted with a rotation keyframe.
```json
add_kinetic_title_tool {"text": "Make it free today", "style": "editorial", "animation": "rise", "emphasis": "free", "accent": "#d8402a", "position_seconds": 0, "duration_seconds": 3, "y": 0.45}
add_title_tool {"template": "Standard_1", "text": " ", "background_color": "#d8402a", "position_seconds": 0.8, "duration_seconds": 2.2}
add_shape_mask_tool {"clip_ids": ["<bar>"], "shape": "rectangle", "x": 0.6, "y": 0.575, "width": 0.14, "height": 0.018, "feather": 0.006}
add_effect_tool {"timeline_clip_id": "<bar>", "effect": "Crop", "properties": {"right": [{"time": 0.8, "value": 0.74}, {"time": 1.13, "value": 0.26}]}}
set_keyframes_tool {"timeline_clip_id": "<bar>", "property": "rotation", "points": [{"seconds": 0.8, "value": -1.5}, {"seconds": 1.13, "value": -1.5}]}
add_sfx_tool {"recipe": "paper", "at_seconds": 0.82, "gain_db": -18}
```
Position the rectangle from the keyword's measured box (the title receipt's `box`), a little below the baseline. Use a negative rotation for a
word in italic (left low, right high). Crop `right` keyframed from fully hidden to fully shown is the stroke. The keyframe times above are
timeline seconds; exact crop fractions depend on the mask's width inside the full-frame picture.

## Timing & taste rules
- Start the stroke 4-8 frames after the title has settled, never together with it; draw it in 8-12 frames (14 reads slow, under 6 you cannot see the pen move).
- Ease out, quick start, slight settle at the end (the hand slows).
- Stand-off about -0.1 em below the baseline: far away it reads as a divider, touching descenders is messy.
- Slant must follow the word: up to the right on italics, near level (a tiny shake) on upright type. Drawing it the wrong way round is the obvious tell.
- Width ~0.12 em in the middle, ends at about 0.6 of that; edges lightly ragged, neither a perfect CSS bar nor torn.
- Warm near-black or accent ink multiplied over a paper ground; whole shot about 75 frames (2.5 s): title in 22, stroke at 32-42, hold 33.

## Sound for it
A very quiet dry pen / paper scratch under the stroke (-18 dB) or nothing.

## Common mistakes
- Slope the wrong way, or the stroke far below the word.
- Making the stroke slow like a loading bar.
- Underlining several words.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/typography/marker-underline-title.md` (Apache-2.0; see ../NOTICE).
