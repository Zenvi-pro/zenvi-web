---
id: commentary-hits-with-dense-designed-cues
kind: technique
summary: "For a broadcast-style hype spot: radio-EQ commentary above the music at peaks, a designed cue on nearly every beat."
categories: [sports-hype-edit]
tools: [auto_sound_design_tool, spot_sound_tool, add_sfx_tool, eq_tool, duck_under_speech_tool, master_audio_tool, set_track_role_tool, unify_grade_tool]
pace: frantic
mood: [hype, broadcast, celebratory]
aspect: ["16:9", "9:16"]
pairs_with: [whip-and-match-cut-chain, tactile-plate-animation, withheld-music-cold-drop]
avoid_with: [foreground-occluder-cut-in-footage, stacked-word-flipper]
needs: []
---

# Commentary hits with dense designed cues

## What it is
Archival or play-by-play commentary, band-passed like old radio, sits above
the music at the peak moment ("…and he's through!"), while a hit, click or
whoosh lands on every animated beat (about 17 cues a minute) and a stinger
closes on the title. This is the BBC broadcast-spot mode of sports hype, the
opposite of the naturalistic foley mode.

## Build it in Zenvi
```json
set_track_role_tool {"track": "<VO track>", "role": "voice"}
eq_tool {"clip_ids": ["<commentary>"], "preset": "phone"}
auto_sound_design_tool {"intensity": "hype", "density": "every_cut", "genre": "hype"}
add_sfx_tool {"recipe": "impact_boom", "at_seconds": <title>, "gain_db": -6}
duck_under_speech_tool {"speech_clip_ids": "<commentary clip id>", "duck_db": -8}
master_audio_tool {"preset": "social", "target_lufs": -11, "genre": "hype", "balance": "keep"}
```
- `eq_tool` preset `phone` is the band-pass (about 300 Hz-3.4 kHz); for a
  warmer archive tone use `bands` with a high-pass at 200 Hz and a low-pass
  at 5 kHz.
- `duck_under_speech_tool` takes one clip id as a string (a list is refused).
- `spot_sound_tool {"genre": "hype"}` first if you want to see the hit points
  before laying sound.
- Real commentary needs rights; a TTS line works as a placeholder only.

## Timing & taste rules
- Commentary only at 1-2 peaks per 30 s, never wall to wall; the line lands
  on the action it names.
- Cues: about one per 3.5 s on average, clustered on the animated beats.
- Master hot for this mode (-10 to -11 LUFS, true peak -1 dBTP); the
  naturalistic mode sits at -14 to -17.
- One grade across every clip (`unify_grade_tool`); mixed stock sources were
  the judge's main visual complaint.

## Sound for it
It is the sound: commentary forward, music ducked 8 dB under the line, hits
on picture events, a stinger on the title, crowd swell under the peak.

## Common mistakes
- Using this palette in a cinematic piece (a whoosh on every cut there is the
  average mistake; see `withheld-music-cold-drop`).
- A plain title card at the end (judge: "plain white text on black") — slam it
  with a sub hit and a scale settle.

## Verified
2026-10-29: 9 s 9:16 test: six sports shots of 1-1.4 s, a TTS commentary
line through `eq_tool` phone, `auto_sound_design_tool` hype/every_cut, boom on
a "FINAL DAY" card, mastered to -11 LUFS. Judge 3.91: weak first shot, plain
end card, mixed stock grades. The sound layer itself was not faulted.
