---
id: shot-before-after-scrub
kind: technique
summary: "When the claim is before vs after: a divider flicks across fast, pauses, then scrubs back slowly to show the change."
categories: [saas-app-launch, product-launch-film, tech-review, ugc-ad-testimonial, vfx-tutorial-breakdown]
tools: [add_clip_to_timeline_tool, apply_clip_preset_tool, add_shape_mask_tool, set_keyframes_tool, add_kinetic_title_tool, add_sfx_tool]
pace: medium
mood: [proof, satisfying, clear]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-scan-annotate, kinetic-counter, kinetic-lower-third]
avoid_with: [shot-crash-zoom-punch, shot-slam-entrance]
needs: [ab-compare-layout]
---

# Before / after slider scrub

## What it is
Two versions of the same frame, stacked; a round-handled vertical divider swings from the left to 70 % with an overshoot,
stops for a beat, then returns at one fifth of the speed so the eye can find the difference. Fast swing: "it changed".
Slow scan: "here is what changed". Where it shines: enhance / optimise / refactor / grade comparisons.

## Build it in Zenvi
No driven divider tool (`needs: ab-compare-layout`). Closest recipes:
1. Both versions on two tracks, identical layout and framing (before below, after above). Use real "before" captures, not an artificially ugly one.
2. Reveal the after clip with the closest edge-following reveal: `apply_clip_preset_tool {"timeline_clip_ids":["<after>"],"preset":"wipe_in_from_left","duration_seconds":0.4}`
   (full reveal in 0.4 s). Or mask it: `add_shape_mask_tool {"clip_ids":["<after>"],"shape":"rectangle","x":0.5,"y":0.5,"width":1.0,"height":1.0,"feather":0,"keyframes":[{"seconds":0,"grow":-1},{"seconds":0.4,"grow":0},...]}` (this grows from the centre, so it reads as an iris, not a divider).
3. Divider line + handle: a thin `Solid_Color` title bar is not enough alone; keyframe a handle still (`set_keyframes_tool property=location_x`) with the same curve as the reveal so edge and handle stay together.
4. Labels BEFORE / AFTER via `add_kinetic_title_tool {"text":"AFTER","style":"stack","animation":"pop","text_size":0.04}` placed inside the content, not over the sidebar/avatar.
Fully faithful scrub (fast swing, hold, slow return) waits on the compare layout tool; today do the fast reveal then cut to a locked split.

## Timing & taste rules
- 4-5 s. Stages: rest at 8 % (14 f, a 1.5 % pull-back first) | swing 8 to 76 % in 12 f (`ease_out_cubic`) | settle to 70 % in 12 f | hold ~18 f | slow scan 70 to 40 % over ~48 f | freeze >= 40 f.
- Speed ratio ~5:1; under 3:1 the contrast is not felt. Reveal edge and divider must be the same x or it looks broken.
- Handle stretches in x by up to 1.18 with speed, back to 1 at rest. End on 40 %, not 0 %: the "after" stays on screen as the conclusion.
- Same layout and camera in both states; changing the layout means two pages, not a comparison.

## Sound for it
`whoosh_short` (-16 dB) on the swing, `ui_tap` on the settle, slow scan silent or a barely audible `cloth` (-30 dB).

## Common mistakes
- "Before" so ugly it looks staged.
- Labels covering the avatar or sidebar.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/data/before-after-slider-scrub.md` (Apache-2.0; see ../NOTICE).
