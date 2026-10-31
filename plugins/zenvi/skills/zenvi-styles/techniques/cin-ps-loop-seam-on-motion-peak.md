---
id: cin-ps-loop-seam-on-motion-peak
kind: technique
summary: "When a clip must loop with no visible restart: wrap on the fastest frame of a whip or push, over whole bars."
categories: [cinetic-feature-loop]
tools: [detect_beats_tool, trim_clip_tool, set_keyframes_tool, apply_fx_tool, inspect_timeline_tool]
pace: medium
mood: [seamless, looping, smooth]
aspect: ["9:16", "1:1", "16:9"]
pairs_with: [cinematic-whip-cut, whip-transition-motion-blur-smear, kcut-hit-fx]
avoid_with: [shot-trailer-bumper-hook, t061]
needs: []
drawn: cinetic
---

# Loop seam hidden at a motion peak

cinetic `ps-loop-seam-on-motion-peak` · Pacing and structure · workhorse · energy medium · formats loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A loop wraps around on the fastest frame of a whip or push, so the last frame flows into the first with no visible restart.

Use when: Autoplay loops for social, landing pages and product pages.

## Build it in Zenvi

1. Set the length to a whole number of bars: at 120 BPM, 4 bars = 480 f = 8 s (also 240 f, 4 s, or 960 f, 16 s): `detect_beats_tool {"file_id": "<music>"}`, then trim the music to that length with `trim_clip_tool {"clip_id": "<music>", "start_seconds": 0, "end_seconds": 8.0}` so the bed loops on the same bar line.
2. Frame 0 is the second half of a move, already travelling at full speed: `set_keyframes_tool {"timeline_clip_id": "<shot>", "property": "location_x", "mode": "replace", "points": [{"seconds": 0, "value": 0.12}, {"seconds": 0.67, "value": 0, "ease": "ease_out_expo"}]}` (entry ease_out_expo over 30-50 f, 0.5-0.83 s).
3. The last 12-24 f (0.2-0.4 s) are the first half of the same move, an ease_in_cubic ramp to the same speed and direction: `{"seconds": 7.6, "value": 0}, {"seconds": 8.0, "value": -0.12, "ease": "ease_in_cubic"}` so the seam sits at 20-40 px/f.
4. Blur the seam frames: `apply_fx_tool {"clip_id": "<shot>", "effects": [{"effect": "directional_blur", "amount": 0.7, "start": 0, "end": 0.3}, {"effect": "directional_blur", "amount": 0.7, "start": 7.7, "end": 8.0}]}`.
5. Verify: `inspect_timeline_tool {"startFrame": 478, "endFrame": 479}` and frames 0 and 1; per-frame position deltas should match within 10 %, and every discrete state at the end should equal frame 0.

Fallback: Zenvi has no frame-modulo wrap of the motion-blur sample times, so bake the blur on both ends by hand.

## Timing & taste rules

- cinetic's timing (60 fps): L = whole bars (240, 480 or 960 f (16.00 s)); seam move at 20-40 px/f with true motion blur; entry ease_out_expo 30-50 f (0.83 s), exit ease_in_cubic 12-24 f (0.40 s); seam on the downbeat.
- L = whole bars: 240, 480 or 960 f (4, 8 or 16 s at 60 fps).
- Seam move at 20-40 px/f with blur; entry ease_out_expo 30-50 f (0.5-0.83 s), exit ease_in_cubic 12-24 f (0.2-0.4 s); seam on the downbeat.
- Per-frame position deltas across the seam within 10 %; every discrete state at frame L equals frame 0.
- Loop the music bed on the same bar line.

## Sound for it

Music loops on its bar line; add no one-shot hit at the seam, so the loop does not announce itself.

## Common mistakes

- Pieces that end on a lockup: it appears once, at the end.
- Loops whose first frame must work as a readable poster: it opens mid-move.
- A music bed that is not a whole number of bars: the click gives the seam away.
- Avoid when: Pieces that end on a lockup (it appears once, at the end), and loops whose first frame must work as a readable poster.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ps-loop-seam-on-motion-peak`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
