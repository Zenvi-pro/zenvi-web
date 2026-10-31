---
id: occluder-plate-wipe
kind: technique
summary: "For a trailer-style scene change: shards or a blob fill the lens in about 6 frames; the cut hides at full cover."
categories: [gaming-montage, kids-education, map-data-explainer]
tools: [add_motion_block_tool, add_clip_to_timeline_tool, add_shape_mask_tool, set_keyframes_tool, apply_motion_transition_tool, add_sfx_tool]
pace: fast
mood: [epic, playful, energetic]
aspect: ["9:16", "16:9", "1:1"]
pairs_with: [scale-jump-cut-on-sub-bass-hit, tiled-video-wall, big-number-lockup-and-counter]
avoid_with: [foreground-occluder-cut-in-footage, monochrome-to-colour-hit-flash]
needs: [occluder-plate-wipe, object-occlusion-wipe-3d]
---

# Occluder plate wipe

## What it is
Something flies at the lens (petals, flames, shards, a flag, a mascot's hand)
and fills it within about 6 frames; the cut hides at full cover and the next
scene is revealed as the plate clears. Game trailers use it once or twice to
jump worlds; kids' shows use a blob.

## Build it in Zenvi
Burst plate plus a fast-scaling colour blob that guarantees full cover:
```json
add_motion_block_tool {"block": "particle_burst", "position_seconds": <cut - 0.3>, "duration_seconds": 0.9,
  "params": {"shape": "shards", "count": 400, "colors": ["<accent>", "#ffffff"], "gravity": 0, "exit": false},
  "motion_blur": 6}
add_clip_to_timeline_tool {"file_id": "<solid accent plate>", "position_seconds": <cut - 0.14>, "start_seconds": 0,
  "end_seconds": 0.3, "track": 4}
add_shape_mask_tool {"clip_ids": ["<plate>"], "shape": "ellipse", "width": 0.3, "height": 0.17, "feather": 0.05}
set_keyframes_tool {"timeline_clip_id": "<plate>", "property": "scale_x", "ease": "ease_in_expo",
  "points": [{"timeline_seconds": <cut - 0.14>, "value": 0.1}, {"timeline_seconds": <cut>, "value": 7},
             {"timeline_seconds": <cut + 0.16>, "value": 10}]}
set_keyframes_tool {... the same on "scale_y"; "alpha" 1 -> 0 over cut + 0.02 .. cut + 0.16}
add_sfx_tool {"recipe": "whoosh_short", "at_seconds": <cut>, "gain_db": -6}
add_sfx_tool {"recipe": "impact_punch", "at_seconds": <cut>, "gain_db": -6}
```
- The ellipse is drawn in the clip's frame; width 0.3 x height 0.17 is a
  circle on 9:16.
- A real element plate (fire, petals, a flag) with screen blend, timed so its
  fullest frame is the cut, is the missing tool `occluder-plate-wipe`; a 3D
  object that dives at the camera is `object-occlusion-wipe-3d`.
- Quick fallback: `apply_motion_transition_tool {"preset": "zoom_through"}`
  plus the burst block over the cut.

## Timing & taste rules
- 4-8 frames from first sight to full cover; ease in (accelerating at the lens).
- Once or twice per 30 s, at world changes; never on consecutive cuts.
- The colour is the piece's accent; a flat disc alone reads as a placeholder
  (judge, pass 1), so always layer a textured element (shards, burst) on it.

## Sound for it
A short whoosh peaking on the cut, layered with a punch or thud at the same
sample; gains around -6 dB with the bed at -18 or the judge hears nothing.

## Common mistakes
- A plate that never fully covers: the cut shows.
- A slow fill (over 10 frames) that reads as a dissolve.
- No sound, or a whoosh buried under the bed.

## Verified
2026-10-29: 5.2 s 9:16 test, gamer to arcade. Pass 1 (flat red disc, quiet
cues): judge 3.36, "a raw unblended placeholder", "no SFX heard". Pass 2
(shard burst with motion blur under the disc, ease_in_expo, cues at -6 dB):
3.82; the judge asks for blending and a flash frame. Fidelity approximates.
