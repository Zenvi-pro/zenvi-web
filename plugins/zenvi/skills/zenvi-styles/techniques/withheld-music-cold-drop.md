---
id: withheld-music-cold-drop
kind: technique
summary: "For cinematic sports or launch pieces: hold VO and ambience 10-30 s, then start the track's drop on a hard cut."
categories: [sports-hype-edit]
tools: [detect_beats_tool, add_clip_to_timeline_tool, set_track_role_tool, set_audio_gain_tool, add_sfx_tool, automate_volume_tool, duck_under_speech_tool, master_audio_tool]
pace: medium
mood: [cinematic, anticipatory, triumphant]
aspect: ["16:9", "9:16"]
pairs_with: [foreground-occluder-cut-in-footage, whip-and-match-cut-chain, slow-motion-hero-passage]
avoid_with: [commentary-hits-with-dense-designed-cues]
needs: [music-structure-detect]
---

# Withheld-music cold drop

## What it is
For the first 17-40 % of the piece there is no track: VO, wind, a strap click,
room tone over quiet wides. Then the track enters at its own drop on a hard
cut to the hero action, with one layered hit. Three of four watched sports
films do this (KEEP ON PUSHIN' at 10.1 s, DreamRide at 23.9 s); it is the
single biggest difference between them and "bed from frame 0".

## Build it in Zenvi
```json
detect_beats_tool {"file_id": "<music>"}
add_clip_to_timeline_tool {"file_id": "<music>", "position_seconds": <drop cut>, "start_seconds": <the track's drop>,
  "duration_seconds": <rest>, "track": "Music"}
set_track_role_tool {"track": "Music", "role": "music"}
add_sfx_tool {"recipe": "room_tone", "at_seconds": 0, "align": "start", "duration": <drop cut>, "gain_db": -26}
add_sfx_tool {"recipe": "reverse_swell", "at_seconds": <drop cut - 1.2>, "duration": 1.2, "gain_db": -14}
add_sfx_tool {"recipe": "impact_boom", "at_seconds": <drop cut>, "gain_db": -5}
add_sfx_tool {"recipe": "sub_drop", "at_seconds": <drop cut>, "gain_db": -8}
master_audio_tool {"preset": "social", "iterate": true}
```
- Find the drop: the loudness jump in the track (`spot_sound_tool` reports
  `climax_seconds`; or read a 1 s RMS profile). Start the music clip at that
  source second on the cut, so its first frame is the drop.
- Make the music its own track (`add_track_tool {"name": "Music"}`):
  `add_sfx_tool` creates the SFX track first, and a music clip on it would
  give the SFX the music role.
- A pre-drop VO ducks nothing (there is no bed); after the drop, if the VO
  continues, `duck_under_speech_tool`.

## Timing & taste rules
- Withhold 10-30 s in a 60 s piece; 5-7 s in a 15-25 s reel.
- The drop cut lands on the hero action at its peak frame (a jump take-off,
  the first push), never on an empty plate (pass 1 cut to an empty slope).
- After the drop, the next 3-4 cuts are on beats, then let the music phrase
  lead.

## Sound for it
Before: VO at -15 LUFS over -26 dB air and 1-2 foley details. On the cut: a
reverse swell into a boom + sub, one time only. After: no whoosh on hard cuts.

## Common mistakes
- Music under the VO "just quietly" (it kills the drop).
- The drop on a cut with nothing happening.
- A synthetic VO read flat: the judge marks it down every time; use a real
  voice or no VO (ambience-only cold opens work too).

## Verified
2026-10-29: 8 s 9:16 tests: two quiet snow wides under a TTS line and room
tone, the trap track's drop (source 12.42 s) on the cut to the hero jump.
Pass 1 (cut onto an empty slope): 2.82. Pass 2 (yellow-jacket jump, swell,
boom + sub): 2.73; the judge faults the TTS voice and the bike shot after the
drop (wrong sport). The audio structure renders as designed.
