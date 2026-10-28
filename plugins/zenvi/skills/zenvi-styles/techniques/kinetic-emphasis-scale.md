---
id: kinetic-emphasis-scale
kind: technique
summary: "When a line has one hero word: set it 3-6x the connectors in the condensed display face and the accent."
categories: [talking-head-captions, saas-app-launch, fashion-beauty-ad, kinetic-type-motion-design, podcast-clip-vertical, ugc-ad-testimonial]
tools: [add_kinetic_title_tool, kinetic_captions_tool, add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [bold, confident, energetic]
aspect: ["9:16", "1:1", "16:9"]
pairs_with: [kinetic-word-pop, kinetic-vo-captions, kinetic-text-behind-subject, kinetic-word-rotator]
avoid_with: [kinetic-lyric-sync, kinetic-quote-card]
needs: []
---

# Emphasis-word scale

## What it is
Connectors small and white, the one word that matters huge (3-6x their height) in a condensed display face and the
accent colour. The single strongest move in creator captions and SaaS claims (hero:connector 3-9x in the best reels;
uniform 6-7 % lines are the average ones).

## Build it in Zenvi
```json
add_kinetic_title_tool {"text": "made for the obsessed", "style": "creator", "animation": "pop", "emphasis": "obsessed",
  "accent": "#ff5a1f", "text_size": 0.06, "position_seconds": 0.2, "duration_seconds": 3.6, "stagger_seconds": 0.14}
add_sfx_tool {"recipe": "impact_punch", "at_seconds": 0.7}
```
`text_size` sets the connectors; the emphasis word keeps the style's ratio (creator ≈ 6x). Over speech use
`kinetic_captions_tool {"style": "creator", "emphasis": ["obsessed"]}`. `kinetic_headline` (`*word*`) changes only the
face, not the size, when the line fits the width: use it for a 1.2-2x accent, not this technique.

## Timing & taste rules
- Ratio 3-6x over footage (captions); 2-3x in type-only pieces and lyric/VO type (higher looks shouty there).
- One emphasis word per line, at most one per 2 s of speech.
- Hero word lands on the stressed syllable (±2 frames), connectors before it.
- Keep the hero word inside title safe and off the face; at 6x it is often wider than the negative space: shorten it.

## Sound for it
One punch or pop on the hero word (-10 to -12 LUFS momentary, 3-6 dB lower under voice); nothing on connectors.

## Common mistakes
- Two hero words in one line (neither wins).
- Emphasising a stopword or the subject's name instead of the claim.
- Hero word in a third colour; it is the accent or the ink, nothing else.

## Verified
VERIFIED:kinetic-emphasis-scale
