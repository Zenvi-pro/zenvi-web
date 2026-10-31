---
id: kcut-count-up
kind: technique
summary: "When a number is the claim: it rolls up with its decimals and grouping, data bars rising beside it."
categories: [kinetic-type-motion-design, product-launch-film, saas-app-launch, brand-story-corporate, map-data-explainer, tech-review, sports-hype-edit]
tools: [add_motion_block_tool]
pace: medium
mood: [confident, factual]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kcut-draw-on, kinetic-counter]
avoid_with: [kcut-strobe-cards]
needs: []
---

# Count-up stat

## What it is
The first number in the line rolls from 0 (cubic-out over 70 % of the shot, decimals and thousands separators kept, sized for its final value so the layout never jumps), with tick cues while it counts; `+bars` raises a staggered chart with one accent bar. The data-highlight shot.

## Build it in Zenvi
One `kinetic_cut_scene` storyboard line per shot (grammar in `styles/kinetic-cut.md`):
```json
add_motion_block_tool {"block": "kinetic_cut_scene", "placement": "full_frame", "duration_seconds": 6,
  "params": {"bpm": 140, "shots": [
    "4 count 41% | of rides replaced a car @right #secondary +bars",
    "4 count 3,412,908 | rides in one year +routes"]}}
```
Several steps (51 → 79 → 70) or an odometer: the `counter` block (`kinetic-counter`).

## Timing & taste rules
- 4 beats at least: the count needs ~1.5 s to read and 0.5 s held.
- Only numbers the person gave; units in the line (`km`, `%`), context in the sub line.
- After it lands keep something moving (bars breathe, the drift) or `review_render_tool` flags a still shot.

## Sound for it
The block cues a tick run (14/s) while counting: ticks 12-20 dB under the hero, a hit when it lands.

## Common mistakes
- Counting a year (0 → 2026 reads silly): slam years.
- `@bleed` on a count (the first digit is cropped).

## Verified
2026-10-29, CLI (`zenvi call`, this branch) on the block alone with a generated 6 s bed: `scripts/kcut-verify.sh kcut-count-up` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/x1-ext-skills/`, local only) → `techniques/kcut-count-up.mp4` and its sheet. Checked on the sheet: 41 % rolls up on the secondary ground with the bars rising; 3,412,908 counts with grouping kept and holds. Watch judge (absolute, isolated 6 s test): **5/10**; main note: "The hard cut between two completely different visual styles (flat blue cartoon graph to high-tech dark sci-fi UI) feels jarring and disjointed."

Adapted from Tweenkit's kinetic-cut-video skill (MIT; see ../NOTICE).
