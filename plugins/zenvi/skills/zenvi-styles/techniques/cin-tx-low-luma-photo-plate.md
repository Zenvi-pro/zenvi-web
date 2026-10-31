---
id: cin-tx-low-luma-photo-plate
kind: technique
summary: "When a dark film needs real-world context behind sparse type or a panel: a photo graded almost to black, or defocused."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, color_grade_clip_tool, analyze_frame_colors_tool, apply_look_preset_tool, add_kinetic_title_tool]
pace: calm
mood: [moody, contextual, crafted]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-tx-global-grain, cin-tx-mixed-media-grade, slow-pan-over-stills-or-documents]
avoid_with: [cin-cl-living-stage]
needs: []
drawn: cinetic
---

# Low-luma photo plate

cinetic `tx-low-luma-photo-plate` · Texture and finish · workhorse · energy calm · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A real photograph sits behind the UI or type, graded almost to black or thrown out of focus, adding context and tonal texture without stealing contrast from the copy.

Use when: Dark-stage films that need real-world context (a desk, a city, a workspace) or a material, crafted feel behind sparse type or a floating panel.

## Build it in Zenvi

1. Plate on track 1, overscanned 6 %: `add_clip_to_timeline_tool {"file_id": "<photo>", "position_seconds": 0, "track": "1", "duration_seconds": 5}` then `set_keyframes_tool {"timeline_clip_id": "<plate>", "property": "scale_x", "points": [{"seconds": 0, "value": 1.06}]}` (and `scale_y`).
2. Texture plate behind statements: `color_grade_clip_tool {"timeline_clip_id": "<plate>", "look": "black_and_white", "exposure": -1.8, "contrast": 0.15}` until its mean luma is 5-8 % (check with `analyze_frame_colors_tool`).
3. Defocused context plate behind a moving panel: `apply_look_preset_tool {"timeline_clip_id": "<plate>", "look": "blur_heavy"}` plus `color_grade_clip_tool {"timeline_clip_id": "<plate>", "exposure": -0.7, "saturation": -0.6}`; a static blur, never animated.
4. Parallax at 0.3x the panel's move: if the panel travels 0.2 of the frame, move the plate 0.06 with `set_keyframes_tool {"property": "location_x", ...}` over the same span, or drift it 0.5-1.5 px per frame.
5. Statement on top: `add_kinetic_title_tool {"text": "Built for the way you work", "style": "documentary", "animation": "fade", "position_seconds": 1.0, "duration_seconds": 3.5}`.

## Timing & taste rules

- cinetic's timing (60 fps): A plate holds its shot (90-420 f (7.00 s)) with 0.3x parallax or a 0.5-1.5 px/f drift; montage cuts under a locked foreground every 15-30 f (0.50 s) on beats; never a fade on the plate.
- Texture plate mean luma 5-8 %; defocused plate blurred about 40 px with brightness 0.6 and saturation 0.4.
- A plate holds its shot for 90-420 f (1.5-7 s) with 0.3x parallax or a 0.5-1.5 px per frame drift.
- Montage cuts under a locked foreground every 15-30 f (0.25-0.5 s) on beats; never a fade on the plate.
- Keep hues neutral or cool; run grain over it so the dark ramps do not band.

## Sound for it

None for the plate; it is silent texture.

## Common mistakes

- Light stages, or a busy photo that stays above about 12 % mean luma and fights the type.
- Stock imagery unrelated to the product's world.
- Decorative bokeh that names no job.
- Avoid when: Light stages; a busy photo that stays above ~12% mean luma and fights the type; stock imagery unrelated to the product's world; decorative bokeh that names no job.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tx-low-luma-photo-plate`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
