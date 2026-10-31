---
id: accelerating-cut-length-ramp
kind: technique
summary: "When a section should build: shots shorten (about 1.8 s down to 0.3 s), then land on one longer held shot."
categories: [fashion-beauty-ad, flash-cut-match-cut-edit, gaming-montage, movie-game-trailer, real-estate-tour]
tools: [add_clip_to_timeline_tool, add_clips_to_timeline_tool, trim_clip_tool, detect_beats_tool, add_sfx_tool, unify_grade_tool, review_edit_tool]
pace: fast
mood: [building, energetic, editorial]
aspect: ["9:16", "16:9", "1:1", "4:5"]
pairs_with: [blackout-and-dead-silence-pause, hard-cut-chapter-title-cards, motion-pose-or-position-match-cut]
avoid_with: [slow-pan-over-stills-or-documents, cuts-on-audio-transients]
needs: [shot-length-ramp]
---

# Accelerating cut-length ramp

## What it is
A run of shots, each shorter than the last (about 1.8, 1.4, 1.1, 0.8, 0.6,
0.45, 0.35, 0.3 s), that pulls the viewer forward, then settles on a held
2-2.5 s shot. Fashion inserts shorten from 1.1 to 0.7 s then settle on a 2.4 s
medium; trailers go from 4 s to 0.3 s in their last quarter.

## Build it in Zenvi
1. Lengths first, snapped to the music: `detect_beats_tool`; shorten in beat
   multiples (2 beats, 2, 1, 1, ½, ½, ¼ …) so the ramp lands on a downbeat.
2. Place the run: one `add_clip_to_timeline_tool` per shot, butted, or
   `add_clips_to_timeline_tool {"items": [{"file_id", "start_seconds", "end_seconds"}, ...]}`.
   No ramp tool yet (`shot-length-ramp`): the lengths are yours.
3. `unify_grade_tool` across the run (8 sources in 6 s look like stock without it).
4. Sound: `add_sfx_tool` a soft tick or `whoosh_short` at -22 dB on cuts in
   the ramp, an `impact_punch` at -12 on the landing shot; or a riser under
   the whole ramp ending on the hit.
5. `review_edit_tool`: shot lengths decrease monotonically; the hold ≥ 2 s.

## Timing & taste rules
- 6-9 shots; each 70-80 % of the previous; floor 0.25-0.3 s (8-9 frames).
- Shots in the fast end should be simple, graphic, one subject: the eye has
  under 10 frames.
- Keep a common thread (subject, colour or framing) through the run; random
  subjects read as erratic (the judge's note on the test).
- The hold is the payoff: the best look, a product, a face.

## Sound for it
A riser or tick rhythm that accelerates with the cuts; the landing gets the
heaviest hit of the section; or music alone if its build matches.

## Common mistakes
- A flat bed under the ramp: the build is not heard.
- Equal lengths with a "fast" label: measure.
- Ungraded mixed sources.

## Verified
2026-10-28: 7.6 s fashion test, nine stock shots 1.8 → 0.3 s then a 2.4 s
hold, whooshes at -22 and a punch on the hold. Contact sheet: the run
accelerates, hold lands. Watch judge transitions 5, overall 4.09-5.0; fixes:
sound design that builds with the ramp, and one palette across the clips.
