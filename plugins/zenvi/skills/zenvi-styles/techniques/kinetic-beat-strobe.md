---
id: kinetic-beat-strobe
kind: technique
summary: "When type should hit like the drums: one word per beat or half beat, card colours flipping, lockup at the end."
categories: [kinetic-type-motion-design, gaming-montage, sports-hype-edit, video-essay-explainer, tech-review, documentary-true-story, fitness-lifestyle]
tools: [detect_beats_tool, add_kinetic_title_tool, add_sfx_tool, auto_sound_design_tool]
pace: frantic
mood: [hype, aggressive, rhythmic]
aspect: ["9:16", "16:9", "1:1"]
pairs_with: [kinetic-keyword-slam, kinetic-echo-stack, kinetic-text-on-path]
avoid_with: [kinetic-quote-card, kinetic-write-on, kinetic-title-sequence, kinetic-type-morph]
needs: [type-strobe-sequencer, typographic-layout-variants]
---

# Beat-locked word strobe

## What it is
Words hard-cut on beats or vocal hits — every 3-12 frames — each on a full-bleed ground that flips (black / white /
accent) with the ink inverted, ending on a held lockup. Also the slower staccato keyword list (4-5 words at ~0.8 s over
B-roll, a thump each).

## Build it in Zenvi
Beat times from `detect_beats_tool` (or a grid: 128 bpm = 0.469 s per beat, half beat 0.234 s). One title per word:
```json
add_kinetic_title_tool {"text": "FAST", "style": "stack", "animation": "slam", "emphasis": "none", "text_size": 0.3,
  "ink": "#ffffff", "background": "#000000", "y": 0.5, "position_seconds": 0.2, "duration_seconds": 0.234}
add_kinetic_title_tool {"text": "LOUD", … "ink": "#000000", "background": "#ffffff", "position_seconds": 0.434, …}
add_kinetic_title_tool {"text": "BOLD", … "ink": "#ffffff", "background": "#e5202e", "position_seconds": 0.668, …}
… last word "NOW" with "duration_seconds": 1.6
add_sfx_tool {"recipe": "hit_transient", "at_seconds": <each word>, "gain_db": -14, "seed": <i>}   and impact_slam on the last
```
No sequencer for mirrored/cropped full-bleed layout variants yet (`needs: type-strobe-sequencer`,
`typographic-layout-variants`): vary `text_size`, `y` and the ground by hand, 3-4 layouts at most.

## Timing & taste rules
- 7-12 frames per word for reading words; 3-6 frames only for repeats of a word already read.
- Changes on percussive hits (kick/snare/vocal) — 64 % of the best type cuts land on onsets, not the bare grid.
- 2-3 grounds total (ink, paper, one accent) with one inversion rule.
- End with a lockup held ≥ 1.5 s, or a hard stop with the music.

## Sound for it
If the music has the hits, let it; otherwise a transient per word (-14 dB, varied seeds) and a layered slam on the
lockup. Never a whoosh per word.

## Common mistakes
- Words shorter than 7 frames that the viewer has not read before (illegible).
- Four or more colours (the strobe turns into noise).
- No lockup: 7 of 20 reference reels end abruptly and score lower.

## Verified
VERIFIED:kinetic-beat-strobe
