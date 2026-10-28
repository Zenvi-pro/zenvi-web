---
id: kinetic-quote-card
kind: technique
summary: "When a sentence must be read and believed: a serif quote on a paper card, one italic accent word, a source."
categories: [documentary-true-story, video-essay-explainer, brand-story-corporate, ugc-ad-testimonial, news-short-vertical-explainer, wedding-event-film]
tools: [add_motion_block_tool, add_kinetic_title_tool, add_sfx_tool]
pace: calm
mood: [thoughtful, credible, editorial]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-write-on, kinetic-mask-reveal, kinetic-title-sequence]
avoid_with: [kinetic-beat-strobe, kinetic-echo-stack, kinetic-emphasis-scale]
needs: []
---

# Quote card

## What it is
A full-frame paper/cream (or black) card with a 1-2 line quote in a serif, one word in the italic accent, a small mono
kicker (source, chapter) — the reading pause between two fast sections. Also testimonial and press quotes.

## Build it in Zenvi
```json
add_motion_block_tool {"block": "kinetic_headline", "position_seconds": 0, "duration_seconds": 5, "placement": "full_frame",
  "params": {"text": "“Make the thing you / wish *existed*.”", "kicker": "FIELD NOTES · 04", "style": "blur", "emphasis": "serif",
             "display_font": "serif", "palette": "cream", "accent": "#c2410c", "max_size": 260}}
```
Native fallback: `add_kinetic_title_tool {"style": "editorial", "animation": "rise", "background": "#f3efe6", "ink": "#151515"}`.

## Timing & taste rules
- Read time: 0.3 s per word + 1 s; a 7-word quote holds ≈ 3-4 s.
- Ratio of quote to kicker 6-10x; the kicker in mono caps at 1.5-3 %.
- One emphasis word in italic accent, quotes as real curly quotes.
- Calm entrance (blur or rise), exit by cut.

## Sound for it
Nothing, or room tone and the music dipped 3-6 dB: silence is the point. A soft paper swish at most.

## Common mistakes
- Quoting real people who did not say it, or copying reference copy: write original lines.
- Shrinking a long quote to fit: cut it to ≤ 12 words.

## Verified
2026-10-28, CLI (`zenvi call`, this branch) on Pexels bench footage / generated media: `scripts/kinetic-quote-card.sh` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/skk-kinetic/`, local only) → `techniques/kinetic-quote-card.mp4` and its contact sheet. Checked on the sheet: quote blurs in on the cream card, italic accent word, mono kicker; legible at 1/4 size. Silent by design (the judge marked the silence down). Watch judge (absolute, isolated 3-5 s test): **4.5/10** overall, typography 8; its main note: "Complete silence leaves the visual reveal feeling sterile and disconnected.".
