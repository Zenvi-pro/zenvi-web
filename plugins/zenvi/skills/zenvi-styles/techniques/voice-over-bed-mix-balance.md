---
id: voice-over-bed-mix-balance
kind: technique
summary: "When a voice leads the piece: voice near -14 LUFS, bed 8-12 dB under it (or 18-30 for talk clips), ducked."
categories: [fitness-lifestyle, food-recipe, science-curiosity, talking-head-captions]
tools: [set_track_role_tool, duck_under_speech_tool, analyze_mix_tool, master_audio_tool, automate_volume_tool, search_freesound_music_tool]
pace: medium
mood: [clear, calm, professional]
aspect: ["9:16", "16:9", "4:5", "1:1"]
pairs_with: [karaoke-word-highlight-captions, negative-space-chapter-breath, slow-motion-with-anchored-subject-tracking]
avoid_with: []
needs: []
---

# Voice-over-bed mix balance

## What it is
The mix every voice-led piece needs: the voice is the anchor, the bed sits
under it, swells where the voice stops (a montage, a reveal) and never fights
the 1-4 kHz band. Talk clips run the bed 18-30 dB under or drop it.

## Build it in Zenvi
1. Roles: `set_track_role_tool` voice on the VO track, music on the bed.
2. A bed that is already playing at its in-point: check the track's first
   seconds (`analyze_mix_tool` or a frame/peak check). Two of six Freesound beds
   in the test had 12-30 s of near-silence at the start.
3. Duck with explicit ids:
   ```json
   duck_under_speech_tool {"speech_clip_ids": "<vo>", "bed_clip_ids": "<music>", "duck_db": -10}
   ```
   The ids are one comma-separated string, not a list (a list is refused).
   Without ids it reported "no bed overlaps the speech" in the test; then
   `master_audio_tool` ducks beds under speech itself (-5.8 dB in the test).
4. Swell between lines: `automate_volume_tool {"role": "music", "shape": "swell_between_lines"}`;
   the montage after the VO: `"shape": "ramp"` up.
5. `master_audio_tool {"preset": "social", "genre": "talking_head", "iterate": true}`,
   then `analyze_mix_tool`: B1 voice-over-bed 8-12 dB, true peak ≤ -1 dBTP.
6. The end: `automate_volume_tool {"clip_ids": ["<music>"], "shape": "fade_out",
   "length_ms": 500}`, or end on a hit; never mid-bar.

## Timing & taste rules
- Voice -14 to -16 LUFS short-term; bed voice minus 8-12 LU (music-led
  lifestyle) or 18-30 (podcast / business-advice talk).
- Bed may enter late (around 28 % in) or swell at the reveal.
- A calm bed against frantic content can be the joke (60 bpm pad under a
  105 wpm voice).

## Sound for it
This is the sound. Duck depth 8 dB from the bed's un-ducked level, attack
fast, release 300-500 ms.

## Common mistakes
- Bed louder than the voice on a phone speaker (B1 -3.3 dB in the first test).
- Ducking twice: `master_audio_tool` ducks beds under speech as well, so a
  -12 dB tool duck plus mastering lands the bed 14+ dB under; use `duck_db` -8
  when mastering follows (the master alone gave 13.9 dB in the test).
- Silent intros in library tracks.

## Verified
2026-10-28: 7.8 s running test, synthetic VO, acoustic bed. First pass:
`duck_under_speech_tool` without ids ducked nothing, analyze_mix B1 -3.3 dB,
Sound Score 55. Second pass (the ids were passed as a list and refused; `master_audio_tool`
ducked the bed instead): B1 13.9 dB, Sound Score 75, -14 LUFS.
Watch judge mix and overall 4.64; fix: end on the music phrase, not a fade
mid-phrase (trim the bed so its phrase ends with the picture).
