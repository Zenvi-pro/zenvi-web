---
id: cin-ps-beat-quantized-chunks
kind: technique
summary: "When a line sits over a pulse: it arrives in 2-3 meaning chunks, each landing exactly on the next beat."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [detect_beats_tool, add_kinetic_title_tool, add_sfx_tool]
pace: medium
mood: [rhythmic, assertive, musical]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [beat-locked-kinetic-type-cuts, kinetic-mask-reveal, kinetic-word-pop]
avoid_with: [shot-blur-slide, kinetic-vo-captions]
needs: [motion-block-word-cues]
drawn: cinetic
---

# Phrase chunks on the beat

cinetic `ps-beat-quantized-chunks` · Pacing and structure · workhorse · energy medium · formats launch, feature, sting, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A line arrives in two or three chunks split by meaning, each landing exactly on the next beat, so the reading rhythm is performed by the track.

Use when: Statement lines over music with a clear pulse, launch openers, and 3-7 word claims.

## Build it in Zenvi

1. Beats of the track: `detect_beats_tool {"file_id": "<music>"}` (120 BPM: a beat every 0.5 s, 30 f). Split the copy by meaning (subject | object | qualifier), 3-7 words in total.
2. One kinetic title per chunk, each starting half its first word's rise before the beat so the rise's 50 % frame lands on the beat: `add_kinetic_title_tool {"text": "<chunk 1>", "style": "editorial", "animation": "rise", "position_seconds": 4.46, "duration_seconds": 3.0, "stagger_seconds": 0.067, "y": 0.45}` (4 f, 0.067 s, between words), then chunk 2 at 4.96 s and chunk 3 at 5.46 s, same style and size.
3. Calmer build: one beat per word, `animation: "fade"` with `stagger_seconds` 0.5, a rise of 13 px (0.012) over 28 f (0.47 s) and a 1 px/f drift.
4. Hold the finished line at least 36 f + 6 f per word (a 5-word line 66 f, 1.1 s).
5. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 4.5, "gain_db": -18}` on each chunk's beat, or none.

Fallback: Title words enter on the track's pulse by timing only; the overflow-hidden line mask is not exact, so use the kinetic title's rise.

## Timing & taste rules

- cinetic's timing (60 fps): One beat per chunk (30 f (0.50 s) at 120 BPM); 4 f (0.07 s) word stagger inside a chunk; masked rise 6-8 f (0.13 s) ease_out_expo, stretched to 10-12 f (0.20 s) for words over 60 px tall so legible glyphs stay under 20 px/f; calm variant 20-22 f (0.37 s) per word.
- One beat per chunk (30 f, 0.5 s at 120 BPM); 4 f (0.067 s) word stagger inside a chunk.
- Masked rise 6-8 f (0.1-0.13 s), stretched to 10-12 f (0.17-0.2 s) for words over 60 px tall so glyphs stay under 20 px/f.
- Calm variant: 20-22 f (0.33-0.37 s) per word, blur from 8 px across 18 f.
- Hold the line at least 36 f + 6 f per word.

## Sound for it

Soft ui_tap or pop at -18 dB on each chunk's beat; the music supplies the pulse.

## Common mistakes

- No music or a free-time score: the chunks have no grid to lock to.
- Sentences of more than 8 words.
- Starting the chunk on the beat instead of half a rise before it.
- Avoid when: No music or a free-time score, and sentences of more than 8 words.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ps-beat-quantized-chunks`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
