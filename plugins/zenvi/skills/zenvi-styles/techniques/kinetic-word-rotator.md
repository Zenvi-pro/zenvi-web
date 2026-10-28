---
id: kinetic-word-rotator
kind: technique
summary: "When a tagline has a slot (Made for ___): the last word cycles through a list and lands on the final one."
categories: [saas-app-launch, kinetic-type-motion-design, brand-story-corporate, product-launch-film, ugc-ad-testimonial]
tools: [add_motion_block_tool, add_motion_template_tool, add_sfx_tool]
pace: medium
mood: [confident, inclusive, upbeat]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-emphasis-scale, kinetic-type-morph, kinetic-mask-reveal]
avoid_with: [kinetic-word-pop, kinetic-beat-strobe]
needs: []
---

# Rotating word list

## What it is
A fixed prefix with one word that cycles: a slot column with the neighbours faded above and below (the stacked word
flipper: centre 100 %, neighbours ~20 %), or words that flip in and out. The tagline/end-card move of launch reels.

## Build it in Zenvi
```json
add_motion_block_tool {"block": "word_rotator", "position_seconds": 0, "duration_seconds": 5,
  "params": {"prefix": "Made for", "words": ["writers", "editors", "night owls", "you"], "style": "slot",
             "palette": "dark", "display_font": "sans", "accent": "#7cf29a", "size": 130}}
add_sfx_tool {"recipe": "ui_tap", "at_seconds": 1.2, "gain_db": -16}   (one per word change)
```
On 9:16 `style: "auto"` flips and stacks prefix/word. A big column of words with a selection box:
`add_motion_template_tool {"template": "word_scroll", "words": [...]}`. A 3D drum is `needs: cylinder-text-wheel`.

## Timing & taste rules
- 3-5 words; each holds 1-2 beats (0.5-1 s), the last holds ≥ 1.5 s.
- The last word is the payoff ("you", the product name) — usually the accent.
- Words of similar length keep the line from jumping (the block re-centres, but less jump reads better).
- `size` ≥ 110 px at 1080: the default fit is small on short lines.

## Sound for it
A soft tick per change (-16 to -20 dB), a slightly bigger tap or chime on the last word.

## Common mistakes
- Too many words (> 5): nobody reads them.
- Rotating the claim instead of the audience/use case.

## Verified
VERIFIED:kinetic-word-rotator
