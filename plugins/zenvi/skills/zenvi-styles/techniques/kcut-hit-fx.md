---
id: kcut-hit-fx
kind: technique
summary: "When every cut must land like a hit: camera punch, shake, chromatic kick, flash and bloom pulse on the beat."
categories: [kinetic-type-motion-design, product-launch-film, saas-app-launch, brand-story-corporate, map-data-explainer, tech-review, sports-hype-edit]
tools: [add_motion_block_tool, update_motion_block_tool, auto_sound_design_tool]
pace: fast
mood: [energetic, punchy]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kcut-slam-word, kcut-strobe-cards, kcut-flood-climax]
avoid_with: [cinematic-j-l-cut, kinetic-quote-card]
needs: []
---

# Hit FX on every cut

## What it is
Every cut of a `kinetic_cut_scene` is a hit: the frame punches in (3.5-8 % decaying over ~0.4 s), a climax hit (`!`) shakes (20 px at 1080, decaying in ~0.3 s), red and green split out from the centre and fall back, an additive flash of a few frames and a bloom pulse. Motion blur is the average of sub-frames inside the shot, so a cut stays a cut. The engine of the kinetic-cut style; it shines on launches, intros and hype openers.

## Build it in Zenvi
One `kinetic_cut_scene` storyboard line per shot (grammar in `styles/kinetic-cut.md`):
```json
add_motion_block_tool {"block": "kinetic_cut_scene", "placement": "full_frame", "duration_seconds": 6,
  "params": {"bpm": 120, "look": "punchy", "shutter_samples": 8, "shots": [
    "2 slam BUILT / TO HIT +rings",
    "1 stretch FAST #light",
    "2 slam HARD ! #accent"]}}
```
`look` sets how hard: `clean` (punch 3.5 %, no resting aberration, flash 0.15), `punchy` (5 %, 0.3), `wild` (8 %, heavy aberration, 0.45). The same hits on a DOM block: the runtime's `hitTrack(el, hits)` (block authors).

## Timing & taste rules
- A hit per cut (strength 1), half strength on off-beat strobe words, 1.35 + shake on the ONE climax.
- `clean` for education, corporate, premium; `wild` for gaming, sports, music; never `wild` under small text.
- Bloom follows the ground (dark 0.5, accent 0.13, light 0.08): light grounds stay clean.
- `shutter_samples` 6 (default); 10-16 only for very fast flings (renders that many times slower); `draft` renders 1.

## Sound for it
The block cues an impact (or a whoosh for `stretch`/`flip`/`+rays`) at every cut: `auto_sound_design_tool {"genre": "hype", "density": "every_cut"}`. Hero hits 0 to +3 LU over the bed; sub drop only on the climax.

## Common mistakes
- The same flash and punch on every cut with nothing else changing: vary grounds, layouts and entrances, the FX are punctuation.
- Shaking every hit (reads as a glitch); shake the climax only.
- Flashes on a light ground (washes out); the flash is additive.

## Verified
2026-10-29, CLI (`zenvi call`, this branch) on the block alone with a generated 6 s bed: `scripts/kcut-verify.sh kcut-hit-fx` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/x1-ext-skills/`, local only) → `techniques/kcut-hit-fx.mp4` and its sheet. Checked on the sheet: three shots on the 120 bpm grid, each cut punching in with a red/green split and a flash; the HARD climax shakes and holds on the accent. Watch judge (absolute, isolated 6 s test): **7.18/10**; main note: "The sequence ends quite abruptly on the word 'HARD' without a complete resolution or final visual payoff."

Adapted from Tweenkit's kinetic-cut-video skill (MIT; see ../NOTICE).
