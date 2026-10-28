---
id: kinetic-text-behind-subject
kind: technique
summary: "When one big word should live in the scene: it sits behind the person, their head and body cut out over it."
categories: [talking-head-captions, saas-app-launch, fashion-beauty-ad, fitness-lifestyle, sports-hype-edit, travel-cinematic-montage]
tools: [generate_subject_matte_tool, text_behind_subject_tool, kinetic_captions_tool, add_sfx_tool]
pace: medium
mood: [bold, premium, editorial]
aspect: ["9:16", "16:9", "1:1"]
pairs_with: [kinetic-emphasis-scale, kinetic-vo-captions, kinetic-echo-stack]
avoid_with: [kinetic-stencil-reveal, kinetic-karaoke]
needs: []
---

# Text behind subject

## What it is
A huge word (20-40 % of frame height) set across the top of the frame behind the person: footage, then the text, then a
cut-out of the person on top (subject matte). The magazine-cover move of creator reels and launch opens.

## Build it in Zenvi
```json
generate_subject_matte_tool {"clip_id": "<footage clip>"}
text_behind_subject_tool {"clip_id": "<footage clip>", "text": "FOCUS", "color": "#f2c14e", "y": 0.3}
add_sfx_tool {"recipe": "impact_thud", "at_seconds": 0, "gain_db": -14}
```
The matte takes ~1.5x real time on this machine for 720p (CLI; first run downloads the model). In captions:
`kinetic_captions_tool {"behind_subject": "emphasis"}` puts only the emphasis words behind the head. An existing
title: `title_clip_id` instead of `text`.

## Timing & taste rules
- Subject covers ≤ 25 % of the word (it must stay readable); the head overlaps the lower third of the letters.
- One word, caps, heaviest face; the accent or white.
- Works on a locked or slow shot; fast handheld makes matte edges chatter.
- 1.5-3 s; it is a moment, not a caption.

## Sound for it
A soft thud or the music's downbeat when the word appears; nothing else.

## Common mistakes
- The word fully hidden by the head (pick `y` above the head).
- Matte edges on hair against a busy background: choose a clean background shot.

## Verified
VERIFIED:kinetic-text-behind-subject
