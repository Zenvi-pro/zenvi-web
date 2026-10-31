---
id: split-screen-compare-layout
kind: technique
summary: "When the claim is before vs after: two strips side by side with a thin divider and short labels, 2.4-4 s."
categories: [ugc-ad-testimonial, vfx-tutorial-breakdown, video-essay-explainer]
tools: [add_clip_to_timeline_tool, add_shape_mask_tool, set_clip_properties_tool, add_title_tool, add_effect_tool, add_sfx_tool]
pace: medium
mood: [credible, clear, direct]
aspect: ["9:16", "16:9", "1:1", "4:5"]
pairs_with: [circular-problem-to-proof-bookend, screen-capture-zoom-onto-the-number, action-per-cut-micro-demo-with-live-foley]
avoid_with: [text-between-subject-layers, multi-panel-and-card-video-layout]
needs: [ab-compare-layout, video-card-cascade-layout]
---

# Split-screen compare layout

## What it is
Before and after (raw vs edit, day 1 vs day 30) in two strips with a thin
divider and small labels, held 2.4-4 s; or a raw card at 65 % left and the
result at 85 % right over a blurred copy.

## Build it in Zenvi
On 9:16, two vertical strips of each clip's centre:
```json
add_clip_to_timeline_tool {"file_id": "<before>", "position_seconds": 0, "start_seconds": 1, "end_seconds": 5}
add_clip_to_timeline_tool {"file_id": "<after>", "position_seconds": 0, "start_seconds": 1, "end_seconds": 5, "track": 2}
add_shape_mask_tool {"clip_ids": ["<before clip>"], "x": 0.5, "width": 0.495, "height": 1.0, "feather": 0}
add_shape_mask_tool {"clip_ids": ["<after clip>"], "x": 0.5, "width": 0.495, "height": 1.0, "feather": 0}
set_clip_properties_tool {"timeline_clip_ids": ["<before clip>"], "properties": {"location_x": -0.25}}
set_clip_properties_tool {"timeline_clip_ids": ["<after clip>"], "properties": {"location_x": 0.25}}
```
The mask is drawn in the clip's own frame, so mask the centre (x 0.5) and then
move the clip; masking at x 0.25 and moving as well cut the wrong strip in the
test. Labels: `add_title_tool` per label (centred template), then
`set_clip_properties_tool {"properties": {"location_x": "<\u22130.25>", "location_y": 0.36}}` on its clip.
The 0.005 gap between the masks is the divider. A one-call A/B layout with
staggered boxes or a blurred background copy needs `ab-compare-layout`.

## Timing & taste rules
- 2.4-4 s per compare; both strips start together; same framing and scale.
- Labels 4-6 % height, bottom or top band, white or the accent.
- One compare per claim; the payoff side on the right.

## Sound for it
A pop on the labels at -18 dB; the bed carries; a swoosh if the layout slides in.

## Common mistakes
- Labels that collide in the middle (kinetic titles centre themselves; use
  titles you can move).
- Clips that end before the labels (black strips: first test).
- Low-resolution sources at full strip height (the judge called it pixelated).

## Verified
2026-10-28: 4 s test, woman washing face (before) and applying cream (after),
centre strips side by side, BEFORE / AFTER labels moved into each half, pop +
acoustic bed. Three passes: wrong strip (mask at 0.25), labels collided, then
correct. Watch judge overall 2.09-2.64: static layout, soft sources, abrupt end;
the layout itself reads.
