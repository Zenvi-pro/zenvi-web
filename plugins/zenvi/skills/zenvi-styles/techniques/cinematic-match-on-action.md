---
id: cinematic-match-on-action
kind: technique
summary: When a cut must be invisible - cut mid-movement into a closer angle (or a matching shape) so the action carries across.
categories: [movie-game-trailer, sports-hype-edit, automotive-ad, travel-cinematic-montage, flash-cut-match-cut-edit, fitness-lifestyle]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, align_match_cut_tool, match_cut_montage_tool, detect_subject_tool, add_sfx_tool]
pace: medium
mood: [fluid, kinetic, confident]
aspect: ["16:9", "9:16", "2.39:1"]
pairs_with: [cinematic-shot-scale-grammar, cinematic-whip-cut, cinematic-speed-ramp, cinematic-montage-rhythm]
avoid_with: [cinematic-title-sequence]
needs: [motion-peak-cut-snap, visual-match-cut-sequencer]
---

# Match on action (cut on action)

## What it is

The cut lands while something moves - a lean, a turn, a door, a throw - and the next shot
continues that motion from a new angle or size, so the eye follows the action and never sees
the cut. Its graphic cousin is the shape match (round thing -> round thing, same place, same
size). Shines in action, sport, cars, and every story edit.

Related shot cards: `shot-circle-match-iris` (shape match through an iris), `shot-transition-hidden-cut` (foreground occluder wipe).

## Build it in Zenvi

Two angles of one take (stock rarely has both): play the wide, then cut to a digital punch-in
of the moment right after.
1. Wide: `add_clip_to_timeline_tool` `{"file_id", "position_seconds": 0, "start_seconds": 0.6, "end_seconds": 3.0}`.
2. Tight: the same file from the cut frame, `{"position_seconds": 2.4, "start_seconds": 2.92, "end_seconds": 4.0}`
   (2 frames at 24 fps before the wide's out point: the overlap rule below),
   then `set_keyframes_tool` `scale_x`/`scale_y` `[{"seconds": 0, "value": 1.7}]` and `location_x`
   `[{"seconds": 0, "value": -0.05}, {"seconds": 1.0, "value": -0.32}]` so the frame pans with the subject
   (keep |location| <= (scale - 1) / 2 or the edge shows).
3. `add_sfx_tool` `{"recipe": "swish_airy", "at_seconds": 2.4, "gain_db": -16}` - a light swish sells the move.
Shape match between different shots: `detect_subject_tool` for each subject's box, then
`align_match_cut_tool` `{"clips": [{"clip_id", "box"}...], "fit": "position_scale"}`; a whole chain:
`match_cut_montage_tool`. Finding the motion peak automatically is missing (`motion-peak-cut-snap`,
GAPS #32; `visual-match-cut-sequencer`, GAPS #20): pick the frame from a contact sheet.

## Timing & taste rules

- Cut 2-4 frames after the motion starts, not at its end; overlap the action by 1-3 frames
  (the tight shot repeats the last 1-3 frames of the wide) so it feels continuous.
- Change size by at least 1.5x (wide -> tight) or the cut reads as a jump cut.
- The next shot after the tight angle keeps the same screen direction.
- Shape match: the two circles must share a centre within ~10 px at 1080p (0.5 % of the width) or the match is visibly off; pulse the anchor (2 x scale 1.0 -> 1.16) before the cut so the eye is on it (video-shotcraft, Apache-2.0, `shot-circle-match-iris`).
- Occluder cut: the cut frame is the one where the occluder's solid core covers the whole frame; the soft edges cover the frames either side (`shot-transition-hidden-cut`).

## Sound for it

The action's own sound across the cut (engine, footstep) or a swish at -16 dB; no hit.

## Common mistakes

- Cutting on a still frame (that is a plain cut).
- Punch-in so tight the subject leaves the frame within half a second.
- Following it with an unrelated shot that kills the motion (the judge's note below).

## Verified

2026-10-28, `tech/match-on-action` (motorbike corner: wide, cut at the lean to a 1.7x punch-in
panning with the bike; 5.4 s 720p24). Watch judge (abs): "the cut on action from the motorcycle
wide to the tight lean angle matches motion reasonably well"; it marked down the unrelated night
car shot appended after it (overall 3.55), hence the last rule.
