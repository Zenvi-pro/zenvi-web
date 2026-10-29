---
id: shot-glitch-tear-cut
kind: technique
summary: "When a state must jump with digital violence: a hard cut hidden inside horizontal slice tearing, RGB split and static."
categories: [tech-review, saas-app-launch, gaming-montage, movie-game-trailer, science-curiosity]
tools: [add_clip_to_timeline_tool, apply_fx_tool, apply_motion_transition_tool, add_sfx_tool]
pace: fast
mood: [aggressive, digital, unstable]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kcut-hit-fx, cinematic-silence-before-hit, kinetic-scramble-decode]
avoid_with: [shot-hidden-cut-masks, shot-ink-bleed-reveal, cinematic-whip-cut, shot-paparazzi-flash-crops]
needs: [glitch-strip-displace]
---

# Glitch tear cut

## What it is
The page is cut into horizontal bands that jitter sideways at high speed with two single-colour ghosts, and the hard cut to
page B happens while the shaking is at full amplitude. Bands, never chunks: the page stays whole and fast. For "went live",
a version switch, a violent change of state.

## Build it in Zenvi
1. The two scenes back to back on one track, e.g. `add_clip_to_timeline_tool {"file_id": "<A>", "start_seconds": 1, "duration_seconds": 2.4,
   "position_seconds": 0, "track": "1"}` and B at 2.4 s.
2. Tearing and split in a window of 0.5 s either side of the cut (the clip is re-rendered with ffmpeg; windows are seconds from the clip start):
   `apply_fx_tool {"clip_id": "<A>", "effects": [{"effect": "glitch", "amount": 1, "params": {"rate": 12, "seed": 11}, "start": 1.9, "end": 2.4},
   {"effect": "chromatic_aberration", "amount": 0.9, "start": 1.9, "end": 2.4}]}` and for B `"seed": 23, "start": 0, "end": 0.5`.
3. The cut itself: `apply_motion_transition_tool {"preset": "glitch", "clip1_id": "<A>", "clip2_id": "<B>", "duration": 0.2, "intensity": 2}`.
4. `add_sfx_tool {"recipe": "glitch_burst", "at_seconds": 2.4, "gain_db": -12, "seed": 3}`.
5. A small precursor (the viewer feels it before it tears): an extra `glitch` window of 0.07 s at `rate: 4`, `amount: 0.3` about 0.8 s before the cut.

## Timing & taste rules
- Card timing: precursor f30, full amplitude f44-54, cut hidden at f54, 6 f of decay to f60; rise out-cubic, decay linear.
- Amplitude readable: +-70 px at 1080 on the heavily torn bands (about 3 in 10 at full, 2 in 10 still, the rest light); +-12 px ghosts
  in the image's two accent colours; light only on the strongest bands, otherwise it looks like lined paper.
- Cut at exposure peak (+28 % then +12 %) and a 1.6 % punch for 6 f; no cut on a still frame, it loses the cover.
- Everything is removed from frame 60 on: a leftover filter ruins stillness.
- 40 f of calm before and after; keep the page's own after-effects (numbers, counts) in the picture, not in the tear.
- Pair it with no other high-energy cut in the same stretch (whip, crash zoom).

## Sound for it
`glitch_burst` (-12 dB) on the cut, a `static` hiss (-30 dB) under the tear; no whoosh.

## Common mistakes
- Chunks or blocks: the glitch FX and preset also add small blocks. The card calls for whole bands only (blocks read as a
  page being destroyed, bands as a page moving fast); keep `amount` below 1 on the preset and rely on the FX window for the
  slices (`needs: glitch-strip-displace`).
- Footage pairs from different worlds: the judge penalised the grade clash; pick shots with the same subject or look.
- Transparent bands over the full page (ghosting); the page must be opaque.

## Verified
2026-10-29, CLI on bench footage (`pexels_38496193` to `pexels_9057559`): scripts/shot-glitch-tear-cut.sh → shots/shot-glitch-tear-cut.mp4 (local only). Checked on the sheet: bands torn sideways with RGB split on both sides of the cut and the cut inside them; a first version (windows of 0.35 s, amount 0.85) was too weak. Watch judge (absolute): **3.18/10**; main note: "the visual execution uses a soft mosaic block pixelation instead of high-frequency slice tearing ... the two shots have completely discordant palettes".

Adapted from video-shotcraft card `shots/transition/tear-streak-transitions.md` (Apache-2.0; see ../NOTICE).
