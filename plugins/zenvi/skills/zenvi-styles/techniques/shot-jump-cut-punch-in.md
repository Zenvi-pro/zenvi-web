---
id: shot-jump-cut-punch-in
kind: technique
summary: "When one thing must be looked at harder: three jump cuts step the same frame in 1.0x, 1.6x, 2.6x on the target."
categories: [documentary-true-story, tech-review, saas-app-launch, video-essay-explainer, flash-cut-match-cut-edit]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [insistent, deadpan, documentary]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cinematic-silence-before-hit, shot-panel-grid-beats, kinetic-counter]
avoid_with: [cinematic-speed-ramp, shot-freeze-annotate, shot-on-threes-to-ones]
needs: []
---

# Jump-cut punch-in

## What it is
The same composition jumps three times with no tween: 1.0x, then 1.6x, then 2.6x, all pinned on the target. It is a space
cut, not a push-in: "look here, closer, that's it". For a metric, a detail on a screen, a name on a document.

## Build it in Zenvi
1. Cut the take into three consecutive clips on one track (the footage keeps playing across the jumps), e.g.
   `add_clip_to_timeline_tool {"file_id": "<F>", "start_seconds": 2.0, "duration_seconds": 1.2, "position_seconds": 0, "track": "1"}`,
   then 3.2 s to 4.4 s at position 1.2, then 4.4 s to 6.0 s at 2.4.
2. Pin the zoom on the target: on every clip `set_keyframes_tool {"timeline_clip_id": "<C>", "property": "origin_x",
   "points": [{"seconds": 0, "value": 0.62}]}` and `origin_y` (target centre, 0-1 of the frame; same values on all three
   clips), then the step: `property: "scale_x"` and `"scale_y"`, `points: [{"seconds": 0, "value": 1.6}]` on clip 2 and
   `2.6` on clip 3 (clip 1 stays 1.0). One point only, so there is no tween. If origin is refused, offset with
   `location_x` / `location_y` instead (shift = (0.5 - target) x zoom).
3. A tick on each jump: `add_sfx_tool {"recipe": "hit_transient", "at_seconds": 1.2, "gain_db": -14, "seed": 1}`, again at 2.4 s.
   (The 2-frame brightness 0.92 pulse of the card: `add_effect_tool` Brightness with keyframes, optional.)

## Timing & taste rules
- Steps 1.0, 1.6, 2.6: at least 1.5x between steps (a smaller step reads as a camera wobble).
- Each level holds at least 35 f (1.2 s); the last level holds 45 f (1.5 s) completely still.
- Same origin on all three; re-framing each level makes them three different shots.
- A single time-manipulator per shot: no speed ramp or freeze in the same take.
- Zero tween and no fade; a jump cut with a blend is a dissolve.

## Sound for it
One dry tick per jump (`hit_transient` -14 dB, or `ui_tap`), nothing under it. A last riser would be a different move.

## Common mistakes
- Easing the scale (it becomes a slow push-in).
- Origin drift between levels.
- Source below 2.6x resolution: the last level goes soft; shoot or export 4K for it.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/rhythm/rhythm-interrupt-moves.md` (Apache-2.0; see ../NOTICE).
