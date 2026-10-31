---
id: shot-crane-rise-reveal
kind: technique
summary: "When an opening should go from detail to whole product: start tight on one row, crane back until the screen fills."
categories: [saas-app-launch, product-launch-film, tech-review, brand-story-corporate]
tools: [set_keyframes_tool, add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [confident, expansive, clean]
aspect: ["16:9", "9:16"]
pairs_with: [shot-brand-ink-open, shot-type-and-filter, kinetic-counter]
avoid_with: [shot-dataviz-landscape-open]
needs: [screen-capture-smart-zoom]
---

# Crane-rise reveal

## What it is
The mirror image of a dive-in: the camera starts tight on one real data row, then rises and pulls back on one decelerating curve while rows flood the
frame until the whole screen sits at standard framing. "That one row is a single cell of this wall."

## Build it in Zenvi
One screen capture (record or generate it at 2-3x the project size; a 3x start on a 720p source is mush) and `set_keyframes_tool` for scale and offset. To keep
the aim point at the frame centre while the scale is s, offset the clip by -s * (aim - centre) in frame fractions. With the aim at (-0.242, -0.160) from the centre:
```json
set_keyframes_tool {"timeline_clip_id": "<capture>", "property": "scale_x", "ease": "ease_out_cubic", "points": [{"seconds": 0, "value": 3.0}, {"seconds": 0.6, "value": 3.045, "ease": "ease_in_out"}, {"seconds": 3.3, "value": 1.0}]}
set_keyframes_tool {"timeline_clip_id": "<capture>", "property": "location_x", "ease": "ease_out_cubic", "points": [{"seconds": 0, "value": 0.7266}, {"seconds": 0.6, "value": 0.7375, "ease": "ease_in_out"}, {"seconds": 3.3, "value": 0}]}
```
`scale_y` as `scale_x`; `location_y` with 0.479 / 0.486 / 0 (0.1597 x scale). Same ease and times on all four keeps the aim glued to the centre; a straight line in scale gives a
straight line in offset. Optional: `add_motion_block_tool {"block": "counter", "params": {"values": ["0", "48210"], "label": "frames rendered"}, "position_seconds": 0.6, "duration_seconds": 2.7}` if the capture has no readout of its own.
Add a `whoosh_rise` peaking at the end of the pull. For the row washes and the status flip (`Rendering` -> `Rendered`) shoot them into the capture itself.

## Timing & taste rules
- 165 frames at 30 fps: 24 hold, 102 pull, 39 settle. The pull is a 3.0 -> 1.0 scale on a fast-then-slow curve (0.2, 0, 0.25, 1); the peak speed is ~19 % in,
  about 2.3x the average. Start from rest after a 1.5 % push during the hold (the camera "takes a breath").
- In the hold only the tracked row is bright and the others are at ~38 %; bring them back to 100 % over the first ~26 frames of the rise.
- Row washes must be triggered when the camera's top edge crosses each row, not at fixed intervals.
- Aim at least 213 px inside every page edge for a 3x start (640 / 3), or the clip's edge shows (the first test did, with black bars).
- On white pages a brightness lift is invisible; darken or colour.
- No extra push once full; keep alive by a small event (status flip) and hold >= 1 s.
- Do not combine with a dive-in landing in one film.

## Sound for it
`add_sfx_tool {"recipe": "whoosh_rise", "at_seconds": 3.0, "gain_db": -5}`; a `ui_tap` on the status flip.

## Common mistakes
- Blurring the slow end of the pull (it softens the text; blur only the fast first half).
- Overlays with multiple samples under motion blur (stripe artefacts).

## Verified
2026-10-29, CLI on a generated 3840x2160 table mock: scripts/shot-crane-rise-reveal.sh → shots/shot-crane-rise-reveal.mp4 (local only). Checked on the sheet: the highlighted row stays on the same screen line while the table pulls back from 3x to full, decelerating, no clip edge showing in the final recipe (the first try with the aim 140 px from the edge showed black bars). Watch judge (absolute): **2.8/10**; main note: "...the graphics are heavily pixelated and low-resolution placeholders rather than crisp UI elements, and the camera pull-back lacks natural easing." (blocky boxes mock, not the technique.)

Adapted from video-shotcraft card `shots/opening/crane-rise-reveal.md` (Apache-2.0; see ../NOTICE).
