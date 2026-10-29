---
id: angle-switching-on-speech
kind: technique
summary: "When one camera holds a talker too long: cut on sentences and punchlines, alternating wide and a 1.35x close."
categories: [fitness-lifestyle, podcast-clip-vertical]
tools: [get_transcript_tool, split_clip_tool, set_clip_properties_tool, swap_shot_tool, diarize_media_tool, remove_silence_tool]
pace: medium
mood: [conversational, deadpan, direct]
aspect: ["9:16", "16:9", "4:5"]
pairs_with: [karaoke-word-highlight-captions, pause-free-tight-cut, slide-in-pill-badge-and-name-cards]
avoid_with: [slow-motion-with-anchored-subject-tracking]
needs: [speaker-angle-switch]
---

# Angle switching on speech

## What it is
The picture follows the talk: cut on the sentence boundary, the question and
its answer, the punchline. With two real cameras, alternate them (wide master,
45-degree medium); with one, fake the second angle with a 1.3-1.6x crop.

## Build it in Zenvi
1. Boundaries: `get_transcript_tool {"includeWords": true}` (or
   `diarize_media_tool` for who speaks when). List the cut times: sentence
   ends, the word before a punchline, speaker turn starts.
2. Single camera: `split_clip_tool {"clip_id": "<clip_id>", "at_seconds": "<at_seconds>"}` at each time, then
   on every other piece
   `set_clip_properties_tool {"timeline_clip_ids": [...], "properties":
   {"scale_x": 1.35, "scale_y": 1.35, "location_y": 0.08}}` (location_y keeps
   the eyes near the upper third after the crop).
3. Two angles: `swap_shot_tool` the piece onto the other camera's clip at the
   same source time (synced takes).
4. Tighten pauses first if the take is loose (`remove_silence_tool`).

## Timing & taste rules
- Hold 1.2-6.5 s per angle; 14-26 cuts a minute; no shot over 10 s.
- The close is at least 1.3x (1.0 vs 1.15 reads as a mistake, not a camera:
  the judge called 1.35 still "too subtle" on a medium shot; use 1.5 there).
- Cut on the word before the punchline lands; the answer gets the close.
- Never cut mid-word; snap to the gap before the first word of the sentence.

## Sound for it
No cue on angle cuts: the voice carries them. Room tone continuous.

## Common mistakes
- Alternating on a timer instead of on the words.
- A crop that cuts the chin or the top of the head off at the eyes.
- Upscaled soft footage: above 1.6x on 1080p the close goes mushy.

## Verified
2026-10-28: 4.9 s podcast test (stock, single camera), synthetic VO, four
pieces wide / 1.35x / wide / 1.35x cut on the sentence and the answer. Contact
sheet: the closes read as a second camera, eyes at the upper third. Watch judge
overall 3.55; fix 1: the 1.35x close on a medium shot is too subtle; rule raised
to 1.5x for medium framings. Gap: `speaker-angle-switch` (cut to the
diarised speaker's camera automatically).
