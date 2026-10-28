---
id: kinetic-type-morph
kind: technique
summary: "When a three-beat promise should flow: one word melts into the next, letter outlines morphing left to right."
categories: [kinetic-type-motion-design, brand-story-corporate, saas-app-launch, fashion-beauty-ad, product-launch-film]
tools: [add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [fluid, premium, calm]
aspect: ["16:9", "1:1", "9:16"]
pairs_with: [kinetic-letter-swap, kinetic-word-rotator, kinetic-quote-card]
avoid_with: [kinetic-beat-strobe, kinetic-keyword-slam, kinetic-scramble-decode]
needs: []
---

# Type morph

## What it is
"make → shape → move": the letters of one word flow into the next word's letters in a left-to-right sweep, splitting and
merging as the letter counts differ. Brand promises, before/after words, a calm alternative to a word rotator.

## Build it in Zenvi
```json
add_motion_block_tool {"block": "gradient_field", "position_seconds": 0, "duration_seconds": 4.5, "params": {"palette": "cream"}}
add_motion_block_tool {"block": "type_morph", "position_seconds": 0, "duration_seconds": 4.5,
  "params": {"words": ["make", "shape", "move"], "palette": "cream", "display_font": "display"}}
add_sfx_tool {"recipe": "swish_airy", "at_seconds": 1.5}
```
`beat` (s per word) locks the morphs to the music; `style: "outline"` gives the outlined variant. Transparent: put it
over a backdrop block or calm footage.

## Timing & taste rules
- 3 words (2-4); each word holds ≥ 0.6 s fully formed before it morphs.
- Morph 0.5-0.8 s; on a 120 bpm edit, one word per 2 beats.
- Short words of similar length morph cleanly; very different lengths blob in the middle frames.
- One face, one size; colour from the palette's ink or accent.

## Sound for it
An airy swish per morph (-14 dB), or nothing over music; no hits (it is fluid, not punchy).

## Common mistakes
- Using it for words the viewer must read quickly (mid-morph frames are illegible).
- `weight: 800` with the sans face hung one render on 2026-10-28 (killed after 4 min): use `display_font: "display"`
  or the default weight.

## Verified
VERIFIED:kinetic-type-morph
