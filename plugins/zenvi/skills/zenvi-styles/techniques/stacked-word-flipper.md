---
id: stacked-word-flipper
kind: technique
summary: "For taglines and end cards: one word of a line flips through a stacked list, neighbours faded, landing on the last word."
categories: [kinetic-type-motion-design]
tools: [add_motion_block_tool, list_motion_blocks_tool, add_clip_to_timeline_tool, add_sfx_tool]
pace: medium
mood: [clean, confident, modern]
aspect: ["9:16", "16:9", "1:1"]
pairs_with: [beat-locked-kinetic-type-cuts, grid-cell-reflow-and-collapse, prompt-bar-typing-hero]
avoid_with: [commentary-hits-with-dense-designed-cues, tiled-video-wall]
needs: [cylinder-text-wheel]
---

# Stacked word flipper

## What it is
Three stacked words: the centre one at full opacity, its neighbours at about
20 %, the column flipping every 1-2 beats until it lands on the last word
("made for runners / riders / skaters / you"). Brand reels and end cards use
it; some swap a word for an icon for 3-5 frames before settling.

## Build it in Zenvi
```json
add_clip_to_timeline_tool {"file_id": "<solid ground plate>", "position_seconds": 0, "start_seconds": 0, "end_seconds": 6.5}
add_motion_block_tool {"block": "word_rotator", "position_seconds": 0, "duration_seconds": 6.5,
  "params": {"prefix": "made for", "words": ["runners", "riders", "skaters", "climbers", "you"], "style": "slot",
             "palette": "night", "accent": "#6a7cff", "size": 170, "display_font": "display", "exit": false}}
add_sfx_tool {"recipe": "ui_tap", "at_seconds": <each flip>, "gain_db": -15, "pitch": <i>, "seed": <i>}
add_sfx_tool {"recipe": "impact_thud", "at_seconds": <landing>, "gain_db": -8}
```
- `style: "slot"` is the stacked column with faded neighbours; `flip` rolls
  each word out (the default on 9:16).
- The words share the block's length: 5 words in 6.5 s flip about every 1.1 s.
  Tick at the flips you see in a preview; the block has no per-flip times.
- A solid plate behind it (a generated colour clip) keeps the ground clean;
  `gradient_field` orbs left a white glow behind the type in pass 1.
- A 3D drum of words with depth blur is `cylinder-text-wheel` (missing).

## Timing & taste rules
- 3-5 words, last one the payoff ("you", the product name).
- Flip every 1-2 beats; hold the last word 1.5 s.
- Size 150-170 px at 1080 on 9:16; the default fits the safe width and reads
  small next to the prefix.

## Sound for it
A tick per flip, pitch-walked up, varied seeds; a distinct low thud (+ a soft
sub) on the landing word so the ending reads as an ending.

## Common mistakes
- The same tick for the landing (pass 1 judge: "anti-climactic").
- Neighbour words bleeding into the frame after the landing: end the block
  1 s after the last flip.

## Verified
2026-10-29: 6-6.5 s 9:16 tests. Pass 1 (gradient ground, default size, same
tick on landing): 4.36. Pass 2 (navy plate, size 170, display face, thud + sub
on "you"): 5.45; the judge wants a snappier ease with a small overshoot.
