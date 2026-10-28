---
id: cinematic-speed-ramp
kind: technique
summary: When one moment of an action shot is the hero - rush in, near-freeze on the apex (lean, jump, splash), rush out, on the beat.
categories: [sports-hype-edit, automotive-ad, movie-game-trailer, travel-cinematic-montage, fitness-lifestyle, gaming-montage]
tools: [speed_ramp_tool, apply_fx_tool, add_sfx_tool, detect_beats_tool]
pace: fast
mood: [epic, kinetic, heroic]
aspect: ["16:9", "9:16", "2.39:1"]
pairs_with: [cinematic-whip-cut, cinematic-silence-before-hit, cinematic-trailer-sound, cinematic-match-on-action, cinematic-teal-orange]
avoid_with: [cinematic-j-l-cut, cinematic-title-sequence]
needs: []
---

# Speed ramp

## What it is

The clip's speed changes inside the shot: fast into the moment, almost frozen on its apex, fast
out (velocity edit), or a hero slow-motion passage. Shines on bikes leaning, cars passing,
athletes at the top of a jump, water, hair, dancers.

## Build it in Zenvi

1. Find the apex in source seconds on a contact sheet (`zenvi frame` / `watch_clip_tool`).
2. `speed_ramp_tool` `{"clip_id", "preset": "custom", "ease": "smooth", "ripple": true, "points": [
   {"at_seconds_in_clip": 0, "speed": 1.6}, {"at_seconds_in_clip": 0.7, "speed": 1.6},
   {"at_seconds_in_clip": 0.95, "speed": 0.15}, {"at_seconds_in_clip": 1.9, "speed": 0.15},
   {"at_seconds_in_clip": 2.2, "speed": 2.0}, {"at_seconds_in_clip": 2.8, "speed": 2.0}]}` - point times
   are on the timeline clock from the clip's start; the clip ends at the last point.
   Work out where the slow part falls in the source: source used = sum(speed x time); put the slow
   phase on the apex (pass 1 of the test missed it by ~1 s and froze an empty road).
3. Presets when the apex is mid-clip: `{"preset": "velocity", "hit_at": <beat>}` or `"hero"`.
4. Smoother slow motion (real in-between frames): `apply_fx_tool` `optical_flow_slowmo` on the source
   window before the ramp (lengthens the clip).
5. Sound: `add_sfx_tool` `whoosh_rise` peaking at the slow start, `impact_thud` (-12 dB) on it,
   `whoosh_fall` on the exit. `audio: "mute"` (default) - ramped sound is mush.

## Timing & taste rules

- Slow phase 0.6-1.2 s at 0.1-0.25x; ramps 0.2-0.4 s; rush 1.6-2.5x.
- Land the slowest frame on a beat or the drop (`hit_at` = a `detect_beats_tool` time).
- One ramp per 8-10 s; every shot ramped is a template look.
- Sources at 50-60 fps survive 0.25x; 24-30 fps footage stutters below 0.4x without optical flow.

## Sound for it

Whoosh into, low hit on the freeze, whoosh out; or the music's own break (pair with
`cinematic-silence-before-hit`).

## Common mistakes

- Slowing a moment where nothing happens (subject already out of frame).
- Keeping the clip's audio.

## Verified

2026-10-28, `tech/speed-ramp` (motorbike through a corner, 3.2 s 720p24). Pass 1: the freeze landed on
an empty road after the bike had gone. Pass 2 (custom points above, slow phase moved 0.55 s earlier):
watch judge "the concept of a speed ramp freeze on the apex of the motorcycle lean reads clearly"
(overall 4.3); it called the 25 fps source's slow part "stepped" - hence rule 4 and step 4.
