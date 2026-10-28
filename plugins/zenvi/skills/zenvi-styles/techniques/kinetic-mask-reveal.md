---
id: kinetic-mask-reveal
kind: technique
summary: "When a headline should feel designed, not animated: words rise out of a line mask or wipe on left to right."
categories: [brand-story-corporate, saas-app-launch, product-launch-film, fashion-beauty-ad, automotive-ad, kinetic-type-motion-design, travel-cinematic-montage]
tools: [add_motion_block_tool, add_kinetic_title_tool, add_sfx_tool]
pace: medium
mood: [premium, confident, editorial]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-letter-cascade, kinetic-quote-card, kinetic-lower-third, kinetic-3d-title]
avoid_with: [kinetic-beat-strobe, kinetic-echo-stack, kinetic-word-pop]
needs: []
---

# Mask / wipe reveal

## What it is
Each word slides up out of an invisible line mask (clipped at its baseline), or each line is wiped on left to right.
The calm premium headline of launch films and car ads, with one word in a serif italic or the condensed face.

## Build it in Zenvi
```json
add_motion_block_tool {"block": "kinetic_headline", "position_seconds": 0.2, "duration_seconds": 3.6,
  "params": {"text": "every frame / *earns* its place", "style": "rise", "emphasis": "serif", "display_font": "sans",
             "palette": "dark", "accent": "#f2c14e", "max_size": 170}}
add_sfx_tool {"recipe": "swish_airy", "at_seconds": 0.45, "gain_db": -14}
```
`style: "wipe"` reveals lines left to right; `"blur"` focuses in. Native fallback without headless Chrome:
`add_kinetic_title_tool {"style": "editorial", "animation": "rise"}` (rise is a soft rise + fade, not a hard mask).

## Timing & taste rules
- Word stagger 0.08-0.12 s, each rise 0.3-0.5 s with a steep ease-out (fast in, long settle).
- Two lines at most; `/` breaks the line.
- Hold ≥ 1.5 s, exit with the block's own exit or a cut on the next beat.
- Over footage: calm, dark or soft part of the shot; never over a busy centre.

## Sound for it
One soft swish at the first word (-14 dB) or nothing under music; a hit only if the headline is the reveal.

## Common mistakes
- Using a mask reveal for every line of a fast edit: it is a calm move.
- Three-line headlines shrink to fit and lose scale contrast.

## Verified
2026-10-28, CLI (`zenvi call`, this branch) on Pexels bench footage / generated media: `scripts/kinetic-mask-reveal.sh` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/skk-kinetic/`, local only) → `techniques/kinetic-mask-reveal.mp4` and its contact sheet. Checked on the sheet: words rise out of the line mask, serif italic accent on 'earns', block exits on its own. Watch judge (absolute, isolated 3-5 s test): **4.1/10** overall, typography 6; its main note: "The video is completely silent, missing audio cues to accent the text animation.".
