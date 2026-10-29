---
id: cinematic-silence-before-hit
kind: technique
summary: When the drop or the title must land like a punch - music dies, a beat of black and dead air, then the hit on frame one.
categories: [movie-game-trailer, sports-hype-edit, automotive-ad, gaming-montage, product-launch-film, documentary-true-story]
tools: [automate_volume_tool, add_clip_to_timeline_tool, add_sfx_tool, apply_motion_transition_tool]
pace: fast
mood: [tense, explosive, dramatic]
aspect: ["16:9", "9:16", "2.39:1"]
pairs_with: [cinematic-trailer-sound, cinematic-montage-rhythm, cinematic-speed-ramp, cinematic-title-sequence, cinematic-cold-thriller]
avoid_with: [cinematic-j-l-cut, cinematic-warm-nostalgia]
needs: [music-structure-detect]
---

# Silence before the hit

## What it is

Everything stops - picture to black, music to nothing - for a fraction of a second, and then
the hero shot and the drop hit together. The trailer dossier's first "best vs average" rule:
at least one designed silence or black beat per 60 s. Also the suck-out (a 150 ms near-silence)
before any big hit.

## Build it in Zenvi

Trailer version (black + dead air, 0.4-0.6 s):
1. Leave a gap on the picture track: the last build shot ends at `t`, the hero shot starts at
   `t + 0.4` (`add_clip_to_timeline_tool` `position_seconds`). The gap renders black.
2. Music: two clips of the track - the build ending at `t`, then the drop section starting at
   `t + 0.4` from its own downbeat (`add_clip_to_timeline_tool` `start_seconds` = the drop's
   downbeat from `detect_beats_tool`). Or one clip with `automate_volume_tool` `{"clip_ids": [<music>],
   "shape": "points", "mode": "absolute", "points": [{"t": <t-0.04>, "db": -6}, {"t": <t>, "db": -60},
   {"t": <t+0.38>, "db": -60}, {"t": <t+0.4>, "db": -4}]}`. Pass `clip_ids`; a bare `track` number is
   read as a layer number, not the UI track.
3. A riser that ends exactly at `t` (`add_sfx_tool` `riser_noise`/`riser_tonal`, `at_seconds: t`),
   then `impact_slam` (`intensity` 1) + `sub_drop` at `t + 0.4`.
Suck-out version (no black): `automate_volume_tool` `{"shape": "suck_out", "at_seconds": <hit>}`
(-18 dB for 200 ms before the hit). Finding the drop automatically is `music-structure-detect` (GAPS #9);
today read it off `detect_beats_tool` downbeats + the loudness curve.

## Timing & taste rules

- Black + silence 0.4-0.6 s (10-14 frames at 24 fps); the judge called 0.6 s "slightly long" once, but a 0.42 s
  pass (with other changes) scored lower - stay in the range, never over 0.75 s.
- Suck-out 80-300 ms (150 ms default), at most 1-2 per 30 s.
- The hit lands on frame one of the hero shot and on the drop's downbeat; never one frame late.
- Nothing in the gap: no whoosh tail, no reverb ring (cut the riser at `t`).

## Sound for it

This is a sound move: riser -> dead air -> slam + sub; afterwards the music at full level.

## Common mistakes

- Fading the music out (a fade is not silence; cut it).
- Silence while the picture keeps playing (reads as an audio dropout).
- Using it twice in 20 s.

## Verified

2026-10-28. `tech/silence-before-hit`: version 1 (flash_black 0.2 s, music automated by `track: "3"`)
left only 0.1 s of quiet - the judge asked for "8 to 12 frames of pure black with 100 % audio
silence"; version 2 (0.5 s gap, two music clips, `clip_ids`) measured -70 to -73 dB RMS for 0.35 s of the gap (the slam's 0.1 s pre-roll fills the rest). Trailer
showcase: "an effective silent freeze before the drop" (sound design 8/10, overall 6.6), with the
note that 0.6 s was slightly long. A later pass at 0.42 s (plus two other changes) scored 5.2, so the
range stays 0.4-0.6 s.
