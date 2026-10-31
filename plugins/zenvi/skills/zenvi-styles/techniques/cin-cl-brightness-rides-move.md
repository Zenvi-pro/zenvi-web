---
id: cin-cl-brightness-rides-move
kind: technique
summary: "When a logo slams in oversized or an icon lifts to camera: its brightness follows the move, full only on landing."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, color_grade_clip_tool, add_sfx_tool]
pace: fast
mood: [weighty, cinematic, controlled]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [shot-slam-entrance, cinematic-push-in, shot-brand-frame-snap]
avoid_with: [cin-cl-ink-resolve]
needs: [true-motion-blur-native]
drawn: cinetic
---

# Brightness rides the move

cinetic `cl-brightness-rides-move` · Colour and light · accent · energy high · formats launch, sting, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A mark or icon takes its brightness from the same progress that drives its scale or depth, so an oversized pass stays a dark shape and the object reaches full brightness exactly as it lands.

Use when: A logo mark or icon slams in oversized and shrinks to size, an icon lifts out of the UI toward camera, or a field of objects at several depths is pushed through on a dark stage.

## Build it in Zenvi

1. Place the mark (a PNG with alpha) at 4.0 s on track 3: `add_clip_to_timeline_tool {"file_id": "<logo>", "position_seconds": 4.0, "track": "3", "duration_seconds": 3}`.
2. Slam it in from 7x, log-scale so each step covers the same ratio (66 f = 1.1 s): `set_keyframes_tool {"timeline_clip_id": "<logo>", "property": "scale_x", "ease": "linear", "points": [{"seconds": 4.0, "value": 7}, {"seconds": 4.275, "value": 4.31}, {"seconds": 4.55, "value": 2.65}, {"seconds": 4.825, "value": 1.63}, {"seconds": 5.1, "value": 1}]}` and the same on `scale_y`.
3. Tie the fill to the move. Copy the mark, grade the copy to a dark grey (about luma 60) with `color_grade_clip_tool {"timeline_clip_id": "<dark_copy>", "exposure": -1.5}`, put it above the bright original, and fade it out late (1 minus p cubed): `set_keyframes_tool {"timeline_clip_id": "<dark_copy>", "property": "alpha", "ease": "linear", "points": [{"seconds": 4.0, "value": 1}, {"seconds": 4.275, "value": 0.98}, {"seconds": 4.55, "value": 0.88}, {"seconds": 4.825, "value": 0.58}, {"seconds": 5.1, "value": 0}]}`. The mark passes mid-grey only in the second half and is full white on the landing frame.
4. `add_sfx_tool {"recipe": "impact_slam", "at_seconds": 5.1, "gain_db": -6}` on the landing frame, `{"recipe": "whoosh_fall", "at_seconds": 4.3, "gain_db": -14}` under the scale-down.

Fallback: No native timeline motion blur exists for keyframed moves; the oversized pass will look sharp-edged. Keep the starting scale at 4-5x instead of 7-8x, keep edges under 80 px per frame, and bake the blur into the mark's file with a radial blur FX before placing it.

## Timing & taste rules

- cinetic's timing (60 fps): Slam: 66 f (1.10 s) on ease_out_cubic from s0 = 6-8. The fill follows p^3, so it passes mid-grey only in the second half of the move and reaches full brightness on the landing frame. Lift-out: 24 f (0.40 s) of travel on ease_in_out_expo, with the inversion complete at 75% (about 18 f (0.30 s)); a mid-grey tile goes from about luma 160 to 248. Depth weights are 0.45 / 0.75 / 1.0 by z, re-read every frame of the push. Motion blur stays on while |delta log s| > 0.1 per frame, and edges stay under 80 px/f.
- Slam: 66 f (1.1 s) from 6-8x down to 1; the fill follows progress cubed, so full brightness lands exactly on the last frame.
- While the mark is 3x or more its final size and covers much of the frame it stays under about luma 60, so the frame's mean luma never flashes.
- Lift toward camera: 24 f (0.4 s, ease_in_out_sine), the inversion finishing at 75 % (about 18 f, 0.3 s): a mid-grey tile goes from about luma 160 to 248.
- Depth field weights: 0.45 far, 0.75 mid, 1.0 near, re-read on every push frame.
- Edges stay under 80 px per frame.

## Sound for it

One `impact_slam` on the landing frame, a falling whoosh under the shrink; the brightening itself is silent.

## Common mistakes

- Text; use the ink-resolve move, which runs on time.
- Moves under about 150 px or 1.5x, where the brightness change would not show.
- Giving the oversized mark a white fill on a light stage; mix toward the paper there so the pass is not itself the flash.
- Avoid when: Text (use cl-ink-resolve, which runs on time), and moves under about 150 px or 1.5x, where the change would not show. On a light stage a giant near-black pass would itself be the flash, so mix toward the paper there.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-brightness-rides-move`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
