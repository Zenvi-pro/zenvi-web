---
id: karaoke-word-highlight-captions
kind: technique
summary: "When speech carries the piece on mute: 2-4 word caps chunks, the spoken word flips to one accent colour, snap-in."
categories: [podcast-clip-vertical, talking-head-captions]
tools: [kinetic_captions_tool, transcribe_media_tool, get_transcript_tool, edit_captions_tool, preview_frame, generate_subject_matte_tool]
pace: fast
mood: [direct, energetic, informative]
aspect: ["9:16", "4:5", "1:1"]
pairs_with: [pause-free-tight-cut, slide-in-pill-badge-and-name-cards, angle-switching-on-speech, voice-over-bed-mix-balance]
avoid_with: [vo-keyed-emphasis-stack, sentence-split-rapid-hook]
needs: []
---

# Karaoke word-highlight captions

## What it is
Bold capitals in 2-4 word chunks at chest height; the word being spoken turns
yellow (or the brand accent), the rest stay white with a dark stroke. The
podcast-clip and creator-short default: readable muted, and the highlight
moves with the voice so the eye never searches.

## Build it in Zenvi
1. Word times. Footage that speaks: leave `cues` out, the tool transcribes the
   clip. A TTS or separate VO: `transcribe_media_tool` on the narration, then
   `get_transcript_tool` `includeWords: true`; or script cues of one phrase each
   (`{"text", "start", "end"}` in timeline seconds; words inside a cue are timed
   by length).
2. One call:
   ```json
   kinetic_captions_tool {"timeline_clip_ids": ["<A-roll>"], "style": "karaoke",
     "emphasis": ["habits", "first", "last", "outside"], "text_size": 0.085,
     "y": 0.66, "placement": "style", "cues": [...]}
   ```
   `placement: "style"` + `y` 0.62-0.70 when there is no subject matte: the
   automatic placement put the chunk across the mouth in the test. With a matte
   (`generate_subject_matte_tool` first) `placement: "auto"` keeps off the head.
3. `preview_frame` on 3 chunk starts: the active word is yellow, nothing over
   the mouth, the chunk inside the 9:16 caption safe area.
4. Misheard words: `edit_captions_tool`, never a second caption pass on top.

## Timing & taste rules
- Chunk 2-4 words (the tool groups about 4); a new chunk every 0.5-0.9 s at
  165-180 wpm. One accent colour only; the accent is the active or stress word.
- Size: `text_size` 0.08-0.09 of the short side gives 4.5-6.5 % frame height
  per line on 9:16 (the default 0.059 reads small on a phone).
- Centre to lower-centre (y 0.62-0.70), never in the bottom 20 % (platform UI).
- Captions repeat the speech exactly; no paraphrase.
- Hold the last chunk 0.4-0.6 s past the last word, then end on a button.

## Sound for it
None on the words (the reference shorts put no cue on caption changes). Keep
the voice the loudest thing: bed 18-30 dB under it or absent (`voice-over-bed-mix-balance`).

## Common mistakes
- Chunks of 6+ words wrapping to three lines: the eye reads a paragraph.
- Accent on every chunk's last word by rule: emphasis is the stress word.
- Auto placement without a matte on a centred face: covered mouth.
- Chunks break across phrases ("...fixed / my mornings"): the tool groups by
  count, not by phrase (gap `caption-chunk-phrase-break`); cue phrases short
  so the breaks fall near them.

## Verified
2026-10-28: 4.8 s 9:16 test, ring-light talking head (stock) + synthetic VO
with phrase cues, `kinetic_captions_tool` karaoke as above, rendered with the
CLI. Contact sheet: active word yellow on every chunk, chest height, readable.
First pass with `placement: "auto"` and no matte put the chunk on the mouth;
fixed with `placement: "style"`, `y: 0.66`. Watch judge (absolute) typography
6/10; its fixes were about the test's missing button and static shot, not the
captions.
