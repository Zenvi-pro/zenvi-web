---
id: reset-inside-the-vocal-rest
kind: technique
summary: "For lyric videos and sung edits: change the picture or clear the text in the breath between lines, not on the beat."
categories: [music-lyric-video]
tools: [add_marker_tool, add_clip_to_timeline_tool, set_clip_properties_tool, fade_clip_tool, split_clip_tool, kinetic_captions_tool, analyze_timeline_audio_tool, automate_volume_tool, set_audio_gain_tool, master_audio_tool]
pace: calm
mood: [intimate, melancholic, dreamy]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [lyric-text-timed-to-vocals, one-hue-treatment-with-glow-silhouette, bar-phrase-and-lyric-locked-cutting]
avoid_with: [beat-locked-kinetic-type-cuts, cuts-on-audio-transients]
needs: []
---

# Reset inside the vocal rest

## What it is

Picture changes and text clears are placed in the singer's breaths, so a
line is never cut in half. Two sizes: a hard cut in the middle of a short
breath (0.4-0.8 s), and in a long pause a fade to black that holds through
the rest and comes back just before the voice. It makes the edit feel
like it is listening to the singer, not the drum machine.

## Build it in Zenvi

Find the rests first. `analyze_timeline_audio_tool {"timeline_clip_id":
"<vocal>", "detail": "windows"}` gives speech windows when the vocal is
indexed; for an unindexed stem measure line ends and onsets with ffmpeg
`silencedetect` (noise -40 dB, d 0.25). Mark them, then place the edits.

```json
add_marker_tool {"position_seconds": 6.05, "name": "rest A start", "color": "yellow"}
add_marker_tool {"position_seconds": 12.65, "name": "rest B middle", "color": "yellow"}
add_clip_to_timeline_tool {"file_id": "<shot 1>", "position_seconds": 0, "start_seconds": 3, "end_seconds": 9.45, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<shot 2>", "position_seconds": 8.15, "start_seconds": 2, "end_seconds": 6.5, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<shot 3>", "position_seconds": 12.65, "start_seconds": 0, "end_seconds": 2.85, "track": "1"}
set_clip_properties_tool {"scope": "all", "properties": {"scale": "Crop", "volume": 0}}
add_clip_to_timeline_tool {"file_id": "<vocal>", "position_seconds": 0, "start_seconds": 0, "end_seconds": 15, "track": "4"}
add_clip_to_timeline_tool {"file_id": "<bed>", "position_seconds": 0, "start_seconds": 3.2, "end_seconds": 18.7, "track": "5"}
fade_clip_tool {"clip_id": "<shot 1>", "fade_in_seconds": 0.4, "fade_out_seconds": 0.4}
fade_clip_tool {"clip_id": "<shot 2>", "fade_in_seconds": 0.45}
kinetic_captions_tool {"cues": [{"text": "a light I keep beneath the water", "start": 4.30, "end": 6.05}, {"text": "say my name", "start": 9.31, "end": 10.20}], "style": "editorial", "animation": "fade", "text_size": 0.075, "y": 0.84}
set_audio_gain_tool {"clip_ids": ["<bed>"], "gain_db": -10}
automate_volume_tool {"clip_ids": ["<bed>"], "shape": "swell", "start_seconds": 6.1, "end_seconds": 9.2, "db": 3}
master_audio_tool {"target_lufs": -15, "true_peak_dbtp": -1.0, "balance": "keep"}
```

With one long clip instead of several, `split_clip_tool` at the rest
marker and swap the second half. Add audio clips after any
`set_clip_properties_tool {"scope": "all", "properties": {"volume": 0}}`: scope all mutes
them too (the first build here mastered a silent mix and was refused).

## Timing & taste rules

- Short breath (0.4-0.8 s): hard cut at its middle, at least 3 frames
  after the last sound and 3 before the next onset.
- Long pause (2.5 s+): fade out 0.3-0.5 s starting on the last sound,
  black 1.0-1.7 s, fade in 0.4-0.5 s ending 0.3-0.7 s before the voice.
  For short-form (under 30 s) keep the black near 1.0 s; the judge called
  1.7 s "dead air" there, though long-form lyric videos hold it.
- Text clears on the last sound of its line (cue end = line end).
- No cut inside a word or a held note, even if it is on the downbeat.

## Sound for it

The vocal stays dry and on top (-15 LUFS); the bed 8-12 LU under it. In a
long pause let the bed swell +2 to +3 dB (`swell`, or
`swell_between_lines` once the vocal track has the voice role) so the
black is held by music. A hard cut in a breath may take a soft
`whoosh_short` or water texture 12-18 dB under the bed, no hit.

## Common mistakes

- Cutting on the beat grid and slicing the singer's words.
- Fading the picture back after the voice has started.
- Black with nothing under it (bed muted or too low).
- Clearing text a beat late so it hangs into the next line.

## Verified

2026-10-28. 15 s at 1280x720/24, cobalt duotone: night sea, fade to
black at the 6.05 s line end, 1.7 s black, waves fade up at 8.15-8.6 s
before the 9.31 s onset; hard cut to a dancer at 12.65 s inside the
12.29-13.01 s breath; captions cue-timed as in lyric-text-timed-to-vocals.
`analyze_timeline_audio_tool` returned no speech windows (wav not
indexed), so rests came from silencedetect. Judge 5.55/10, pacing 7:
"synchronizing of edits with natural vocal pauses creates a moody,
deliberate rhythm"; top fix was shortening the 1.7 s black. Artifacts:
`~/zenvi-motion/fleet/artifacts/sk4-cinematic-story/techniques/reset-inside-the-vocal-rest.*`.
