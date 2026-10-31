---
id: vo-keyed-emphasis-stack
kind: technique
summary: "When the voice sells and type should hit with it: words pop on the VO, hero words 2-3x larger, bed ducked."
categories: [fashion-beauty-ad, kinetic-type-motion-design]
tools: [kinetic_captions_tool, add_kinetic_title_tool, get_transcript_tool, duck_under_speech_tool, add_sfx_tool]
pace: fast
mood: [bold, persuasive, energetic]
aspect: ["9:16", "4:5", "1:1"]
pairs_with: [text-between-subject-layers, pause-free-tight-cut, accelerating-cut-length-ramp]
avoid_with: [karaoke-word-highlight-captions, documentary-register-parody-kit]
needs: [caption-word-highlight-box]
---

# VO-keyed emphasis stack

## What it is
Lines build word by word in step with the narration; the 2-3 words that sell
the line land 2-3x larger in the accent (TIME, FEWER), connectors stay small.
The type is the second voice; the music ducks under the real one.

## Build it in Zenvi
1. Word times from `get_transcript_tool {"includeWords": true}` or phrase cues.
2. ```json
   kinetic_captions_tool {"timeline_clip_ids": ["<a>", "<b>", "<c>"], "style": "creator",
     "animation": "pop", "emphasis": ["time", "fewer"], "text_size": 0.06,
     "placement": "style", "cues": [...]}
   ```
   `placement: "auto"` (default) mattes every clip first so emphasis can go
   behind the head: right for a single talking head, about a minute of
   matting per clip; `"style"` is instant for B-roll.
3. A stacked headline for the claim line instead of captions:
   `add_kinetic_title_tool {"text": "fewer tabs open", "style": "stack",
   "animation": "slide_up", "emphasis": ["fewer"]}`.
4. Bed: `duck_under_speech_tool {"speech_clip_ids": "<vo>", "bed_clip_ids": "<music>",
   "duck_db": -10}`: ids as one comma-separated string (a list is refused);
   without them it found no bed in one test, so check the receipt.
5. `add_sfx_tool {"recipe": "pop", "gain_db": -18}` on each hero word, seeds varied.

## Timing & taste rules
- 2-4 hero words per 10 s, each once; connectors 0.055-0.065 of the short side.
- The hero word appears on its first syllable (±2 frames), holds to the
  phrase end.
- Hero word 130-150 % on entry, settling to 100 % (pop's overshoot).
- A highlight box behind words (the fashion reference's red box) needs
  `caption-word-highlight-box`; fallback: accent colour only.

## Sound for it
A soft pop at -18 dB per hero word; bed 8-12 dB under the voice.

## Common mistakes
- Every noun emphasised.
- Secondary line crammed under the hero word (judge: "tabs open" crowded the
  lower margin): leave a line of air, or move `y` up.
- Ending on the last syllable: hold 0.5 s and let the bed fade.

## Verified
2026-10-28: 3.8 s test, three shots (wide vlog, laptop macro, ring-light head),
synthetic VO, creator/pop with TIME and FEWER, lofi bed ducked, pops. Note: the
lofi bed has 30 s of silence at its start; the first render had no music until
the in-point was moved. Watch judge typography 7, overall 6.09 (the best of the
30 tests); fixes: hold after the last word, a more elastic pop.
