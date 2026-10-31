---
id: lyric-text-timed-to-vocals
kind: technique
summary: "For any lyric video: each lyric word or line appears on its vocal onset and clears in the breath after it."
categories: [music-lyric-video]
tools: [add_clip_to_timeline_tool, kinetic_captions_tool, add_kinetic_title_tool, transcribe_media_tool, get_transcript_tool, apply_look_tool, color_grade_clip_tool, set_audio_gain_tool, master_audio_tool]
pace: medium
mood: [intimate, melancholic, dreamy]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [reset-inside-the-vocal-rest, one-hue-treatment-with-glow-silhouette, bar-phrase-and-lyric-locked-cutting, persistent-frame-mask-over-whole-video]
avoid_with: [diegetic-lyric-on-set-props]
needs: [lyric-forced-alignment]
---

# Lyric text timed to vocals

## What it is

The lyric is shown in sync with the singer: a word, syllable or phrase
appears on its vocal onset, the line builds while it is sung and clears in
the breath before the next line. Three looks share the rule: snap-on
monospace stanza (no fade), serif words with 4-frame fades, or a lowercase
subtitle line with an all-caps shout line.

## Build it in Zenvi

You need the vocal's line (ideally word) onsets. With a clean vocal stem on
a surface with ASR: `transcribe_media_tool {"file_id": "<vocal>"}`, then
`get_transcript_tool`, then `kinetic_captions_tool` on the vocal clip.
ASR on sung vocals is unreliable and the CLI bench server has none, so the
dependable path is script cues at measured line onsets: one cue per sung
line (start = onset, end = last sound), and the tool spreads the words
over the line by length.

```json
add_clip_to_timeline_tool {"file_id": "<night sea>", "position_seconds": 0, "start_seconds": 3, "end_seconds": 18, "track": "1"}
apply_look_tool {"clipIds": "all", "look_id": "duotone #02060f #9cc3ff"}
color_grade_clip_tool {"timeline_clip_ids": ["<sea>"], "exposure": -0.4}
add_clip_to_timeline_tool {"file_id": "<vocal stem>", "position_seconds": 0, "start_seconds": 0, "end_seconds": 15, "track": "4"}
add_clip_to_timeline_tool {"file_id": "<music bed>", "position_seconds": 0, "start_seconds": 3.2, "end_seconds": 18.2, "track": "5"}
set_audio_gain_tool {"clip_ids": ["<bed>"], "gain_db": -10}
kinetic_captions_tool {"cues": [{"text": "the tide comes in", "start": 0.60, "end": 1.70}, {"text": "and you are still", "start": 2.41, "end": 3.28}, {"text": "a light I keep beneath the water", "start": 4.30, "end": 6.05}, {"text": "say my name", "start": 9.31, "end": 10.20}], "style": "editorial", "emphasis": ["light", "name"], "accent": "#9cc3ff", "animation": "fade", "text_size": 0.075, "y": 0.84}
master_audio_tool {"target_lufs": -15, "true_peak_dbtp": -1.0, "balance": "keep"}
```

Snap stanza: `"style": "stack"` (no fade); subtitle line: `add_captions_tool`
from an SRT, plus `add_kinetic_title_tool` for the shout line.
Missing: `lyric-forced-alignment` (align known lyrics to a sung vocal to
get word and syllable onsets). Fallback: measure line onsets outside Zenvi
(`ffmpeg -af silencedetect=noise=-40dB:d=0.25` on the vocal stem gives
each line's start and end) and pass them as cues; words inside a line are
then timed by length, not by the singer.

## Timing & taste rules

- Line onset within 1-2 frames of the vocal onset; never after it by more
  than 2 frames (late text reads as karaoke lag). Here every line landed
  0.3-0.5 frame from the measured onset (the tool rounds to frames).
- Serif fade-in 3-4 frames; snap styles 0 frames.
- Clear the line in the rest (0.2-0.7 s gaps here), not on the next beat.
- Size 6-7.5 % of the frame's short side for 16:9; place it over the
  darkest band of the shot (lower water, sky), never over specular
  highlights; set `y` yourself, `placement: auto` moved it around.
- One accent colour for 2-3 emphasis words per verse, taken from the grade.

## Sound for it

The vocal is the anchor (-15 LUFS); the bed sits 8-12 LU under it
(`set_audio_gain_tool` -10 dB here). No sound effects on words; at most a
soft swell of the bed in long rests (`automate_volume_tool` shape
`swell_between_lines`).

## Common mistakes

- Timing words by hand from the beat grid instead of the voice.
- Thin white type over bright reflections.
- Leaving a line up through the next line's onset.
- Trusting ASR word times on a sung, reverbed vocal without checking.

## Verified

2026-10-28. 15 s at 1280x720/24: Pexels night sea in a cobalt duotone,
an original spoken lyric (macOS say) as the vocal, six line cues at the
silencedetect onsets. `transcribe_media_tool` refused on the CLI
("speech recognition is not available yet on this Zenvi server", all
engines), and `analyze_timeline_audio_tool` had no speech windows for the
unindexed wav. Caption clip starts read from the project: 0.583 / 2.417 /
4.292 / 9.292 / 10.917 / 13.000 s against onsets 0.602 / 2.406 / 4.304 /
9.313 / 10.902 / 13.013 s (all under 1 frame). Judge 5.45/10: "gentle
fade-ins match the intimate cadence of the vocal"; fixes were legibility
over the highlights and the abrupt test ending. Artifacts:
`~/zenvi-motion/fleet/artifacts/sk4-cinematic-story/techniques/lyric-text-timed-to-vocals.*`.
