---
id: kinetic-vo-captions
kind: technique
summary: "When someone speaks (talking head, VO, podcast): words appear on the voice, emphasis huge, laid round the subject."
categories: [talking-head-captions, podcast-clip-vertical, ugc-ad-testimonial, video-essay-explainer, kinetic-type-motion-design, fashion-beauty-ad, news-short-vertical-explainer]
tools: [kinetic_captions_tool, transcribe_media_tool, generate_tts_and_add_to_timeline_tool, generate_subject_matte_tool, edit_captions_tool, add_sfx_tool, duck_tool]
pace: fast
mood: [direct, energetic, personal]
aspect: ["9:16", "4:3", "1:1", "16:9"]
pairs_with: [kinetic-emphasis-scale, kinetic-word-pop, kinetic-text-behind-subject, kinetic-lower-third, kinetic-keyword-slam]
avoid_with: [kinetic-karaoke, kinetic-lyric-sync, kinetic-typewriter]
needs: []
---

# Kinetic captions synced to VO

## What it is
Word-by-word captions timed to the speech: connectors small and white, emphasis words 3-6x in the condensed display face
and accent, placed in each shot's negative space and off the head, the biggest words tucked behind the head (with a
subject matte). The talking-head caption look; the type *is* the caption.

## Build it in Zenvi
```json
generate_subject_matte_tool {"clip_id": "<speaker clip>"}
kinetic_captions_tool {"style": "creator", "emphasis": "deadline,idea,time", "behind_subject": "auto"}
add_sfx_tool {"recipe": "pop", "at_seconds": <each emphasis word>, "gain_db": -16}
```
Words come from the transcript (`transcribe_media_tool`, or the TTS voice's own word timings). With no transcription
(not signed in) pass script `cues` (timeline seconds; a cue of several words shares its time by length):
`"cues": [{"text": "Stop chasing the deadline.", "start": 0.3, "end": 1.79}, …]`. Styles: `documentary` (phrase at a
time, small Inter), `split` (two words either side of the face), `stack`, `editorial`; `karaoke` is kinetic-karaoke.

## Timing & taste rules
- Word on screen within 1-2 frames of its onset; captions never lag the voice.
- Chunks of 1-4 words; clear at clause ends (one clear per 1-1.5 s).
- Caption box overlaps the face 0 % of frames (`avoid` box or the matte); off the bottom 20 % on 9:16.
- Hero:connector ≥ 2 (3-6 best); one emphasis per clause.
- Music ducked 8-12 dB under the voice (`duck_tool`).

## Sound for it
Voice is the anchor (-15 LUFS); a pop on each emphasis word (-16 to -20 dB, 3-6 dB under the voice, varied samples), a
whoosh only on cuts. No sound on connector words.

## Common mistakes
- Every word emphasised (auto + a long list): pick 1 per clause.
- Captions centred on the chest covering the hands.
- Lag from estimated cues on a voice with long pauses: cue phrase by phrase, not the whole script as one cue.

## Verified
VERIFIED:kinetic-vo-captions
