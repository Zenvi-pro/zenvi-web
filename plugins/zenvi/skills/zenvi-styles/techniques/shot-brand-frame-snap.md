---
id: shot-brand-frame-snap
kind: technique
summary: "When a screen recording needs packaging that marks chapters: a thick colour frame that hard-flips on a mode change."
categories: [saas-app-launch, product-launch-film, brand-story-corporate, tech-review]
tools: [add_title_tool, add_clip_to_timeline_tool, set_keyframes_tool, add_kinetic_title_tool, apply_fx_tool, add_sfx_tool]
pace: medium
mood: [branded, mechanical, clean]
aspect: ["16:9"]
pairs_with: [shot-cursor-flyover, shot-scan-annotate, kinetic-lower-third]
avoid_with: [shot-slam-entrance, shot-light-sweep]
needs: []
---

# Brand frame snap (one border colour, three jobs)

## What it is
A thick, flat colour frame grows round the whole picture before the content lands in it. After that the frame's colour is the film's code:
blue = mode A, orange = mode B. At a chapter or mode change the entire frame flips colour on one frame (no gradient),
the layout inside changes on the same frame and the badge text swaps. The flip is the visual twin of a gear-change sound.
It brands a raw screen recording without a watermark.

## Build it in Zenvi
1. Frame colour as a full-frame card under the recording: `add_title_tool {"template":"Solid_Color","text":" ","background_color":"#2F55FF","position_seconds":0,"duration_seconds":2.8}`
   then a second card for the second mode: `{"background_color":"#FF5B1F","position_seconds":2.8,"duration_seconds":2.0}` (hard cut at the flip, no fade).
2. Recording clip on the track above: `add_clip_to_timeline_tool {"file_id":"<capture>","position_seconds":0}`. Make the frame visible by shrinking it:
   `set_keyframes_tool property=scale_x` and `scale_y`: `[{"seconds":0,"value":1.0},{"seconds":0.63,"value":0.89,"ease":"ease_out_cubic"}]`, with `corner_radius` ~0.02. 89 % scale leaves a ~60 px frame on 1080p, so the frame "grows" as the content shrinks.
3. The content lands after the frame: keyframe `location_y` 0.6 to 0 with `ease_out_back`, scale 0.88 to 0.89, over ~0.4 s starting 10 f after the frame has grown. Add a baked `directional_blur` (angle 90) on the drop only.
4. The flip (same frame as the colour cut): the layout changes by cutting to the second capture (second `add_clip_to_timeline_tool` at 2.8 s on the same track); badge text swap via two `add_kinetic_title_tool` pills (`DESIGN` then `DEV MODE`) positioned on the frame band.
5. Punch on the flip: a 3-frame white flash `apply_motion_transition_tool {"preset":"flash_white","duration":0.1,"intensity":0.6}` on the cut; a quick `scale` 0.89 to 0.884 to 0.89 over 4 frames as the "gear" thump.

## Timing & taste rules
- Frame thickness 60 px at 1080p (below it reads as a stroke; above 64 px it eats the content). Grows in 19 f (`snappy`), 10 f before the window lands. Badge 30 px bold caps.
- Flip at ~84 f (2.8 s) after the window has been settled for >= 30 f, so the viewer has learned "blue = now". Flash 3 f stepped, 0.6 to 0.2; > 4 f reads as strobing.
- Four things on the same frame: frame colour, inner layout, badge, toggle state. Two frames off and it falls apart into three small animations.
- Hue-opposed colours with different lightness (cobalt vs orange). Keep UI inside neutral ink; accent only follows the mode.
- Flip at most twice per film. Frame is packaging, not the star.

## Sound for it
One dry mechanical `toggle` or `mouse_click` (-12 dB) on the flip frame with the flash; the growth stays quiet.

## Common mistakes
- Colour code diluted: a green hero element inside the blue chapter.
- Frame arrives after the content: it looks like a repair.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/effects/brand-frame-snap.md` (Apache-2.0; see ../NOTICE).
