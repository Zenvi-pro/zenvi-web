---
id: shot-freeze-annotate
kind: technique
summary: "When a point in moving footage must be studied: it freezes on a camera cue, gets circled and labelled, then thaws."
categories: [video-essay-explainer, tech-review, documentary-true-story, saas-app-launch, science-curiosity]
tools: [speed_ramp_tool, add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [explanatory, deliberate, review]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cinematic-speed-ramp, kinetic-lower-third, t086]
avoid_with: [shot-jump-cut-punch-in, shot-on-threes-to-ones]
needs: [path-write-on]
---

# Freeze and annotate

## What it is
A steady flow of cards, rows or action stops dead, a marker ring is drawn round the one that matters with a short note,
then the flow resumes. "Stop and underline." The speed change is the technique; the ring makes it a lesson.

## Build it in Zenvi
1. Flow, freeze and thaw as one speed curve on the clip:
   `speed_ramp_tool {"clip_id": "<C>", "preset": "custom", "ease": "snap", "audio": "mute", "points": [
   {"at_seconds_in_clip": 0, "speed": 1}, {"at_seconds_in_clip": 1.4, "speed": 1}, {"at_seconds_in_clip": 1.45, "speed": 0.02},
   {"at_seconds_in_clip": 3.0, "speed": 0.02}, {"at_seconds_in_clip": 3.7, "speed": 1.6}, {"at_seconds_in_clip": 4.5, "speed": 1}]}`
   The freeze is instant (no ease-in); the thaw is smooth and runs a little over 1x to win back the time it cost.
   (`hero` / `velocity` presets are the other speed shapes; they ease into the hold.)
2. The annotation over the frozen window, transparent:
   `add_motion_block_tool {"block": "hud_callouts", "params": {"title": "PAUSED", "labels": ["This one"], "values": ["why it matters"],
   "points": [{"x": 0.58, "y": 0.45}], "grid": "crosshair"}, "position_seconds": 1.45, "duration_seconds": 1.8, "placement": "over_video"}`
   (frame ticks and a ring pop on the point, a leader draws to a mono label; this is the stand-in for the card's
   hand-drawn ring, arrow and note: a hand-drawn stroke needs `path-write-on`).
3. Pause cue on the freeze frame: `add_sfx_tool {"recipe": "camera_shutter", "at_seconds": 1.45, "gain_db": -12}`
   and a marker sound on the ring: `{"recipe": "swish_airy", "at_seconds": 1.7, "gain_db": -22}`.

## Timing & taste rules
- Freeze at least 45 f (1.5 s); shorter and nobody studies it.
- Pause signal in the same frame: shutter flash 3 f, corner ticks, a timecode that reads PAUSED. Without a signal the viewer
  cannot tell a freeze from a stall.
- The ring takes 10 f to draw, arrow 6 f, a hint of hand jitter; slower reads as a loading wheel, no jitter looks mechanical.
- Target card centred, lifted 3-5 %, the others dimmed and desaturated; the thing circled must be the sharpest.
- At most 2 per 30 s film.
- Pin sound to the output timeline (after the speed change), not to source time.

## Sound for it
Shutter or `ui_tap` on the freeze, a marker-pen scratch (`paper` at -24 dB) on the ring, a short `whoosh_short` at the thaw.

## Common mistakes
- Clip audio left on: at 0.02x it is mush (`audio: "mute"`).
- Freeze too short; thaw not compensated, leaving a cold gap.
- Stacking with a speed ramp or a jump-cut punch-in in the same shot.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/rhythm/speed-ramp-freeze.md` (Apache-2.0; see ../NOTICE).
