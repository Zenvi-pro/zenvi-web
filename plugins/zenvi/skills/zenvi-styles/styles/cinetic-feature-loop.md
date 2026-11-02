---
id: cinetic-feature-loop
kind: style
summary: "For a landing-page hero or muted social loop: the product acting from frame 0, a cycle with no visible restart."
categories: [cinetic-feature-loop]
tools: [produce_video_tool, get_technique_tool, create_scene_tool, update_scene_tool, render_scene_tool, scene_cues_tool, auto_sound_design_tool, master_audio_tool, export_video_tool, review_render_tool, watch_render_tool]
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

The film is one scene (family `zenvi-scenes`, `get_technique_tool {"technique": "zenvi-scenes"}`):
`produce_video_tool` drafts it from `scenes-feature-loop` with the request's name; rewrite it for this product.
No `build_product_launch_tool`, titles, blocks or 3D on top of it.

```json
produce_video_tool {"request": "<the brief, verbatim>", "style": "cinetic-feature-loop", "length_seconds": 10, "output": "film.mp4"}
get_technique_tool {"technique": "scenes-feature-loop"}
update_scene_tool {"scene_id": "<data.scene.scene_id>", "code": "<the module rewritten: this product's device, copy and brand>"}
render_scene_tool {"scene_id": "<id>", "motion_blur": 4}
auto_sound_design_tool {"genre": "saas_ui", "intensity": "subtle"}
master_audio_tool {"preset": "social", "iterate": true}
export_video_tool {"output_path": "film.mp4"}
review_render_tool {"path": "film.mp4"}
watch_render_tool {"path": "film.mp4"}
```

Muted on a page ("autoplays muted", "without sound"): `produce_video_tool` adds no music, sound or mix.

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
