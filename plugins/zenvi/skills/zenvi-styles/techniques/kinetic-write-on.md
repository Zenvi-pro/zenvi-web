---
id: kinetic-write-on
kind: technique
summary: "When text should feel handwritten or drawn: strokes write on letter by letter (fallback: serif line wipe)."
categories: [animated-explainer, documentary-true-story, kinetic-type-motion-design, wedding-event-film, food-recipe, fashion-beauty-ad]
tools: [add_motion_block_tool, add_kinetic_title_tool, add_sfx_tool]
pace: calm
mood: [personal, warm, crafted]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-quote-card, kinetic-title-sequence, kinetic-typewriter]
avoid_with: [kinetic-beat-strobe, kinetic-scramble-decode, kinetic-echo-stack]
needs: [svg-path-write-on]
---

# Write-on

## What it is
A trim-path stroke draws each letter as if written (0 → 100 % over 1-3 s, up to 12 s for a long phrase), sometimes after
construction lines. Missing as a tool (`needs: svg-path-write-on`); the fallback is a left-to-right wipe of each line in
the serif face, which reads as "written" at a glance but not up close.

## Build it in Zenvi
Fallback that verifies:
```json
add_motion_block_tool {"block": "kinetic_headline", "position_seconds": 0, "duration_seconds": 4, "placement": "full_frame",
  "params": {"text": "written / by *hand*", "style": "wipe", "emphasis": "serif", "display_font": "serif", "palette": "cream", "max_size": 320}}
add_sfx_tool {"recipe": "paper", "at_seconds": 0.2, "align": "start", "gain_db": -16}
```
Native alternative: `add_kinetic_title_tool {"animation": "typewriter", "style": "editorial"}` (letters appear, no stroke).
A hand face (`font_family: "caveat-brush"` in motion templates) helps sell the fallback.

## Timing & taste rules
- 0.3-0.5 s per short word; the whole phrase ≤ 3 s in a reel.
- One phrase; cream/paper ground and ink, one accent at most.
- Hold the written phrase ≥ 1.5 s.

## Sound for it
Pencil/paper foley under the writing at -16 to -20 dB, stopping with the last stroke.

## Common mistakes
- Writing in a heavy grotesk (a wipe of bold sans is a wipe, not handwriting).
- Selling the fallback as a real write-on in a close-up hero shot: use it at reading size only.

## Verified
VERIFIED:kinetic-write-on
