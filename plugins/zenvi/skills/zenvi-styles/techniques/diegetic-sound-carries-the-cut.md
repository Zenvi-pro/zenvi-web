---
id: diegetic-sound-carries-the-cut
kind: technique
summary: "For a scene change in a music-led event film: the song dips 3-7 dB so a real sound carries the hard cut."
categories: [wedding-event-film]
tools: [add_clip_to_timeline_tool, set_clip_properties_tool, unify_grade_tool, search_sfx_tool, add_sfx_tool, automate_volume_tool, duck_tool, analyze_mix_tool, master_audio_tool]
pace: calm
mood: [romantic, tactile, joyful]
aspect: ["16:9", "2.39:1", "9:16"]
pairs_with: [bar-phrase-and-lyric-locked-cutting, tighten-then-release-into-held-payoff, l-cut-audio-carrying-over-a-cutaway, white-flash-or-light-leak-join]
avoid_with: [blackout-and-dead-silence-pause]
needs: []
---

# Diegetic sound carries the cut

## What it is

The song steps back a few dB and a real, in-world sound (an ignition and
engine, a door, applause) rises on or just before a hard cut, carries the
scene change with no transition, and the song comes back. It makes the
film feel lived-in instead of a music video, and lets one cut move from
the getting-ready to the car, or from the car to the guests.

## Build it in Zenvi

With recorded location sound, use the clip's own audio
(`separate_clip_audio_tool`, `set_track_role_tool` ambience). Stock has no
usable sound, so take a real CC0 recording from the library.

```json
add_clip_to_timeline_tool {"file_id": "<couple>", "position_seconds": 0, "start_seconds": 1, "end_seconds": 3.5, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<vintage car>", "position_seconds": 2.5, "start_seconds": 0.5, "end_seconds": 3.0, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<car aerial>", "position_seconds": 5.0, "start_seconds": 3, "end_seconds": 5.5, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<guests>", "position_seconds": 7.5, "start_seconds": 4, "end_seconds": 7.0, "track": "1"}
set_clip_properties_tool {"scope": "all", "properties": {"scale": "Crop", "volume": 0}}
unify_grade_tool {"look": "romantic_cinema", "look_intensity": 0.4}
add_clip_to_timeline_tool {"file_id": "<song>", "position_seconds": 0, "start_seconds": 20, "end_seconds": 30.5, "track": "5"}
search_sfx_tool {"query": "car engine start", "provider": "freesound", "min_seconds": 4, "max_seconds": 20, "license": "cc0"}
add_sfx_tool {"provider": "freesound", "sound_id": "405322", "title": "Car Engine Start.wav", "at_seconds": 2.7, "max_seconds": 5.0, "gain_db": -18}
automate_volume_tool {"clip_ids": "<song>", "shape": "dip", "start_seconds": 2.6, "end_seconds": 7.3, "db": -6, "fade_ms": 250}
add_sfx_tool {"provider": "freesound", "sound_id": "400586", "title": "Medium crowd cheering 02", "at_seconds": 7.5, "max_seconds": 3.0, "gain_db": -24}
master_audio_tool {"target_lufs": -15, "true_peak_dbtp": -1.0, "balance": "keep"}
analyze_mix_tool {}
```

Alternative to the hand-placed dip: `duck_tool {"bed": "music", "under":
"<engine sfx clip id>", "depth_db": -6, "attack_ms": 150, "release_ms": 600}`.
The same sounds on Openverse: engine `75fe4c61-5ded-4243-a92b-91bf9844b6a7`,
crowd `c80ae9c9-9f84-4b03-8bc1-27c87feef9dd`, applause
`baf7990c-657a-47ab-83c0-4ec2437095c3` (provider `openverse`, with title).

## Timing & taste rules

- Dip 3-7 dB (6 dB here), 200-300 ms ramps; starts 0.1-0.2 s before the
  ignition and ends 0.2 s before the next scene, so the song is back for it.
- The ignition fires on the outgoing shot (0.2-2 s before the cut); the
  running engine crosses the cut and lasts 2-3 s into the new shot.
- Ignition 2-4 LU over the dipped song, then the engine about equal to it.
- Crowd/applause enters on the cut frame, under the song (song stays the
  lead), ramped up in about 0.3 s, never a sudden wall.
- At most 2-3 such moments per 90 s; each one is a scene change.

## Sound for it

Song is the lead, -15 to -16 LUFS. The diegetic cue sits 0 to +3 LU over
the dipped song for its transient, then level with it. Crowd/ambience
6-10 dB under the song. Run `analyze_mix_tool` after `master_audio_tool`:
its "SFX vs mix" check (want -8 to -3 LU over the whole piece) flags a
cue that is loud for too long.

## Common mistakes

- The engine 10+ dB over the song: it reads as a sound-effects reel
  (first pass here: engine at -6 dB was 15 LU over a quiet piano intro).
- Starting the bed in the song's soft intro; the dip then falls to
  near-silence. Use a section of the song with body.
- Applause louder than the song under a guests cut.
- A dissolve on the cut; the sound is the transition.

## Verified

2026-10-28. 10.5 s at 1280x720/24, Pexels couple, vintage car, car
aerial and guests, piano bed (Freesound 744876 from 20 s), Freesound CC0
engine start (405322) and crowd (400586). Openverse returned 500 for both
given ids that day, so the build uses the Freesound copies; `add_sfx_tool`
also refused Freesound 250009 by its listed title ("not found under the
title"). Three level passes with `analyze_mix_tool` (score 54 to 67;
engine -6, -12, then -18 dB). Judge 6.64/10, sound design 8, mix 8:
"executing the engine start cut and party cheer ducking with precision";
remaining fixes were the guests shot's colder grade and the ending.
Artifacts: `~/zenvi-motion/fleet/artifacts/sk4-cinematic-story/techniques/diegetic-sound-carries-the-cut.*`.
