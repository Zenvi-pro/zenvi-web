---
id: shot-on-threes-to-ones
kind: technique
summary: "When a hand-made feel should snap into speed: an element steps every 3 frames like a flipbook, then sprints smoothly."
categories: [kinetic-type-motion-design, saas-app-launch, animated-explainer, music-lyric-video, kids-education]
tools: [add_title_tool, add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [handmade, playful, punchy]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-keyword-slam, kcut-hit-fx, kinetic-emphasis-scale]
avoid_with: [shot-jump-cut-punch-in, shot-freeze-annotate, cinematic-speed-ramp]
needs: []
---

# On threes, then on ones

## What it is
An element crosses the frame at 10 positions a second (one new drawing every 3 frames, with a changing pose), then at one
instant switches to fully smooth motion and sprints. The change of frame rate is the show: a handmade lurch and a
slick burst on one screen. For a card entering, a metric crossing a line.

## Build it in Zenvi
1. The element: a title/graphic clip (e.g. `add_title_tool {"text": "NEW", "template": "Bar_1", "position_seconds": 0, "duration_seconds": 5}`)
   or a kinetic-headline block.
2. Stepped phase (0 to 1.6 s): `set_keyframes_tool {"timeline_clip_id": "<C>", "property": "location_x", "interpolation": "constant",
   "points": [{"seconds": 0, "value": -0.35}, {"seconds": 0.1, "value": -0.29}, {"seconds": 0.2, "value": -0.23}, ...]}`
   one point every 0.1 s (3 f at 30 fps), about 0.06 of the frame per step (>= 30 px at 1080: under that it looks like
   dropped frames). Pose per step, same cadence, constant interpolation: `rotation` alternating +5 / -5 degrees, `scale_x`
   and `scale_y` alternating 0.97 / 1.035 (squash / stretch), `location_y` alternating -0.017 / -0.002 (a hop).
3. The switch at 1.6 s (f48) is one frame, no tween: `mode: "merge"` and set the later points with `interpolation: "bezier"`,
   `ease: "ease_out_quart"`: `location_x` 0.45 to -0.02 at 2.4 s, then 0 at 2.6 s (a 2 % overshoot and a 6-frame settle),
   `scale_x` 0.92 and `scale_y` 1.07 on landing.
4. The impact frame, 2 frames only (0.067 s), as the marker of the change: `add_title_tool {"background_color": "#111111",
   "position_seconds": 1.6, "duration_seconds": 0.067}` on a track above.
5. Label the change ("ON 3s" to "ON 1s", a small second title at 1.6 s) or hit a sound; unlabelled it just looks faster.
   `add_sfx_tool {"recipe": "hit_transient", "at_seconds": 1.6, "gain_db": -12}`.

## Timing & taste rules
- 3 f per step (2 f is too soft, 4 f and up looks like a frozen player). Steps 30 px and more.
- Poses change every step; a pure position stutter looks like a bug.
- Switch at about 60 % of the move (stepped 1.6 s : sprint 1.0 s), on one frame.
- Sprint: very fast start (out-quart), overshoot 2 %, squash on landing; hold at least 2 s afterwards.
- One impact frame per shot, 2 f; never combine with a speed ramp or freeze (one time-manipulator per shot).

## Sound for it
One transient at the switch, plus a short `whoosh_short` on the sprint (-16 dB). Steps themselves stay silent or get a paper `cloth` at -30 dB.

## Common mistakes
- Steps too small to read as stepped.
- A tween between the two phases.
- No marker of the change.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/rhythm/sakuga-timing-shift.md` (Apache-2.0; see ../NOTICE).
