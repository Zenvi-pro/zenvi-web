---
id: kcut-assemble
kind: technique
summary: "When a name or mark should build itself: particles spiral in from the frame and assemble into the word."
categories: [kinetic-type-motion-design, product-launch-film, saas-app-launch, brand-story-corporate, map-data-explainer, tech-review, sports-hype-edit]
tools: [add_motion_block_tool]
pace: medium
mood: [premium, magical, confident]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kcut-flood-climax, kcut-hit-fx]
avoid_with: [kcut-strobe-cards]
needs: [logo-path-particles]
---

# Particle assemble

## What it is
Up to ~900 particles sampled from the word's own pixels spiral in from far out (each over ~1 s after a seeded delay, 22 % in the accent) and land on the letters; the solid word fades in over them at 1.0-1.35 s. The climax or the name reveal.

## Build it in Zenvi
One `kinetic_cut_scene` storyboard line per shot (grammar in `styles/kinetic-cut.md`):
```json
add_motion_block_tool {"block": "kinetic_cut_scene", "placement": "full_frame", "duration_seconds": 6,
  "params": {"bpm": 120, "shots": [
    "4 assemble VOLTA 2 | the charge, made visible #light +rings !"]}}
```
Needs ≥ 1.2 s (4 beats at 120+). A logo: there is no SVG-path input yet (`needs: logo-path-particles`) — use the wordmark, or `logo_build` / `ripple_logo` for marks.

## Timing & taste rules
- Once per piece, on the name or the climax.
- Light grounds read the particles best; on dark use `+blobs` behind.
- Hold the solid word ≥ 1 s after it lands.

## Sound for it
The block cues a reveal at +1.0 s (the landing): a riser into it, a sub drop on it.

## Common mistakes
- A shot of 2 beats or less: the word never lands.
- Long lines (particles thin out): one or two words.

## Verified
2026-10-29, CLI (`zenvi call`, this branch) on the block alone with a generated 6 s bed: `scripts/kcut-verify.sh kcut-assemble` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/x1-ext-skills/`, local only) → `techniques/kcut-assemble.mp4` and its sheet. Checked on the sheet: the shockwave, particles spiralling in on the light ground, VOLTA 2 solid at ~1.3 s, the accent rule drawing on after. Watch judge (absolute, isolated 6 s test): **4.64/10**; main note: "The particle assembly lacks organic spiraling flow and feels like a simple pre-set implosion followed by an abrupt pop-in of the title."

Adapted from Tweenkit's kinetic-cut-video skill (MIT; see ../NOTICE).
