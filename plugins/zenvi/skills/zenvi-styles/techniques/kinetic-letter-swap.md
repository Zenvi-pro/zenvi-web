---
id: kinetic-letter-swap
kind: technique
summary: "When the word and the picture are the same idea: a letter (or word) is replaced by an image tile of it."
categories: [kinetic-type-motion-design, brand-story-corporate, food-recipe, fashion-beauty-ad, saas-app-launch]
tools: [add_motion_template_tool, add_motion_block_tool, import_files_tool, add_sfx_tool]
pace: medium
mood: [editorial, clever, crafted]
aspect: ["16:9", "1:1", "9:16"]
pairs_with: [kinetic-type-morph, kinetic-mask-reveal, kinetic-scramble-decode]
avoid_with: [kinetic-echo-stack, kinetic-beat-strobe]
needs: []
---

# Letter swap (letter → image tile)

## What it is
A headline lands word by word and one letter (the O of BLOOM) or one word is a rounded image tile of the subject; the
editorial/brand version of "word swapped for icon". Pairs with letters that change (type-morph) for a swap chain.

## Build it in Zenvi
```json
add_motion_template_tool {"template": "grid_background", "variant": "editorial", "labels": ["LILIUM", "FIG. 01", "48°N", "SPECIMEN"],
  "position_seconds": 0, "duration_seconds": 4}
add_motion_template_tool {"template": "kinetic_type", "text": "BL*OM", "file_ids": ["<photo or clip file id>"], "position_seconds": 0,
  "duration_seconds": 4, "font_family": "archivo-black", "palette": "editorial", "bpm": 108, "tag": "NO. 01", "align": "center", "position": "center"}
add_sfx_tool {"recipe": "pop", "at_seconds": 0.3}
```
`*` is the tile; several `*` take `file_ids` in turn. kinetic_type draws no backdrop on its own: put a
`grid_background` (or footage) under it, or the black under it shows. Word → word swaps: kinetic-type-morph.

## Timing & taste rules
- One tile per headline; two at most when they rhyme (B*LD *RT).
- The tile shows the literal noun (a lily for BLOOM); stock that only "sort of" matches reads as clip art.
- Tile lands on a beat (`bpm`/`beats`); hold the finished word ≥ 1.5 s.
- 3-4 corner labels in mono at 1.5-3 %, no more.

## Sound for it
A pop or keyboard key on each swap; the tile's landing gets the one slightly bigger sound.

## Common mistakes
- No backdrop (black frame) or a busy video behind the black ink.
- A tile picture that is too dark to read at letter size: pick a bright, simple frame.
- Swapping a letter that carries the word's shape (first letter): swap an O, A or a vowel in the middle.

## Verified
VERIFIED:kinetic-letter-swap
