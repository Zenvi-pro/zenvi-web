---
id: sentence-split-rapid-hook
kind: technique
summary: "When the first 2 s must grab: one hook sentence split over 5-6 takes, a word or phrase per 10-15 frame shot."
categories: [podcast-clip-vertical]
tools: [add_clip_to_timeline_tool, trim_clip_tool, kinetic_captions_tool, add_sfx_tool, unify_grade_tool, get_transcript_tool]
pace: frantic
mood: [energetic, playful, bold]
aspect: ["9:16", "4:5"]
pairs_with: [karaoke-word-highlight-captions, slide-in-pill-badge-and-name-cards, accelerating-cut-length-ramp]
avoid_with: [pause-free-tight-cut, negative-space-chapter-breath]
needs: []
---

# Sentence-split rapid hook

## What it is
The hook line ("pitch me your company in one sentence") is spoken across 5-6
takes in different places; every word or phrase is a new shot of 10-15 frames
with the word big on screen. 2.2 s that say "this is edited", then the piece
settles into longer holds.

## Build it in Zenvi
1. The takes must exist (different rooms, angles or people saying the line);
   stock or B-roll can stand in for some words, as in the test.
2. Cues: one per word or phrase in timeline seconds (from
   `get_transcript_tool` `includeWords: true`, or the script).
3. One shot per cue, butted, each cut on the next cue's start:
   `add_clip_to_timeline_tool {"file_id", "position_seconds": <cue start>,
   "start_seconds": <in>, "end_seconds": <in + cue length>}`. Keep every
   source in-point at least the shot length before the file's end (a take
   that runs out leaves black: it did in the test).
4. Words: `kinetic_captions_tool {"style": "creator", "animation": "slam",
   "emphasis": ["company", "sentence"], "text_size": 0.075, "placement": "style",
   "y": 0.62, "cues": [...]}`; the emphasis words land huge in red.
5. `add_sfx_tool {"recipe": "whoosh_short", "at_seconds": <cut>, "gain_db": -20,
   "seed": <n>}` on every cut but the first, seeds varied.
6. `unify_grade_tool` over the hook shots so the five places read as one piece.

## Timing & taste rules
- 5-6 shots in 1.8-2.4 s (0.33-0.5 s each); the last word holds 0.8-1.2 s.
- Words at 7-10 % frame height; emphasis words 2x the others.
- Every shot a new place or framing; no two consecutive from one take.
- After the hook, the next shot holds 4-6 s: the contrast is the point.

## Sound for it
A short whoosh or tick per cut at -20 dB under the voice, varied seeds; one
heavier hit on the last word. Music enters on the settle, not under the hook.

## Common mistakes
- The same take for two words (reads as a jump cut, not a montage).
- Five different grades: the hook looks like a stock reel.
- A synthetic or flat read: the hook lives on delivery; record real takes.

## Verified
2026-10-28: 2.9 s test, six shots (two talking heads, podcast mic, street,
coffee, ring-light head), synthetic VO cues, creator/slam captions, whoosh per
cut. First render ran one take past its source end (black last frame); fixed
by moving in-points. Contact sheet: one word per cut, COMPANY / SENTENCE huge
red. Watch judge typography 4, overall 3.45: it flagged the robotic TTS, the
missing bed and ungraded clips, so `unify_grade_tool` is now step 6.
