---
id: kcut-strobe-cards
kind: technique
summary: "When a list must fly past on the beat: one word per half beat, the ground flipping at most three times a second."
categories: [kinetic-type-motion-design, product-launch-film, saas-app-launch, brand-story-corporate, map-data-explainer, tech-review, sports-hype-edit]
tools: [add_motion_block_tool, detect_beats_tool]
pace: frantic
mood: [hype, rhythmic]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kcut-hit-fx, kinetic-beat-strobe]
avoid_with: [kinetic-quote-card, kinetic-typewriter]
needs: []
---

# Strobe cards

## What it is
A run of words, one per half beat (or per beat when a half beat would leave a word under 0.3 s), each scaling 1.28 → 1 with a half-strength hit and a swap cue; the ground cycles dark / light / accent with the words when each lasts ≥ 1/3 s, else stays. Steps, features, a manifesto in four words.

## Build it in Zenvi
One `kinetic_cut_scene` storyboard line per shot (grammar in `styles/kinetic-cut.md`):
```json
add_motion_block_tool {"block": "kinetic_cut_scene", "placement": "full_frame", "duration_seconds": 6,
  "params": {"bpm": 140, "shots": [
    "4 strobe EVERY DAY EVERY DOCK",
    "2 strobe NO GAS NO NOISE #light"]}}
```
Native fallback with one title per word: `kinetic-beat-strobe`.

## Timing & taste rules
- 3-6 words, short; the run lasts 2-4 beats, before the climax.
- Ground flips and hit flashes ≤ 3 a second (WCAG 2.3.1; the block enforces both: faster hits punch without a flash).
- A word held < 7 frames must have been read before (a repeat).

## Sound for it
A tick or a light hit per word (`hit_transient` -16 dB, seeds varied), not a whoosh per word; the music's hats often do it alone.

## Common mistakes
- Ten words in a run (noise).
- A strobe run as the climax: it is the speed-up; the climax breaks the system after it.

## Verified
2026-10-29, CLI (`zenvi call`, this branch) on the block alone with a generated 6 s bed: `scripts/kcut-verify.sh kcut-strobe-cards` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/x1-ext-skills/`, local only) → `techniques/kcut-strobe-cards.mp4` and its sheet. Checked on the sheet: EVERY DAY EVERY DOCK then NO GAS NO NOISE, a word per beat, grounds cycling dark / light / accent at under 3 flips a second. Watch judge (absolute, isolated 6 s test): **5.27/10**; main note: "The background color flips feel repetitive and the final word 'NOISE' stalls across multiple frames without payoff."

Adapted from Tweenkit's kinetic-cut-video skill (MIT; see ../NOTICE).
