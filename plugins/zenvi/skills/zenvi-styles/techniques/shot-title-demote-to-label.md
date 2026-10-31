---
id: shot-title-demote-to-label
kind: technique
summary: "When a chapter title should stay as the section label: it holds big, then shrinks to the corner as content grows."
categories: [kinetic-type-motion-design, saas-app-launch, animated-explainer, video-essay-explainer, tech-review]
tools: [add_kinetic_title_tool, get_clip_properties_tool, set_keyframes_tool, add_motion_block_tool, add_sfx_tool]
pace: calm
mood: [orderly, editorial, instructive]
aspect: ["16:9"]
pairs_with: [shot-blur-slide, kinetic-mask-reveal, kinetic-lower-third]
avoid_with: [kinetic-beat-strobe, shot-lead-word-zoom-assemble, kinetic-word-pop]
needs: []
---

# Title demotes to a section label

## What it is
The chapter title appears centred and big, holds a beat, then in one continuous move shrinks to about 0.22x and flies to the top-left
as the section's label. The viewer keeps the big word as a door sign: the content blocks have already begun to grow beneath it,
so the hand-off has no empty gap. Tutorials, feature tours, chaptered explainers. A second chapter reuses the same label slot.

## Build it in Zenvi
A native title plus keyframes: shrink and fly on the same curve, pivoting so the word travels from the centre to the corner.
```json
add_kinetic_title_tool {"text": "Frame.", "style": "editorial", "animation": "rise", "emphasis": "none", "text_size": 0.22, "y": 0.5, "position_seconds": 0, "duration_seconds": 5}
get_clip_properties_tool {"timeline_clip_id": "<title>"}       (base scale s0, location x0 y0; the receipt box gives the word's centre T)
set_keyframes_tool {"timeline_clip_id": "<title>", "property": "scale_x", "ease": "ease_in_out_quart", "points": [{"seconds": 1.2, "value": <s0>}, {"seconds": 2.07, "value": <s0 * 0.22>}]}
(scale_y the same; location_x/y from the position that keeps the centre at T to the one that puts it at (0.11, 0.18): location = target - s*c, as in shot-lead-word-zoom-assemble)
add_motion_block_tool {"block": "kinetic_headline", "position_seconds": 1.6, "duration_seconds": 3.4, "placement": "over_video", "params": {"text": "Plan the shot, / then *capture* it.", "style": "rise", "align": "left", "position": "lower", "max_size": 90, "palette": "mono"}}
add_sfx_tool {"recipe": "whoosh_short", "at_seconds": 1.2, "gain_db": -18}
```
The content (cards, text) starts when the title is 12 frames into its flight, each block growing from the left (a `Crop` right-edge keyframe 0.7 to 0
plus a 30 px rise); line rules last, so they are not crossed by the title. Several chapters: the old label moves up one row,
shrinks to 0.7x and greys, the new one lands in the freed slot.

## Timing & taste rules
- Demotion: one asymmetric ease-in-out of 26 frames (0.87 s, bezier 0.6, 0, 0.18, 1) for the scale to 0.22 (a 220 px title becomes about 48 px) and the move together. Two stages (shrink, then fly) read as two actions.
- Hold the big title 18 frames (0.6 s) or more after it has settled; shorter and the announcement is eaten.
- Label end size: not above 0.45x (it presses on the content), and not below 40 px (unreadable). Titles of at most three words.
- Content grows in 18-22 frame blocks, dense first and sparse after; if everything arrives at once it reads as a page refresh. Start it 12 frames after the flight begins (waiting for the landing leaves an 8-frame void).
- Nothing else moves along the flight path: pop-ups and cursors steal the move.
- A selection-highlight variant (accent 20 % band sweeping in 10 frames, held 10, cleared in 8 before the flight) gives text/editor products an identity hint; never leave the band on during the flight.

## Sound for it
A soft short whoosh as the label starts to fly (-18 dB); optional tick when the first block lands.

## Common mistakes
- Setting the scale without the position compensation (the title leaves its path or lands off the corner).
- Stacking each chapter label on top of the last (a graveyard in the corner).
- Titles longer than three words: at 0.22x they become a grey line.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/typography/title-demote-to-label.md` (Apache-2.0; see ../NOTICE).
