---
id: motion-pose-or-position-match-cut
kind: technique
summary: "When two shots share a pose, path or position: align the subject across the cut and cut on the motion peak."
categories: [fitness-lifestyle, flash-cut-match-cut-edit, travel-cinematic-montage, video-essay-explainer]
tools: [align_match_cut_tool, match_cut_montage_tool, detect_subject_tool, preview_frame, swap_shot_tool, unify_grade_tool, trim_clip_tool]
pace: medium
mood: [crafted, satisfying, flowing]
aspect: ["9:16", "16:9", "1:1", "4:5"]
pairs_with: [whip-transition-motion-blur-smear, cut-on-action, accelerating-cut-length-ramp]
avoid_with: [split-screen-compare-layout]
needs: [body-pose-anchor-detect, visual-match-cut-sequencer, walking-person-center-align]
---

# Motion, pose or position match cut

## What it is
The subject keeps its place on screen across a cut to a different person,
place or scale: a runner centred and striding in both, a ball's path
continuing, a tray becoming a plan. One per piece in lifestyle edits; a chain
of them is a match-cut montage.

## Build it in Zenvi
1. Pick pairs that already share direction and pose (both running away from
   camera, both mid-stride on the same leg). Selection is most of it.
2. Boxes: round subjects: `detect_subject_tool {"clip_id"}` (circles only).
   People: read the box off `preview_frame {"grid": true}` at the cut frames
   (top-left x, y, w, h as 0-1 of the frame); `body-pose-anchor-detect` is missing.
3. ```json
   align_match_cut_tool {"clips": [
     {"clip_id": "<out>", "box": {"x": 0.25, "y": 0.12, "w": 0.47, "h": 0.73}},
     {"clip_id": "<in>",  "box": {"x": 0.055, "y": 0.37, "w": 0.335, "h": 0.63}}],
     "fit": "position_scale", "cover": "zoom"}
   ```
4. `trim_clip_tool` so the cut sits on the same stride phase (foot strike to
   foot strike); `unify_grade_tool` the pair so the eye sees the shape, not a
   colour jump.
5. Chains of 4+: `match_cut_montage_tool` (it sequences and aligns in one call).

## Timing & taste rules
- Cut on the motion peak, 12-16 frames per shot in chains, 1-2 s in lifestyle.
- Subject centre within 3 % and size within 10 % across the cut.
- Avoid scaling a small subject up over 2x (soft); pick a closer take.

## Sound for it
A soft whoosh -20 dB or nothing: the match is visual; music carries.

## Common mistakes
- Using `detect_subject_tool` on people (it found circles in the test and
  aligned the wrong thing).
- Different stride phase: the hips jump (the judge's top note).
- Overexposed vs moody grade across the cut.

## Verified
2026-10-28: 2.8 s test, two runners from behind (stock), boxes from a
preview grid, `align_match_cut_tool` position_scale + zoom, unify grade. First
run used `detect_subject_tool` and aligned on circles. Watch judge transitions 5,
overall 3.55-3.82; fixes: match the stride phase, match the exposure.
