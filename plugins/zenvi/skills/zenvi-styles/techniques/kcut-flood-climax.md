---
id: kcut-flood-climax
kind: technique
summary: "When the heaviest moment must look different from all the rest: flood the frame light, inverted or accent."
categories: [kinetic-type-motion-design, product-launch-film, saas-app-launch, brand-story-corporate, map-data-explainer, tech-review, sports-hype-edit]
tools: [add_motion_block_tool]
pace: fast
mood: [bold, climactic]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kcut-assemble, kcut-hit-fx, kcut-collapse-cut]
avoid_with: [cinematic-teal-orange]
needs: []
---

# Flood climax

## What it is
The value rhythm: the piece sits on one ground and the climax (`!`) floods the frame with a ground no other shot used — paper after dark, the accent after neutrals, or `@split` with the type inverted across two grounds — with the heaviest hit and a shake. Without it the biggest moment looks like every other.

## Build it in Zenvi
One `kinetic_cut_scene` storyboard line per shot (grammar in `styles/kinetic-cut.md`):
```json
add_motion_block_tool {"block": "kinetic_cut_scene", "placement": "full_frame", "duration_seconds": 6,
  "params": {"bpm": 140, "shots": [
    "2 slam ONE LOOP | one city @split #accent +rings !"]}}
```
`#light` / `#accent` / `#secondary` on the climax line only; one other light or accent shot earlier is fine (the rhythm), the climax ground must still be its own.

## Timing & taste rules
- Exactly one `!`; its ground unique in the piece.
- Change scale too (`@bleed`, or a tiny word in `@space`) — break the system, not just the colour.
- A 1-beat gap or a riser before it.

## Sound for it
The sub drop and the hero impact here only (sub -3…-6 dB, tail -8…-14 dB).

## Common mistakes
- Every third shot on the accent (no break left).
- A flood climax the length of a cut: give it 4 beats.

## Verified
2026-10-29, CLI (`zenvi call`, this branch) on the block alone with a generated 6 s bed: `scripts/kcut-verify.sh kcut-flood-climax` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/x1-ext-skills/`, local only) → `techniques/kcut-flood-climax.mp4` and its sheet. Checked on the sheet: ONE LOOP on a split accent / light ground with the type inverted across it, the heaviest hit and a shake (a climax needs the shots before it: isolated it scores low). Watch judge (absolute, isolated 6 s test): **3.45/10**; main note: "The movement is minimal with just subtle camera shake, tiny floating debris, and a generic underline animation that fails to deliver any real technique execution."

Adapted from Tweenkit's kinetic-cut-video skill (MIT; see ../NOTICE).
