---
id: vector-switch-chapters
kind: technique
summary: "For long walking montages: keep one cut cadence, but switch the walking axis in chapters of 4-6 cuts."
categories: [travel-cinematic-montage]
tools: [add_clip_to_timeline_tool, set_clip_properties_tool, add_marker_tool, unify_grade_tool, fade_clip_tool, add_sfx_tool, master_audio_tool, search_clip_scenes_tool, get_clips_with_full_metadata_tool, detect_beats_tool]
pace: fast
mood: [wanderlust, rhythmic, energetic]
aspect: ["16:9", "9:16"]
pairs_with: [motion-pose-or-position-match-cut, tighten-then-release-into-held-payoff, bar-phrase-and-lyric-locked-cutting]
avoid_with: [telephoto-scale-jump-with-riser-to-hit, white-flash-or-light-leak-join]
needs: [shot-heading-scale-tagger]
---

# Vector-switch chapters

## What it is

A montage of one traveller (or many travellers framed alike) walking,
cut on a fixed cadence, where the direction of travel is held for a
chapter and then switched: walk-away down streets, then profile walks
across walls, then toward camera, then still portraits. The cadence
keeps the rhythm; the axis change gives the film its chapters without
any title or transition.

## Build it in Zenvi

No tool tags walking direction, so classify shots by eye on a contact
sheet (5 frames per clip) or with `search_clip_scenes_tool` queries
("person walking away from camera", "walking left to right in profile")
and confirm on the frames. Then lay the cuts on the beat grid
(`detect_beats_tool` on the bed; 120 bpm here, cut every 2 beats = 1.0 s).

```json
add_clip_to_timeline_tool {"file_id": "<walk-away 1>", "position_seconds": 0, "start_seconds": 5, "end_seconds": 6, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<walk-away 2>", "position_seconds": 1, "start_seconds": 6, "end_seconds": 7, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<walk-away 3..5>", "position_seconds": 2, "start_seconds": 1.5, "end_seconds": 2.5, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<profile L-R 1>", "position_seconds": 5, "start_seconds": 1.7, "end_seconds": 2.7, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<profile L-R 2..4>", "position_seconds": 6, "start_seconds": 0.5, "end_seconds": 1.5, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<toward camera>", "position_seconds": 9, "start_seconds": 3.5, "end_seconds": 4.5, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<portrait>", "position_seconds": 10, "start_seconds": 3, "end_seconds": 4, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<held figure>", "position_seconds": 11, "start_seconds": 4, "end_seconds": 7, "track": "1"}
set_clip_properties_tool {"scope": "all", "properties": {"scale": "Crop", "volume": 0}}
add_marker_tool {"position_seconds": 5, "name": "axis: profile", "color": "blue"}
add_marker_tool {"position_seconds": 9, "name": "axis: toward / portrait", "color": "blue"}
unify_grade_tool {"look": "warm_cinema", "look_intensity": 0.45}
fade_clip_tool {"clip_id": "<held figure>", "fade_out_seconds": 1.0}
add_clip_to_timeline_tool {"file_id": "<120 bpm bed>", "position_seconds": 0, "start_seconds": 0.836, "end_seconds": 14.836, "track": "5"}
add_sfx_tool {"recipe": "whoosh_short", "at_seconds": 5, "gain_db": -18}
add_sfx_tool {"recipe": "whoosh_short", "at_seconds": 9, "gain_db": -18, "seed": 2}
master_audio_tool {"target_lufs": -14, "true_peak_dbtp": -1.0, "balance": "keep"}
```

The bed's `start_seconds` (0.836 here) puts its first downbeat on 0.
Missing: `shot-heading-scale-tagger` (tag each shot's subject heading,
toward/away/left/right, and shot scale). Fallback: eyeball the contact
sheet and write the tags into clip names before building.

## Timing & taste rules

- Cadence fixed for the whole run: 0.5 s (1 beat at 120) for frantic,
  1.0 s (2 beats) for medium. Do not speed up inside a chapter.
- Chapters of 4-6 cuts in short pieces (5-19 s in long-form).
- Inside a chapter: same heading and same side (all left to right), the
  subject near frame centre, similar scale. Never mirror the direction
  inside the profile chapter, never reuse the same walker twice.
- Each walker clip's 1.0 s must contain the subject in stride; check the
  in-point frame, many clips start empty.
- End on a still figure held 2-3 s: the stop is the payoff.
- One grade over everything (night, daylight and snow footage need a
  shared look and a per-shot exposure match first).

## Sound for it

Music-led bed at -14 LUFS carries the cadence. Mark only the chapter
switches (a soft whoosh 12-18 dB under the bed, or a footstep on the
switch frame); footstep or street foley under each chapter at -28 to -32
LUFS adds presence. No hit on every cut.

## Common mistakes

- Mixing headings inside a chapter, so the switch is not felt.
- Cutting off the beat because the shot "needs more time".
- Empty frames (the walker not yet in shot at the in point).
- Repeating the same person, mirrored, inside one block.

## Verified

2026-10-28. 14 s at 1280x720/24, eleven Pexels walkers cut every 1.0 s
on a 120 bpm bed (Freesound 746585), chapters at 5 s and 9 s, held cliff
figure to the end. Clips were classified from the 5-frame contact sheet;
the first in-point for the alley clip showed no walker and was swapped.
Judge 5.45/10, structure 7, pacing 7: "organizing walking cuts by vector
and cadence is clever and creates a clear rhythmic through-line"; fixes
were the stock's mismatched grades, no foley, and one walker reused
walking the other way in the profile block (now rules). Artifacts:
`~/zenvi-motion/fleet/artifacts/sk4-cinematic-story/techniques/vector-switch-chapters.*`.
