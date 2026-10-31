---
id: kcut-collapse-cut
kind: technique
summary: "When one shot should be swallowed into the next: squash the frame to a line, cut, burst out with rings."
categories: [kinetic-type-motion-design, product-launch-film, saas-app-launch, brand-story-corporate, map-data-explainer, tech-review, sports-hype-edit]
tools: [add_motion_block_tool]
pace: fast
mood: [energetic, slick]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kcut-hit-fx, kcut-assemble, kcut-slam-word]
avoid_with: [cinematic-j-l-cut]
needs: []
---

# Collapse cut

## What it is
In the last 0.3 s of a shot the whole frame is pressed (cubic-in) into a bright horizontal line; the next shot opens on the cut with a hit and, with `+rings`, a shockwave from the same centre. A motif-free match cut: the line becomes the next shot's horizon, wave or trace.

## Build it in Zenvi
One `kinetic_cut_scene` storyboard line per shot (grammar in `styles/kinetic-cut.md`):
```json
add_motion_block_tool {"block": "kinetic_cut_scene", "placement": "full_frame", "duration_seconds": 6,
  "params": {"bpm": 120, "shots": [
    "1 none +tunnel +collapse",
    "4 assemble VOLTA 2 #light +rings !"]}}
```
Native fallback between two footage clips: `apply_motion_transition_tool` with a squeeze or zoom kind, plus a flash.

## Timing & taste rules
- Once or twice a piece, into the biggest moments (the climax, the end card).
- The collapsing shot is short (1-2 beats) so the squash is a third of it at most.

## Sound for it
A short reverse swell into the cut (`whoosh_rise`), then the impact on the burst.

## Common mistakes
- Collapse on every cut (the trick shows).
- Opening the next shot without a hit: the squash then reads as a fault.

## Verified
2026-10-29, CLI (`zenvi call`, this branch) on the block alone with a generated 6 s bed: `scripts/kcut-verify.sh kcut-collapse-cut` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/x1-ext-skills/`, local only) → `techniques/kcut-collapse-cut.mp4` and its sheet. Checked on the sheet: the tunnel shot squashes to a bright line in its last 0.3 s, the next cut bursts out with the rings and assembles VOLTA 2. Watch judge (absolute, isolated 6 s test): **6/10**; main note: "The transition misses the intended brief's ring burst dynamic, instead snapping abruptly into a static text layout."

Adapted from Tweenkit's kinetic-cut-video skill (MIT; see ../NOTICE).
