---
id: foreground-occluder-cut-in-footage
kind: technique
summary: "For street or trail tracking shots: cut on the frame a passing car or post covers the lens, open on the next shot."
categories: [sports-hype-edit, travel-cinematic-montage]
tools: [search_clip_scenes_tool, split_clip_tool, trim_clip_tool, watch_clip_window_tool, add_clip_to_timeline_tool, set_keyframes_tool, add_shape_mask_tool, add_sfx_tool]
pace: medium
mood: [kinetic, documentary, street]
aspect: ["16:9", "9:16"]
pairs_with: [withheld-music-cold-drop, whip-and-match-cut-chain, cuts-on-audio-transients]
avoid_with: [occluder-plate-wipe, beat-staggered-tile-and-slice-build]
needs: [occluder-cut-finder]
---

# Foreground occluder cut in footage

## What it is
During a tracking shot a van, pillar or pedestrian crosses the lens and fills
it; the cut hides on that frame and the next shot opens as another occluder
leaves. Skate and travel films use it 2-3 times a minute; it is invisible when
the footage has it, and fake when it is drawn.

## Build it in Zenvi
With footage that has a real pass (the right way):
```json
add_clip_to_timeline_tool {"file_id": "<a>", "position_seconds": <t>}
search_clip_scenes_tool {"query": "car passes close to the camera", "timeline_clip_id": "<a clip>"}
watch_clip_window_tool {"timeline_clip_id": "<a clip>", "query": "a car fills the frame", "start": <pass - 0.5>, "end": <pass + 0.5>}
trim_clip_tool {"clip_id": "<a clip>", "start_seconds": <in>, "end_seconds": <frame of full cover>}
add_clip_to_timeline_tool {"file_id": "<b>", "position_seconds": <t + len>, "start_seconds": <frame the next occluder clears>}
add_sfx_tool {"recipe": "whoosh_medium", "at_seconds": <cut>, "gain_db": -8, "pan": -0.6, "duration": 0.8}
```
Finding the covered frame is manual today (`occluder-cut-finder` would list
frames where a foreground object covers > 60 % of the picture).

Fallback without a real pass: a dark footage plate (a night road, a wall) on
the track above, masked with a soft edge and slid across in 0.4 s in, 0.4 s
out, the cut at full cover:
```json
add_clip_to_timeline_tool {"file_id": "<dark plate>", "position_seconds": <cut - 0.4>, "start_seconds": 3, "end_seconds": 3.8, "track": 3}
add_shape_mask_tool {"clip_ids": ["<plate>"], "shape": "rectangle", "width": 1.25, "height": 1.2, "feather": 0.12}
set_keyframes_tool {"timeline_clip_id": "<plate>", "property": "location_x", "interpolation": "linear",
  "points": [{"timeline_seconds": <cut - 0.4>, "value": 1.3}, {"timeline_seconds": <cut>, "value": 0},
             {"timeline_seconds": <cut + 0.4>, "value": -1.3}]}
```

## Timing & taste rules
- The cover lasts 2-4 frames; cut on the darkest one. The incoming shot should
  move the same way as the occluder.
- 1-3 per minute; only inside the tracked, street-level section.
- The drawn fallback reads as a wipe (judge: "an artificial matte, not a pass").
  Use it only when the story needs the hand-off; prefer a real pass or a hard
  cut on action.

## Sound for it
A pass-by whoosh panned with the occluder, peaking on the cut, plus the
location's air continuing under both shots so the cut does not drop to silence.

## Common mistakes
- A flat black box (reads as a graphic, not a vehicle).
- Cutting before the frame is covered: a sliver of the old shot shows.
- Silence on the second shot (the judge heard the ambience drop out).

## Verified
2026-10-29: 5.2 s 9:16 test, skater to sprinter. Pass 1 (flat dark plate,
directional blur on a solid does nothing): judge 3.82. Pass 2 (night-road
footage plate, feathered edge, louder pass-by whoosh): 3.91; the judge still
reads the drawn plate as a matte. Fidelity approximates; real occluder
footage is the fix (needs `occluder-cut-finder` to find it).
