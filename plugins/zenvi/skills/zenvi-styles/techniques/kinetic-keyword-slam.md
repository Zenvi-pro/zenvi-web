---
id: kinetic-keyword-slam
kind: technique
summary: "When one word is the point of the section: it slams in huge on a flat colour card on the cut, with a hit."
categories: [video-essay-explainer, animated-explainer, documentary-true-story, brand-story-corporate, news-short-vertical-explainer, product-launch-film, food-recipe, gaming-montage]
tools: [add_kinetic_title_tool, add_sfx_tool, auto_sound_design_tool]
pace: fast
mood: [dramatic, bold, urgent]
aspect: ["9:16", "1:1", "16:9"]
pairs_with: [kinetic-vo-captions, kinetic-beat-strobe, kinetic-title-sequence]
avoid_with: [kinetic-echo-stack, kinetic-typewriter]
needs: []
---

# Keyword slam card

## What it is
A flat or black full-frame card with one or two oversized words (25-55 % of frame height) that land from 1.8x in 4
frames on a kick, snare or the spoken word, then cut away. The video-essay "DOUBT" card, a chapter word, a verdict.

## Build it in Zenvi
```json
add_kinetic_title_tool {"text": "DOUBT", "style": "stack", "animation": "slam", "background": "#d4141c", "text_size": 0.3,
  "position_seconds": 1.6, "duration_seconds": 1.1}
add_sfx_tool {"recipe": "impact_slam", "at_seconds": 1.6}
add_sfx_tool {"recipe": "sub_drop", "at_seconds": 1.6, "gain_db": -14}
add_sfx_tool {"recipe": "whoosh_short", "at_seconds": 2.7}
```
Put the card *on* a cut (its start = the outgoing shot's end); `background` makes it a chapter card, leave it out to
slam over picture. In a full edit `auto_sound_design_tool` spots the slam as a hero hit by itself.

## Timing & taste rules
- 0.8-1.5 s on screen; 2.5 s at most for a chapter word.
- One slam per 8-15 s of edit; a second one in the same sentence kills both.
- Card colour = the edit's single accent (red, cobalt, black); ink is white or near-black, never a third hue.
- Duck music 6-10 dB for 100-150 ms before the hit (the pre-hit hole) when there is a bed.

## Sound for it
Layered hero hit: impact (transient + body) + sub drop 4-6 dB under it, -10 LUFS momentary; a short whoosh on the cut
out. Under VO keep the hit 3-6 dB lower and off 1-4 kHz.

## Common mistakes
- Slamming a whole sentence (≥ 3 words): it becomes a title card, use kinetic-word-pop.
- No sound on the slam: it reads as a glitch frame.
- Holding the card over 2.5 s: energy drains.

## Verified
VERIFIED:kinetic-keyword-slam
