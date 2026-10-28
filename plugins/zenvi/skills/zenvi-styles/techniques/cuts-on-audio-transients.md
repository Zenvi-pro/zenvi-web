---
id: cuts-on-audio-transients
kind: technique
summary: "When the work makes its own rhythm (knife, tool, footfall): cut on the in-world sound onsets, not the drum grid."
categories: [fitness-lifestyle, food-recipe, kids-education, movie-game-trailer]
tools: [analyze_timeline_audio_tool, trim_clip_tool, split_clip_tool, move_clips_tool, add_sfx_tool, set_track_role_tool, set_audio_gain_tool]
pace: medium
mood: [tactile, satisfying, crafted]
aspect: ["9:16", "16:9", "1:1", "4:5"]
pairs_with: [cut-on-action, action-per-cut-micro-demo-with-live-foley, voice-over-bed-mix-balance]
avoid_with: [accelerating-cut-length-ramp]
needs: [audio-onset-cut-snap, action-foley-spotter]
---

# Cuts on audio transients

## What it is
Every cut lands on a physical sound of the work: knife strike, plate set
down, foot strike, chainsaw bite. Shots of 1.1-2 s; the foley sits at or above
the music. In the best food and craft pieces over half the cuts land on an
onset and only 20 % on the beat.

## Build it in Zenvi
1. Footage with its own sound: keep camera audio on the clips;
   `analyze_timeline_audio_tool` lists onsets; `trim_clip_tool` /
   `split_clip_tool` so each cut sits on (or 1 frame before) a transient.
   There is no snap-to-onset tool yet (`audio-onset-cut-snap`), so place by
   the listed times.
2. Silent footage (most stock): pick each in-point on the visible strike
   (`preview_frame` or `watch_clip_window_tool`), cut there, and give the
   strike its sound: `add_sfx_tool {"recipe": "hit_transient", "at_seconds": <cut>,
   "gain_db": -12, "seed": <n>}`, or a library knife/thud
   (`search_sound_library_tool`). Seeds varied.
3. `set_track_role_tool` sfx on the foley track and
   `set_audio_gain_tool {"role": "music", "gain_db": -6}` so the hits sit above
   the bed.

## Timing & taste rules
- Shots 1.1-1.6 s in the work block; a 3+ s hold on the reveal.
- The visible impact and its sound within 1 frame; an off-picture sound
  "lands after the click" (the judge heard a 1-2 frame lag in the test).
- Music under, without a strong grid; foley 0 to +3 dB over the bed.

## Sound for it
The sounds are the edit: transient 5-30 ms, body 80-250 ms; one family per
action, varied takes. No whooshes.

## Common mistakes
- Snapping to the music beat (build_reel's default): the hands fall out of sync.
- Library foley that does not match the surface (wood vs glass).
- Mixed cameras ungraded: the judge saw a dark and a blown-out board side by side.

## Verified
2026-10-28: 6.8 s chopping test, five stock shots (no source audio), a
designed hit on each cut, groove bed at -6 dB. Contact sheet: one strike per
shot. Watch judge sound 2, overall 2.82: the pepper cut landed after the click
and the shots were ungraded; with silent stock the visible strike has to be
found by eye, which is why `action-foley-spotter` and `audio-onset-cut-snap`
are listed as needs.
