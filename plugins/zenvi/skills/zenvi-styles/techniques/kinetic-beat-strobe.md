---
id: kinetic-beat-strobe
kind: technique
summary: "When type should hit like the drums: one word per beat or half beat, card colours flipping, lockup at the end."
categories: [kinetic-type-motion-design, gaming-montage, sports-hype-edit, video-essay-explainer, tech-review, documentary-true-story, fitness-lifestyle]
tools: [detect_beats_tool, add_kinetic_title_tool, trim_clip_tool, add_sfx_tool, auto_sound_design_tool]
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
Beat times from `detect_beats_tool` (or a grid: 150 bpm = 0.4 s per beat). One title per word:
```json
add_kinetic_title_tool {"text": "FAST", "style": "stack", "animation": "slam", "emphasis": "none", "text_size": 0.3,
  "ink": "#ffffff", "background": "#000000", "y": 0.5, "position_seconds": 0.2, "duration_seconds": 0.4}
add_kinetic_title_tool {"text": "LOUD", "style": "stack", "animation": "slam", "emphasis": "none", "text_size": 0.3,
  "ink": "#000000", "background": "#ffffff", "y": 0.5, "position_seconds": 0.6, "duration_seconds": 0.4}
add_kinetic_title_tool {"text": "BOLD", "style": "stack", "animation": "slam", "emphasis": "none", "text_size": 0.3,
  "ink": "#ffffff", "background": "#e5202e", "y": 0.5, "position_seconds": 1.0, "duration_seconds": 0.4}
add_sfx_tool {"recipe": "hit_transient", "at_seconds": 0.2, "gain_db": -14, "seed": 1}
```
And so on, one word and one `hit_transient` (new `seed`) per beat; the last word (NOW) gets `duration_seconds: 1.6`
and an `impact_slam`.
A title lasts at least 0.4 s (`duration_seconds` min): for 3-11 frame holds place them at 0.4 s and cut each one's clips
back with `trim_clip_tool` (`edge: "end"`, `at_seconds`) — do not overlap them, a later title can land on a lower track.
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
2026-10-28, CLI (`zenvi call`, this branch) on Pexels bench footage / generated media: `scripts/kinetic-beat-strobe.sh` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/skk-kinetic/`, local only) → `techniques/kinetic-beat-strobe.mp4` and its contact sheet. Checked on the sheet: seven words, one per 0.4 s beat of the generated 150 bpm bed, grounds flipping black/white/red, NOW holds; the 0.234 s version failed (title minimum 0.4 s). Watch judge (absolute, isolated 3-5 s test): **4.1/10** overall, typography 4; its main note: "The sequence ends abruptly on a single static word without resolving into a cohesive final lockup.".
