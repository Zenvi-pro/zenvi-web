---
id: multi-panel-and-card-video-layout
kind: technique
summary: "When one look or take should multiply: 2-6 panels with thin gutters stepping on the snare, or cards dropping in."
categories: [fashion-beauty-ad, ugc-ad-testimonial]
tools: [add_motion_template_tool, add_motion_block_tool, duplicate_clips_tool, add_shape_mask_tool, set_keyframes_tool, detect_beats_tool, add_sfx_tool]
pace: fast
mood: [editorial, rhythmic, bold]
aspect: ["9:16", "1:1", "4:5", "16:9"]
pairs_with: [accelerating-cut-length-ramp, persistent-frame-mask-over-whole-video, letter-indexed-object-then-look-cycle]
avoid_with: [split-screen-compare-layout, text-between-subject-layers]
needs: [video-card-cascade-layout]
---

# Multi-panel and card video layout

## What it is
The frame splits into 2-6 panels of the same dancers or looks, black gutters
2-4 px, layouts changing on snare hits every 0.7-2.7 s (fashion); or 3-4
rounded vertical video cards dropping onto a clean field 6-8 frames apart with
a click each (UGC social proof).

## Build it in Zenvi
- Panels on the beat, one call:
  ```json
  add_motion_template_tool {"template": "grid", "file_ids": ["<a>", "<b>", "<c>"],
    "position_seconds": 0, "duration_seconds": 6, "bpm": 120, "gutter": 0.006}
  ```
  Give at least as many distinct files as panels (with 3 files in 4 panels the
  test repeated one take side by side, which the judge flagged).
- Cards: `add_motion_block_tool {"block": "card_shuffle", "params": {"media_1": "<id>",
  ...}}` for one card flipping through looks; true staggered video cards with
  shadows need `video-card-cascade-layout` (fallback: `duplicate_clips_tool`,
  `set_clip_properties_tool` scale 0.45 + location per card, `add_shape_mask_tool`
  rounded-ish rectangle, `set_keyframes_tool` scale 0.9→1.0 and alpha per card
  6-8 frames apart, `add_sfx_tool` `ui_tap` per card).

## Timing & taste rules
- Layout steps on snares or every 2 beats, 0.7-2.7 s per layout.
- Gutters 2-4 px black (gutter 0.004-0.006); no rounded corners on panels.
- A layout phase lasts 15-30 s at most, then back to full frame.

## Sound for it
The music's snare does the work; a tick at -20 dB per panel change if the
track is soft; one click per card.

## Common mistakes
- Repeating the same footage in two visible panels.
- Panels snapping in without the beat.

## Verified
2026-10-28: 6 s test, three fashion clips (stock) in the `grid` template at
120 bpm, house bed. Contact sheet: panels fill one by one, black gutters.
Watch judge motion 2 → overall 4.09 after the bed fix; notes: panels appear as
raw crops without easing, and a repeated take; use more distinct clips.
