---
id: pause-free-tight-cut
kind: technique
summary: "When a talking take is loose: strip fillers and pauses until speech fills 96-99% of runtime, first cut by 1.4 s."
categories: [talking-head-captions]
tools: [transcribe_media_tool, remove_words_tool, remove_silence_tool, trim_clip_tool, add_kinetic_title_tool]
pace: fast
mood: [direct, urgent, confident]
aspect: ["9:16", "4:5", "1:1"]
pairs_with: [karaoke-word-highlight-captions, angle-switching-on-speech, vo-keyed-emphasis-stack]
avoid_with: [negative-space-chapter-breath, blackout-and-dead-silence-pause]
needs: []
---

# Pause-free tight cut

## What it is
The creator-short speech edit: no "um", no breath gaps, no settling in. The
piece starts mid-thought with the headline already on screen, and speech
fills 96-99 % of the runtime.

## Build it in Zenvi
1. Fillers (needs a transcript, credits on the CLI):
   `transcribe_media_tool` then `remove_words_tool {"fillerPreset": "english_fillers"}`.
2. Gaps, on the A-roll clip (works from the audio, no transcript):
   ```json
   remove_silence_tool {"clipId": "<A-roll>", "minPauseSec": 0.35, "padSec": 0.12}
   ```
   `padSec` 0.12: at 0.06 the test clipped word endings ("aggressively
   truncated" said the judge); `minPauseSec` 0.3-0.4 keeps natural clause rhythm.
3. Cold open: `trim_clip_tool` the first sentence so the first word is at
   frame 0-3; drop greetings.
4. Headline on from 0 s: `add_kinetic_title_tool {"text": "Why you quit too early",
   "style": "creator", "emphasis": ["quit"], "y": 0.16, "duration_seconds": 3}`.
5. Hide the jumps: punch-ins on alternate pieces (`angle-switching-on-speech`)
   or captions that change on the cut (`karaoke-word-highlight-captions`).

## Timing & taste rules
- Speech fraction 0.96-0.99; no pause over 0.4 s inside a sentence.
- First cut by 1.4 s (median of the reference shorts); first word by 0.1 s.
- Keep one breath before the payoff line: a 0.2-0.3 s gap is the one allowed.

## Sound for it
Voice -14 LUFS, bed 18-30 dB under or none; no SFX on jump cuts.

## Common mistakes
- Source in-point not where the speech is (the test's first version used a
  6 s in-point on a file whose voice started at 0 and kept 0.9 s).
- Visible jump cuts on a locked wide with nothing to hide them.
- Removing every breath: the delivery turns robotic.

## Verified
2026-10-28: 4.5 s test, a wide talking-head plate with a synthetic read muxed
in with 0.75 s pauses (what a phone take gives), `remove_silence_tool` 0.35 /
0.12 removed 3 gaps, creator headline at 0 s. Watch judge overall 3.64 (1.55
before the in-point and padding fixes); remaining notes: the static plate needs
punch-ins and the synthetic voice still sounds stilted.
