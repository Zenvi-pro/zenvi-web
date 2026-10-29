---
id: tactile-plate-animation
kind: technique
summary: "For mixed-media sports or brand spots: footage stickers with paper borders slap onto a plate in stop-motion steps."
categories: [sports-hype-edit]
tools: [add_clip_to_timeline_tool, set_clip_properties_tool, set_keyframes_tool, color_grade_clip_tool, add_sfx_tool]
pace: fast
mood: [playful, handmade, celebratory]
aspect: ["9:16", "16:9"]
pairs_with: [commentary-hits-with-dense-designed-cues, whip-and-match-cut-chain]
avoid_with: [crt-scanline-and-schematic-inserts, withheld-music-cold-drop]
needs: [planar-surface-track-overlay]
---

# Tactile plate animation

## What it is
Pre-animated stickers, knit pixels, pins or paper cut-outs appear on real
walls, drums and buildings, animated at 12 fps, cut to the commentary; the BBC
World Cup spot ends with a paper mural dropping down a tower. The physical
craft is not reproducible; a paper-sticker version on a locked plate is.

## Build it in Zenvi
Per sticker, three layers that land together (shadow, paper border, footage):
```json
add_clip_to_timeline_tool {"file_id": "<black plate>", "position_seconds": <t>, "track": <n>}
add_clip_to_timeline_tool {"file_id": "<paper plate #f4efe4>", "position_seconds": <t>, "track": <n + 1>}
add_clip_to_timeline_tool {"file_id": "<footage>", "position_seconds": <t>, "start_seconds": 1, "track": <n + 2>}
set_clip_properties_tool {"timeline_clip_ids": ["<paper>"], "properties": {"scale_x": 0.56, "scale_y": 0.56,
  "location_x": <x>, "location_y": <y>, "rotation": <-8..8>, "corner_radius": 0.03}}
set_clip_properties_tool {... footage at scale 0.5, same location and rotation; shadow at 0.56, offset +0.03 / +0.025, alpha 0.45}
set_keyframes_tool {"timeline_clip_id": "<each layer>", "property": "scale_x", "interpolation": "constant",
  "points": [{"timeline_seconds": <t>, "value": <1.35 s>}, {"timeline_seconds": <t + 0.083>, "value": <1.1 s>},
             {"timeline_seconds": <t + 0.166>, "value": <s>}]}
add_sfx_tool {"recipe": "paper", "at_seconds": <t>, "gain_db": -8}
add_sfx_tool {"recipe": "impact_thud", "at_seconds": <t + 0.02>, "gain_db": -14}
```
- Solid plates are generated (ffmpeg `color=` sources), not stock.
- `interpolation: "constant"` with keys 0.083 s apart (12 fps) gives the
  stepped stop-motion landing; eased keys read digital.
- Locking a sticker to a moving wall in perspective is the missing
  `planar-surface-track-overlay`; use a locked-off plate.

## Timing & taste rules
- One sticker per beat or per commentary phrase; 3-5 per scene, 2.5-9.5 s per
  scene.
- Rotate each -8° to +8°, never two the same; leave the plate's subject clear.
- After landing, a 12 fps 1-2° wiggle keeps them alive (judge: "static after
  they pop").
- The plate should move or carry action; a person walking away drains it.

## Sound for it
Paper slap + a soft thud per sticker, varied seeds; a punch when the scene
resolves. Under commentary, keep them 6 dB under the voice.

## Common mistakes
- Flat cards with no border or shadow (pass 1, judge 3.36: "flat digital
  cutouts").
- Eased scale-ins (reads as UI, not paper).

## Verified
2026-10-29: 5.5-6 s 9:16 tests on a street plate. Pass 1 (rounded footage
cards only): 3.36. Pass 2 (paper border + offset shadow per sticker, 12 fps
constant keys, paper slaps at -8): 4.73; next: a 12 fps wiggle after landing
and a slam to finish. Fidelity approximates (no surface tracking).
