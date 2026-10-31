---
id: bar-phrase-and-lyric-locked-cutting
kind: technique
summary: "For music-led montages: cut on bar lines and phrase starts, halve the cut length into the phrase end, hold the payoff."
categories: [gaming-montage, music-lyric-video, travel-cinematic-montage, wedding-event-film]
tools: [detect_beats_tool, build_reel_tool, add_clip_to_timeline_tool, trim_clips_tool, move_clips_tool, add_marker_tool, review_edit_tool, add_sfx_tool, master_audio_tool]
pace: medium
mood: [rhythmic, emotional, energetic]
aspect: ["9:16", "16:9", "1:1"]
pairs_with: [scale-jump-cut-on-sub-bass-hit, beat-staggered-tile-and-slice-build, withheld-music-cold-drop]
avoid_with: [commentary-hits-with-dense-designed-cues]
needs: [music-structure-detect, lyric-forced-alignment]
---

# Bar, phrase and lyric-locked cutting

## What it is
Cuts sit on bar lines (3.0 s at 80 bpm, 1.6 s at 150), on beat 1 of the
chorus, on phrase boundaries or lyric line starts; the cut length halves into
the end of a phrase and the payoff shot holds 2 bars. It is what makes a
montage feel "cut to the song" rather than to a metronome.

## Build it in Zenvi
```json
detect_beats_tool {"file_id": "<music>"}
add_marker_tool {"position_seconds": <each downbeat you cut on>, "label": "bar"}
add_clip_to_timeline_tool {... one shot per bar for 4 bars, from downbeat to downbeat}
add_clip_to_timeline_tool {... half-bar shots for the next 2 bars (phrase end)}
add_clip_to_timeline_tool {... the payoff shot for 2 bars}
add_sfx_tool {"recipe": "impact_punch", "at_seconds": <payoff downbeat>, "gain_db": -8}
master_audio_tool {"preset": "social", "genre": "hype", "iterate": true}
review_edit_tool {"pace": "fast"}
```
- `detect_beats_tool` `downbeats` are bar lines (4 beats per bar); moving the
  music clip moves every time by the same offset.
- `build_reel_tool` (style `hype` or `cinematic`) cuts on the beat grid in one
  call; re-snap section changes to the chorus downbeat with `move_clips_tool`.
- The chorus/drop and lyric line starts are not detected
  (`music-structure-detect`, `lyric-forced-alignment`): find the drop from the
  loudness jump (`spot_sound_tool climax_seconds` reports it) and mark lyric
  lines by hand.

## Timing & taste rules
- Bars for the verse, half-bars into the phrase end, a 2-bar hold on the
  payoff: shot-length spread (p90/p10) above 4.
- The biggest scene change goes on beat 1 of the chorus.
- Cut on onsets inside the bar when the music has them (77 % of cuts in game
  trailers sit on onsets, only 21 % on the grid).
- The held payoff must be the best shot, not a reused one (judge, pass 1).

## Sound for it
A hit on the phrase-end downbeat and on the payoff; tactile foley inside shots
(key clicks, a trigger). Master to -14 LUFS: the unmastered test played so
quietly the judge heard "zero sound design" with 8 cues in it.

## Common mistakes
- Every cut on every beat (machine-gun).
- A flat bar grid for the whole piece.

## Verified
2026-10-29: 13 s 9:16 gaming tests on a 99.5 bpm groove: 4 one-bar shots,
4 half-bar shots, a 2-bar payoff. Pass 1: 3.64 (reused opening shot as the
payoff). Pass 2 (new payoff, unified grade, hits on every cut, unmastered):
3.73, "zero sound design": master the mix before judging.
