---
id: kcut-marquee-bands
kind: technique
summary: "When a keyword or name should fill the frame as texture: outlined rows scrolling on a diagonal, one filled."
categories: [kinetic-type-motion-design, product-launch-film, saas-app-launch, brand-story-corporate, map-data-explainer, tech-review, sports-hype-edit]
tools: [add_motion_block_tool]
pace: fast
mood: [bold, energetic, editorial]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kcut-slam-word, kcut-hit-fx]
avoid_with: [kcut-draw-on]
needs: [marquee-band-styles]
---

# Marquee bands

## What it is
Rows of the shot's word in outline scroll in alternate directions on a -7° diagonal behind the type, the middle row filled with the accent: a manifesto, a recap of keywords, a name as wallpaper.

## Build it in Zenvi
One `kinetic_cut_scene` storyboard line per shot (grammar in `styles/kinetic-cut.md`):
```json
add_motion_block_tool {"block": "kinetic_cut_scene", "placement": "full_frame", "duration_seconds": 6,
  "params": {"bpm": 120, "shots": [
    "2 slam GO | all of it, at once +marquee #dark",
    "2 mask SHIP IT @space +marquee"]}}
```
Three coloured bands collapsing to one, a ticker strip: `needs: marquee-band-styles` (fallback: native titles with `set_keyframes_tool` x scrolls).

## Timing & taste rules
- One or two marquee shots a piece; short words (3-6 letters) tile best.
- Keep the hero word on top big and solid, or it drowns in its own texture.

## Sound for it
A whoosh on the cut, nothing per row.

## Common mistakes
- Long sentences in the rows (illegible, heavy to render).
- A marquee on a light ground with thin outlines (vanishes).

## Verified
2026-10-29, CLI (`zenvi call`, this branch) on the block alone with a generated 6 s bed: `scripts/kcut-verify.sh kcut-marquee-bands` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/x1-ext-skills/`, local only) → `techniques/kcut-marquee-bands.mp4` and its sheet. Checked on the sheet: GO slams over outlined GO rows scrolling on a diagonal, the middle row filled; SHIP IT small in the corner over the bands. Watch judge (absolute, isolated 6 s test): **5.36/10**; main note: "After the first second, the piece stalls entirely, holding on a repetitive scrolling loop of 'SHIP IT' with no further development or dynamic camera movement."

Adapted from Tweenkit's kinetic-cut-video skill (MIT; see ../NOTICE).
