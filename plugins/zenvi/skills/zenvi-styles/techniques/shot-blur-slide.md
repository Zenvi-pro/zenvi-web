---
id: shot-blur-slide
kind: technique
summary: "When a title and subtitle need the calm default reveal: words focus in one by one on one shared ease, no spectacle."
categories: [kinetic-type-motion-design, brand-story-corporate, saas-app-launch, product-launch-film, video-essay-explainer]
tools: [add_motion_block_tool, add_kinetic_title_tool, add_sfx_tool]
pace: calm
mood: [premium, quiet, editorial]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-mask-reveal, kinetic-emphasis-scale, shot-title-demote-to-label]
avoid_with: [kinetic-word-pop, kinetic-beat-strobe, shot-glitch-cycle]
needs: []
---

# Blur-slide title (the default reveal)

## What it is
The "professional but never steals the scene" title: each word floats up and comes into focus while it fades in, all three
channels (rise, blur, opacity) driven by the same ease so the word surfaces from soft focus instead of sliding in and
fading on top. A smaller subtitle follows before the title has finished. Use it for every ordinary title and keep the
loud moves for the hero. The paper-card variant stamps each word down from 1.28x with a little blur, one italic accent
word and a short accent rule that closes the card.

## Build it in Zenvi
```json
add_motion_block_tool {"block": "kinetic_headline", "position_seconds": 0, "duration_seconds": 4, "placement": "full_frame",
  "params": {"text": "Make every frame / *feel* cinematic.", "kicker": "NO. 01", "style": "blur", "emphasis": "serif",
             "align": "center", "position": "upper", "max_size": 230, "palette": "cream", "display_font": "serif", "accent": "#c4321d"}}
add_kinetic_title_tool {"text": "One prompt, a finished promo, ready to render.", "style": "documentary", "animation": "rise",
  "ink": "#1c1915", "text_size": 0.055, "y": 0.8, "position_seconds": 1.3, "duration_seconds": 2.7, "stagger_seconds": 0.07}
add_sfx_tool {"recipe": "swish_airy", "at_seconds": 0.35, "gain_db": -14}
```
`style: "blur"` is the focus-in; `rise` is the hard line mask (kinetic-mask-reveal). Over footage use `placement: "over_video"`
on a dim, calm part of the shot. For the stamped paper card, `style: "pop"` with `palette: "cream"` and one starred word is the
nearest block; the accent rule is a thin `add_title_tool` line or the `lower_third` block's rule. No block has the 1.28x
letterpress press; say so rather than faking it.

## Timing & taste rules
- Stagger 4 frames (0.13 s) between words for the title, 2.4 frames (0.08 s) for the subtitle; under 2 frames the line
  arrives as one piece, over 8 frames the viewer starts counting words.
- Each word's window 22 frames (0.73 s), the hero word 30 frames; title travel about 0.38 em, subtitle about 0.5x of that.
- Blur 18 px on a 170 px title, 9 px on a 46 px subtitle (about 10 % of the size, never above 12 %).
- Subtitle starts about 26 frames (0.9 s) before the title has finished: overlap reads as one sentence, queueing as two beats.
- Size gap at least 2x between title and subtitle; do not set the subtitle in a heavy weight.
- Hold the finished card 40 frames (1.3 s) or more; 5 words in the title and about 9 in the subtitle is the tuned density.
- Paper card: scale 1.28 to 1, blur 7 px to 0, 9-frame word windows, 4-frame stagger, exactly one accent word per card, card
  length 50-55 frames (1.7-1.8 s), an 8-frame fade out at the tail.

## Sound for it
Nothing, or one airy swish on the first word (-14 to -18 dB, quiet under any music). No hit: this is the low-energy default.

## Common mistakes
- Three separate eases for rise, blur and opacity (the word arrives, still blurry): one move, one curve.
- A long headline: past 8 words per line, shorten the stagger to 2-2.5 frames or the last word lands in the hold.
- Using it for the hero moment; pair it with one heavy move elsewhere and let this carry all the ordinary titles.
- Two accent words on the paper card, or abstract copy; name the feature or the benefit.

## Verified
2026-10-29, CLI on generated media (no footage): scripts/shot-blur-slide.sh → shots/shot-blur-slide.mp4 (local only). Checked on the sheet: the two lines come out of blur word by word, the accent word is italic serif red, the subtitle follows below with a small gap. Watch judge (absolute): **5.45/10**; main note: "The typographic hierarchy, layout, and optical blur-to-focus cascade look clean and editorial. However, the complete absence of any sound design or ambient audio severely limits engagement."

Adapted from video-shotcraft cards `shots/typography/blur-slide.md` and `shots/typography/paper-title-card.md` (Apache-2.0; see ../NOTICE).
