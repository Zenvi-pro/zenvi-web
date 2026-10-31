---
id: cin-ty-inplace-light-up-beats
kind: technique
summary: "When a calm line should read on the beat: the finished line is laid out and its words light up in place."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, add_sfx_tool]
pace: calm
mood: [quiet, musical]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [shot-blur-slide, cin-ty-reading-order-exit]
avoid_with: [kinetic-word-pop, cin-ty-kinetic-word-slams]
needs: [per-word-cue-times]
drawn: cinetic
---

# In-place word light-up on beats

cinetic `ty-inplace-light-up-beats` · Typography in motion · workhorse · energy calm · formats launch, feature, walkthrough, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The finished line is laid out from the start and its words light up in place, chunk by chunk on the beat, with the last word held back.

Use when: Titles and walkthrough captions over a moving camera; lines with an inline glyph or partner wordmark that must not shift; music-led films where each chunk can sit on a beat.

## Build it in Zenvi

1. `add_kinetic_title_tool {"text": "Software that finally keeps up", "style": "documentary", "animation": "fade", "stagger_seconds": 0.4, "emphasis": ["finally"], "ink": "#f4f1ea", "text_size": 0.064, "y": 0.5, "position_seconds": 1.0, "duration_seconds": 4.2}` for the title: the line is laid out whole, each word fades in where it will stay, one word per beat at 24 f (0.4 s).
2. For later captions in the same film use the same call with `"stagger_seconds": 0.1` (6 f): viewers have learned the pattern, so the stagger shrinks from 24 f on the title to about 5-6 f.
3. Hold the last word back by splitting the call: line one as above, then the qualifier as its own `add_kinetic_title_tool {"text": "...", "animation": "fade", "position_seconds": <last chunk + 0.5>, "text_size": 0.04, "y": 0.58}` one beat later, tucked under the right edge at about 0.35x size.
4. Exit all words together: `fade_clip_tool {"clip_id": "<title>", "fade_out_seconds": 0.43}` (26 f).
5. `add_sfx_tool {"recipe": "tail_bloom", "at_seconds": 1.0, "gain_db": -22}` under the first chunk only.

Fallback: Per-word start times on the kinetic title are one value; for chunks that land on separate beats, place each chunk as its own title in its final position (same y, same size) and let them overlap in time.

## Timing & taste rules

- cinetic's timing (60 fps): Attack 5 f (0.08 s) to 0.75, tail 40 f (0.67 s) ease_out_cubic to 1; 6 f (0.10 s) within a chunk, chunks on beats; last token +24-34 f (0.57 s); connectors 0.55 -> 1 over 12 f (0.20 s); title stagger 24 f (0.40 s) shrinking to 5-6 f (0.10 s); exit all words together over 26 f (0.43 s) ease_in_out_sine. If the camera is locked, add a 0.3 px/f line drift.
- Attack 5 f (0.08 s) to 75 % opacity, then a 40 f (0.67 s) ease_out_expo brightening tail to full: fast attack, slow glow.
- Chunks of 2-3 words on beat frames, 6 f (0.1 s) between words inside a chunk; the last word or qualifier a full beat late (+24-34 f, 0.4-0.57 s).
- Connectors sit dimmer (55 %) until the last chunk lands, then rise to full over 12 f (0.2 s); nothing ever reflows.
- Lines over 6 words turn into a slide; if the camera is locked add a 0.3 px/f line drift.

## Sound for it

One very soft tail_bloom under the first chunk; no per-word sound, the music carries the beats.

## Common mistakes

- High-energy acts that need motion in the type itself; this move is calm.
- Lines over 6 words, which read as a slide rather than a beat.
- Keeping the same 24 f stagger all film: shrink it as the pattern is learned.
- Avoid when: High-energy acts that need motion in the type itself; lines over 6 words (it turns into a slide).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ty-inplace-light-up-beats`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
