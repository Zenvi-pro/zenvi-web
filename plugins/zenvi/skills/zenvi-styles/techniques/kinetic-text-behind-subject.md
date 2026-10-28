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
- Push the word 1.0 → 1.08 over its hold (`set_keyframes_tool` scale_x/scale_y on the text clip, track above the
  footage) so it lives in the shot; static behind-text was judged a sticker (2.9 → kept the push in the script).

## Sound for it
A soft thud or the music's downbeat when the word appears; nothing else.

## Common mistakes
- The word fully hidden by the head (pick `y` above the head).
- Matte edges on hair against a busy background: choose a clean background shot.

## Verified
2026-10-28, CLI (`zenvi call`, this branch) on Pexels bench footage / generated media: `scripts/kinetic-text-behind-subject.sh` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/skk-kinetic/`, local only) → `techniques/kinetic-text-behind-subject.mp4` and its contact sheet. Checked on the sheet: FOCUS sits behind the head (matte cut-out over the lower letters) and stays readable while he turns; the edges chatter a little on hair. Watch judge (absolute, isolated 3-5 s test): **2.9/10** overall, typography 4; its main note: "The text 'FOCUS' appears instantly and remains totally rigid, disconnected from the handheld camera movement.".
