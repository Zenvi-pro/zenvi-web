---
id: slow-pan-over-stills-or-documents
kind: technique
summary: "When proof or history is a photo or document: hold each still 1.2-1.6 s with a 5% push or micro-pan, never frozen."
categories: [food-recipe, news-short-vertical-explainer]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, apply_look_tool, add_vignette_tool, add_sfx_tool]
pace: calm
mood: [nostalgic, warm, documentary]
aspect: ["9:16", "16:9", "4:5", "1:1"]
pairs_with: [soft-bloom-lifted-shadow-grade, voice-over-bed-mix-balance, hard-cut-chapter-title-cards]
avoid_with: [accelerating-cut-length-ramp]
needs: []
---

# Slow pan over stills or documents

## What it is
Archive photos or a document never sit still: each drifts about 5 % (push or
pan) for 1.2-1.6 s, alternating direction, under a film grain; or a printed
page scrolls top to bottom over about 6 s to land on one number.

## Build it in Zenvi
Per still (images need `duration_seconds` on `add_clip_to_timeline_tool`):
```json
add_clip_to_timeline_tool {"file_id": "<still>", "position_seconds": <t>, "duration_seconds": 1.5}
set_keyframes_tool {"timeline_clip_id": "<c>", "property": "scale_x", "interpolation": "linear",
  "points": [{"seconds": 0, "value": 1.0}, {"seconds": 1.5, "value": 1.05}]}
set_keyframes_tool ... "scale_y" (same points)
set_keyframes_tool ... "location_x" [{"seconds": 0, "value": 0.01}, {"seconds": 1.5, "value": -0.01}]
apply_look_tool {"timeline_clip_id": "<c>", "look_id": "vintage_400_film", "stack_grain": true, "grain_preset": "35mm_fine"}
```
Alternate 1.0→1.05 and 1.05→1.0 and the pan direction on each still.
A batch of stills: `add_clips_to_timeline_tool {"file_ids": [...], "image_seconds": 1.5,
"zoom": "random"}` is the one-call version (125 % zooms: too much for archive;
prefer the explicit 5 %).

Document scroll: one tall image, `location_y` keyframed from +0.4 to -0.4
over 6 s with `ease_in_out`, then a 1 s hold and a 1.1x push on the number.

## Timing & taste rules
- 1.2-1.6 s per still; constant speed (`linear`), no easing inside a still.
- 3-6 % travel; more reads as Ken Burns slideshow.
- Sharp stills only: a soft frame pushed in looks broken (the test's first
  still was a motion-blurred frame grab; the judge called it out at 0 s).

## Sound for it
A paper rustle or soft page sound at -24 dB per new still, bed under; no
whooshes.

## Common mistakes
- Frozen stills.
- The same push direction on every still (reads automatic).
- Mixing stills of different colour casts without a shared look.

## Verified
2026-10-28: 6 s test, four stills (frame grabs of stock food footage),
alternating 1.0/1.05 push and ±1 % pan, vintage 400 + 35 mm grain, paper
cues. Contact sheet: steady drift, grain over all. Watch judge motion 3, overall
3.18; fixes: the blurred first still and the shots' clashing colour (use one
look over all stills).
