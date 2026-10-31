---
id: shot-line-carry-transition
kind: technique
summary: "When two scenes share a graphic: a finished progress bar runs on as a line, the camera follows, it boxes the next scene."
categories: [saas-app-launch, product-launch-film, brand-story-corporate, kinetic-type-motion-design, animated-explainer]
tools: [apply_motion_transition_tool, add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [elegant, graphic, designed]
aspect: ["16:9", "1:1"]
pairs_with: [shot-match-iris-window, kinetic-lower-third, t069]
avoid_with: [shot-hidden-cut-masks, shot-bottom-push-chapters, shot-solid-page-wipes]
needs: [path-write-on]
---

# Line carry transition

## What it is
There is no cut: scene A's progress bar fills, its end runs on as a line out of the card, the camera pans with the line
across a second frame width, and the line turns corners to draw scene B's frame; when the frame closes, B's content
fades in. The eye never leaves the line. Signature move: one per film.

## Build it in Zenvi
The drawn, corner-turning line is not available (`needs: path-write-on`). Honest fallback in three layers:
1. Scenes side by side as one wide move: `apply_motion_transition_tool {"preset": "slide", "clip1_id": "<A>", "clip2_id": "<B>",
   "direction": "left", "duration": 1.9, "intensity": 1}` (about 56 f, smooth in-out) in place of the card's 3840 px world pan.
2. A line carried by scene A's own graphic: the nearest stock line is the rule of `add_motion_block_tool {"block": "lower_third",
   "params": {"name": "Rendering", "role": "done"}, "position_seconds": 0.3, "duration_seconds": 2.6, "placement": "over_video"}`
   (a rule drawing across under a label), or a `chart_build` line that ends on the right edge. Neither turns corners or
   boxes B; they only keep a line on screen while the slide runs.
3. B's frame and content appear after the slide has landed, never during it: `add_kinetic_title_tool {"text": "...", "animation": "rise",
   "position_seconds": <landing + 0.3>}`.
4. `add_sfx_tool {"recipe": "paper", "at_seconds": 1.0, "gain_db": -22}` for the line; `{"recipe": "ui_tap", "at_seconds": <close>}` for the frame closing.

## Timing & taste rules
- Sequence: bar fills 36 f, pause 6 f (state flips to done, a check pops), line runs out 10 f, pan 56 f, frame closes 24 f,
  poster inside 30 f, still 24 f. About 6.3 s total.
- Pan 1920 px in 56 f (34 px/f mean); farther moves get longer, not faster (above 80 px/f the nib is lost).
- The nib sits at about 77 % of the frame width (not centred), so the line is never ahead of or behind the camera.
- Speed is continuous at every handover: ease-out into rest, rest 6 f, ease in-out through the pan, in-out into the closing frame.
- Line: 8 px, square caps, hard right-angle corners (round corners lose the draughtsman feel); a dashed line reads unfinished.
- The line must start from an existing graphic that finished (bar full, underline drawn); a line out of nowhere is a screensaver.
- The frame must close before B's content appears. Remove the nib dot after the frame closes (no leftover, the end is still).
- Motion blur on the world, not on the line (up to 16 px).

## Sound for it
A continuous pencil scratch while the line grows (`paper` -22 dB), a light knock when the frame closes.

## Common mistakes
- Speed jumps at a handover; the viewer loses the line.
- Using it twice.
- Mixing hand-drawn and hard-ruled lines in one film.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/transition/line-carry-transition.md` (Apache-2.0; see ../NOTICE).
