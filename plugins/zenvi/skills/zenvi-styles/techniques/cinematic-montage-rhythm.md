---
id: cinematic-montage-rhythm
kind: technique
summary: When a montage must build - shots shrink on the music grid (bars, halves, quarters), then one long shot releases.
categories: [travel-cinematic-montage, movie-game-trailer, sports-hype-edit, wedding-event-film, automotive-ad, brand-story-corporate]
tools: [detect_beats_tool, add_clip_to_timeline_tool, build_reel_tool, unify_grade_tool]
pace: fast
mood: [building, euphoric, epic]
aspect: ["16:9", "9:16", "2.39:1"]
pairs_with: [cinematic-push-in, cinematic-silence-before-hit, cinematic-trailer-sound, cinematic-light-leak, cinematic-aspect-ratio-reveal]
avoid_with: [cinematic-j-l-cut]
needs: [shot-length-ramp]
---

# Montage rhythm (shot-length ramp + release)

## What it is

The cut rate accelerates across a section - 2 bars per shot, then 1, then half, then a beat -
and ends on one long held shot (the release). It is the backbone of trailers and travel
films; the dossiers measure it: best pieces have a 2-3x ratio between slowest and fastest
third and a last shot at least 3x the median.

Related shot cards: `shot-trailer-grammar-moves`, `shot-beat-cut-moves`, `shot-sakuga-timing-shift`.

## Build it in Zenvi

1. `detect_beats_tool` `{"fileId": "<music>"}` -> `beats` and `downbeats` (seconds). Check
   `tempo.alternatives`; halve/double with `bpm` if the grid is wrong.
2. Plan the lengths on the grid, e.g. at 132 BPM (bar 1.81 s): 4 shots x 2 bars, 1 x 1 bar,
   4 x half bar, 8 x quarter bar, then the release shot for 3-4 bars.
3. Place each shot with `add_clip_to_timeline_tool` `{"file_id", "position_seconds": <downbeat>,
   "start_seconds", "end_seconds"}` - the source window where the subject moves.
4. One grade over all of it: `unify_grade_tool` `{"strength": 1.0, "look": "<lut>", "look_intensity": 0.4}`
   (fast cuts expose every mismatch).
5. Quick first cut instead: `build_reel_tool` `{"style": "cinematic", "music_file_id": "<music_file_id>", "duration_seconds": "<duration_seconds>"}`,
   then retime the shots to the plan. A tool that writes the ramp in one call is the missing
   `shot-length-ramp` (GAPS #18).

## Timing & taste rules

- Never below 0.3 s (7 frames at 24 fps) for footage; the eye stops reading content at 4-5 frames.
- Ramp over 8-16 bars; a ramp in 2 bars is a burst, not a build.
- Cuts on downbeats while shots are long, on beats once they are short; put the release on the
  section change (drop, chorus) or the climax.
- The release shot is the best shot, moving slowly (push-in, drift), 4-7 s.
- Keep a repeating device (subject position, direction of motion) through the fast part.
- Equal lengths read as a beat, so a burst inside the ramp uses identical shot lengths (e.g. three 9-frame shots), each with a different composition (video-shotcraft, Apache-2.0, `shot-trailer-grammar-moves`).

## Sound for it

The music does the work; a riser over the last 2 bars before the release, ending on it, and a
soft hit (`impact_thud` -16 dB) on the release frame. No whoosh on every short cut.

## Common mistakes

- Shot length set by clip length (random rhythm).
- Mismatched grades at high cut rates (the judge's first complaint).
- Ending on a short shot: the build never resolves.

## Verified

2026-10-28, `tech/montage-rhythm` (9 landscape shots 2.0 -> 0.3 s, then a 2.4 s hold, over
music). Watch judge (abs): overall 5.3, transitions 6, sound 6, "the accelerating cut rhythm
successfully builds momentum"; grade 4 because the stock looks did not match at
`strength` 0.6 - the rule is now `strength` 1.0. Used again in the travel showcase.
