---
id: shot-type-to-pill
kind: technique
summary: "When typed text should become a thing (tag, chip): hard cut from typed word to pill, glide into place, hard cut to page."
categories: [saas-app-launch, product-launch-film, animated-explainer, kids-education]
tools: [add_kinetic_title_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [crisp, confident, playful]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-type-and-filter, kinetic-typewriter]
avoid_with: [shot-canvas-materialize]
needs: []
---

# Typed word becomes a pill

## What it is
A word with a hash is typed in the middle of a plain page, then in ONE frame it becomes a big pill label (no morph, no fade), holds, glides smaller to
its slot, and a second hard cut shows the finished page. Two hard cuts around one slide: that rhythm is the whole shot.

## Build it in Zenvi
```json
add_kinetic_title_tool {"text": "#shots", "style": "documentary", "animation": "typewriter", "emphasis": "none", "ink": "#2a2a2a", "background": "#f3efe6", "text_size": 0.16, "y": 0.5, "position_seconds": 0, "duration_seconds": 1.7}
```
Then, with no transition between them: a pill still (rounded rectangle, light grey, icon + the same word, 740 px wide on a 1080 frame) from 1.7 s to 2.3 s,
which then moves and shrinks to its slot, followed by the finished-page still:
```json
set_keyframes_tool {"timeline_clip_id": "<pill>", "property": "scale_x", "ease": "ease_in_out_cubic", "points": [{"seconds": 1.7, "value": 1.03}, {"seconds": 1.8, "value": 1}, {"seconds": 2.3, "value": 1}, {"seconds": 2.77, "value": 0.55}]}
set_keyframes_tool {"timeline_clip_id": "<pill>", "property": "location_x", "ease": "ease_in_out_cubic", "points": [{"seconds": 2.3, "value": 0}, {"seconds": 2.77, "value": -0.31}]}
```
(same for `scale_y` and `location_y`). Zenvi scales about the clip centre: compute `location` so the pill's centre lands at the slot centre. The page still starts the frame after the pill ends (`position_seconds` 2.8).
The red solid caret is not a parameter of the title; leave it out or put a tiny red bar still that never blinks.

## Timing & taste rules
- Typing 4-6 frames per character with deterministic jitter (~6 characters a second); the caret stays on and never blinks.
- Materialise in exactly one frame; at most a 3-frame 1.03 -> 1 settle. Any fade or expand turns it into a standard morph.
- Hold ~18 frames (0.6 s). Glide ~14 frames (0.47 s), to ~0.55x, scale and position on the same curve (0.5, 0, 0.25, 1 ~ `ease_in_out_cubic`).
- The reveal is a second hard cut 3 frames after the pill lands; with a transition there the skeleton is gone.
- The pill must be oversized and ring-free; a border makes it a button.
- Do not add a fly-in-to-a-note-card phase between pill and page.

## Sound for it
`keyboard_key` per character, a `pop` (-12) on the materialise cut, a `swish_airy` (-20) on the glide, nothing on the page cut.

## Common mistakes
- Softening a hard cut into a cross-fade.
- Splitting scale and move into different eases.
- A blinking caret (the original does not blink).

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/interaction/hashtag-to-pill-materialize.md` (Apache-2.0; see ../NOTICE).
