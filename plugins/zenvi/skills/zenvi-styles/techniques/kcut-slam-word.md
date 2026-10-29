---
id: kcut-slam-word
kind: technique
summary: "When one word must hit on the cut: letters stamp in from 2x with a hard stop, outline echoes ring out."
categories: [kinetic-type-motion-design, product-launch-film, saas-app-launch, brand-story-corporate, map-data-explainer, tech-review, sports-hype-edit]
tools: [add_motion_block_tool]
pace: fast
mood: [bold, aggressive, confident]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kcut-hit-fx, kcut-collapse-cut, kinetic-keyword-slam]
avoid_with: [kinetic-typewriter]
needs: []
---

# Slam word

## What it is
Letters stamp in from 2.1x with an expo hard stop, 50 ms apart, landing ON the cut frame (the fall is over before the cut; after it only the settle), while three accent outline echoes expand and fade. The default kinetic-cut entrance — keep it to a third of the shots.

## Build it in Zenvi
One `kinetic_cut_scene` storyboard line per shot (grammar in `styles/kinetic-cut.md`):
```json
add_motion_block_tool {"block": "kinetic_cut_scene", "placement": "full_frame", "duration_seconds": 6,
  "params": {"bpm": 120, "shots": [
    "2 slam LAUNCH / DAY | 12.03 @bleed +rings",
    "2 slam NOW. @space"]}}
```
`@bleed` crops a huge word by the frame (the poster shot); `@space` makes it small in an empty frame (the breath). Native fallback: `add_kinetic_title_tool {"animation": "slam"}` (see `kinetic-keyword-slam`).

## Timing & taste rules
- The landing is the cut frame: never a slow scale-in before the beat.
- 1-3 words; the main word 60-95 % of the width or cropped on purpose.
- At most a third of the shots slam; alternate with type, mask, assemble, flip.

## Sound for it
An impact on the cut (`impact_slam` for the hero, `hit_transient` -14 dB for the others, a new seed each).

## Common mistakes
- Every title a slam (the piece goes flat).
- Long words at 2x overflow the frame for the first frames: use `@bleed` on purpose or a shorter word.

## Verified
2026-10-29, CLI (`zenvi call`, this branch) on the block alone with a generated 6 s bed: `scripts/kcut-verify.sh kcut-slam-word` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/x1-ext-skills/`, local only) → `techniques/kcut-slam-word.mp4` and its sheet. Checked on the sheet: LAUNCH DAY stamps in cropped by the frame with outline echoes; NOW. sits small in an empty frame (the breath, deliberately static: the judge reads it as dead air in isolation). Watch judge (absolute, isolated 6 s test): **4.27/10**; main note: "The video immediately drops into nearly five seconds of dead air with a tiny static 'NOW.' in the corner while looping audio plays."

Adapted from Tweenkit's kinetic-cut-video skill (MIT; see ../NOTICE).
