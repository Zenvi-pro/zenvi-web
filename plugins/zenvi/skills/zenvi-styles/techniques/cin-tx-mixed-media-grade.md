---
id: cin-tx-mixed-media-grade
kind: technique
summary: "When photos, renders, maps and diagrams share a film: grade them to one dark value range, colour only on the hero."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [color_grade_clip_tool, add_motion_block_tool, add_3d_scene_tool, analyze_frame_colors_tool, unify_grade_tool]
pace: medium
mood: [unified, dark, graphic]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-mono-one-accent, cin-tx-low-luma-photo-plate, cin-tx-global-grain]
avoid_with: [cin-cl-duotone-until-featured]
needs: []
drawn: cinetic
---

# One grade across mixed media

cinetic `tx-mixed-media-grade` · Texture and finish · workhorse · energy medium · formats launch, feature, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Desaturated photography, matte grey 3D, flat vector maps and line diagrams cut freely against each other without clashing, because every medium shares one dark value range and only the hero prop carries the accent.

Use when: Films that must combine photos, renders, maps, diagrams and UI, especially grid or bento layouts with several media on screen at once.

## Build it in Zenvi

1. Photos: `color_grade_clip_tool {"timeline_clip_ids": ["<photo_1>", "<photo_2>"], "look": "black_and_white", "exposure": -0.6, "contrast": 0.05}`.
2. Maps and diagrams as motion blocks in the same neutral palette: `add_motion_block_tool {"block": "geo_map", "position_seconds": 6.0, "duration_seconds": 5, "params": {"projection": "flat", "focus": "Europe", "highlight": ["Germany"], "palette": "mono", "accent": "<accent>"}}`.
3. 3D or clay renders: `add_3d_scene_tool {"scene": "glass_hero", "position_seconds": 11.0, "duration_seconds": 4}`, then grade the rendered clip with `color_grade_clip_tool {"timeline_clip_id": "<render>", "saturation": -1, "exposure": -0.4}`; the accent lives on the hero prop only.
4. Measure that every medium lands within 8-25 % mean luma with `analyze_frame_colors_tool {"timeline_clip_id": "<clip>", "time": 1.0}`; if one is off, nudge `exposure`. Optionally `unify_grade_tool {"track": "1", "strength": 0.8}` to pull the remaining clips to a common target.
5. Hard-cut or swap media inside a shot or grid cell on beats, every 48-90 f (0.8-1.5 s): no transition needed, the value range matches.

## Timing & taste rules

- cinetic's timing (60 fps): Swap media inside a shot or cell every 48-90 f (1.50 s), on beats; hard cuts between media need no transition because the value range already matches.
- Every medium's mean luma 8-25 %; nothing except the accent exceeds OKLCH chroma 0.03.
- Photos at about 65 % brightness and slightly lifted contrast (1.05) after greying; renders matte grey (base about 40 % grey); map land only 3-4 % lighter than the ink; line diagrams white at 60-80 % with the accent on the one active path.
- Swap media every 48-90 f (0.8-1.5 s), on beats.
- The accent keeps one meaning in every medium.

## Sound for it

None for the grade; swapping media on beats gets the beat's own hit.

## Common mistakes

- Light, pastel or colourful brands, and single-medium films.
- Hero product photography that must keep its true colour.
- Letting one medium (a colourful render) skip the grade.
- Avoid when: Light, pastel or colourful brands; single-medium films; hero product photography that must keep its true colour.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tx-mixed-media-grade`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
