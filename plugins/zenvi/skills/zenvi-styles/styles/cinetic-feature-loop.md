---
id: cinetic-feature-loop
kind: style
summary: "For a landing-page hero or muted social loop: the product acting from frame 0, a cycle with no visible restart."
categories: [cinetic-feature-loop]
tools: [produce_video_tool, save_brief_tool, get_brief_tool, get_technique_tool, set_project_setting_tool, add_clip_to_timeline_tool, set_keyframes_tool, add_motion_block_tool, add_kinetic_title_tool, review_edit_tool, export_video_tool, review_render_tool, save_frame_image_tool]
pace: calm
mood: [calm, alive, precise, quiet]
aspect: ["16:9", "1:1", "4:5", "9:16"]
pairs_with: [cin-cam-seamless-loop-orbit, cin-ui-row-cascade, cin-ui-live-reflow, cin-mi-two-beat-confirm-cascade]
avoid_with: [cin-le-device-becomes-mark, kcut-hit-fx]
needs: []
---

# Cinetic feature loop

A 4-15 s loop that autoplays muted on a landing page or a feed and repeats forever without a visible
restart: the product already acting in the first 2 s, built as a cycle (conveyor, relay or state
round-trip), not enter -> hold -> exit. Method: `METHOD-cinetic.md` (the scaled-down path). After cinetic
(MIT, (c) 2026 Leonxlnx; see NOTICE).

## When to use / not

Use for "a hero loop", "an animated feature for the site", "a looping GIF of the feature", a muted social
post. A loop with a story and an end card is a short `cinetic-launch-film`. Not for anything that needs
sound to work.

## Structure (beats with timings)

A whole number of bars, no tail: 9.6 s = 4 bars at 100 BPM, 8 s = 4 bars at 120. 3-5 beats.

| beat | 8 s | 9.6 s | 14.4 s |
| --- | --- | --- | --- |
| The product already acting: the cause under way (a row arriving, a card dragged) | 0-2 | 0-2.4 | 0-2.4 |
| The product acts: one peak per bar, 0.5-1.2 s of real calm between peaks | 2-6 | 2.4-7.2 | 2.4-12 |
| Return through an action: the last state becomes the first (the seam is one moment of one motion) | 6-8 | 7.2-9.6 | 12-14.4 |

## Shot plan

- One continuous take or 2-3 cuts on downbeats; the camera floats on a periodic drift (a whole number of
  cycles per loop) so the frame never locks off.
- The feature's name is on screen as a UI label (a tab, the button that causes the action) readable at
  480 px; frame 0 is the poster: composed, the product's chrome or name in it.

## Look & grade

The brand's ink and paper and one accent; the accent marks what just happened. No glow, gradients dithered.

## Type system

At most 6 words, at most 4 visible, reading muted; text fully resolved or fully gone at the seam.

## Motion & transitions

- Everything at rest before the seam, or part of a motion that continues identically after frame 0.
- Periodic moves: two keyframes per cycle with `ease_in_out_sine`, value at the end equal to the start.
- Calm eases only; no fast moves (nothing over 12 px/f, so no blur pass).

## Sound & music

Ships muted. With sound: let the last bar's tails decay before the seam.

## Captions/VO

None.

## Tool sequence

```json
produce_video_tool {"request": "<the brief>", "style": "cinetic-feature-loop", "length_seconds": 9.6, "skip": ["music", "sound"]}
get_brief_tool {}
get_technique_tool {"technique": "<each drawn pick>"}
set_project_setting_tool {"fps": 60}
add_clip_to_timeline_tool {"file_id": "<product recording, the cycle>", "position_seconds": 0, "start_seconds": 0, "end_seconds": 9.6, "track": "1"}
set_keyframes_tool {"timeline_clip_id": "<it>", "property": "location_y", "points": [{"seconds": 0, "value": 0}, {"seconds": 4.8, "value": -0.006, "ease": "ease_in_out_sine"}, {"seconds": 9.6, "value": 0, "ease": "ease_in_out_sine"}]}
add_motion_block_tool {"block": "notification_stack", "position_seconds": 0, "duration_seconds": 9.6, "params": {"display_font": "sans", "exit": false}}
review_edit_tool {}
export_video_tool {}
review_render_tool {"path": "<render>"}
save_frame_image_tool {"time": 0}
```

Check the seam: the last frame and frame 0 side by side in `review_edit_tool {"start": 9.4, "end": 9.6}` and
`{"start": 0, "end": 0.2}`; the step across the seam is no bigger than the median step at the ends.

## Finish checklist

- [ ] The product and the action in the first 2 s; frame 0 names the product.
- [ ] A cycle, not enter-hold-exit; no fade at the seam; nothing still settling at the last frame.
- [ ] At most 6 words; the feature's name readable at 480 px; no house-ban line.
- [ ] One peak per bar with real calm between; tiring on the third pass is a fail.

## Mix-and-match

The draw (format loop) gives UI choreography and micro-interactions first. Never an end card, a lockup or
hits on every cut.

## Reference moments

cinetic's Quire Streaks loop (local only, `~/zenvi-motion/refs2/cinetic/`): the streak advancing one step per
cycle so the seam is invisible.
