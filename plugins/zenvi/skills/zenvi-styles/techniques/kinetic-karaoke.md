---
id: kinetic-karaoke
kind: technique
summary: "When a clip needs subtitles that still feel alive: a line of bold caps, the spoken word lit in an accent pill."
categories: [podcast-clip-vertical, talking-head-captions, news-short-vertical-explainer, ugc-ad-testimonial, fitness-lifestyle]
tools: [kinetic_captions_tool, transcribe_media_tool, edit_captions_tool, duck_tool]
pace: medium
mood: [clear, friendly, punchy]
aspect: ["9:16", "1:1"]
pairs_with: [kinetic-lower-third, kinetic-keyword-slam, kinetic-counter]
avoid_with: [kinetic-vo-captions, kinetic-lyric-sync, kinetic-emphasis-scale]
needs: []
---

# Karaoke word highlight

## What it is
1-4 word centred bold-caps chunks (4.5-6.5 % of frame height), white with a stroke, the word being said lit in an accent
pill or colour; snap in, no drift. The podcast-clip default: readable with the sound off.

## Build it in Zenvi
```json
kinetic_captions_tool {"style": "karaoke", "emphasis": "nobody,first", "accent": "#ffd400"}
```
From speech (transcribed) or `cues` as in kinetic-vo-captions. `text_size` default 0.059 of the short side; `y` moves the
line (kept out of the top 12 % and bottom 20 % on 9:16).

## Timing & taste rules
- Highlight lands on each word's onset; chunk changes on phrase ends, never mid-phrase.
- One accent colour (yellow, green or the brand's) and white; no second highlight colour.
- Lower-middle of the frame, under the chin line; never over the mouth.

## Sound for it
None on the captions; the voice and a ducked bed carry it (-15 LUFS voice, bed -10 LU under).

## Common mistakes
- Using karaoke and creator emphasis captions in the same video.
- Chunks of 6+ words (two lines): it becomes subtitles.

## Verified
VERIFIED:kinetic-karaoke
