---
id: kinetic-text-on-path
kind: technique
summary: "When type should orbit or follow a shape (record label, badge, logo ring): letters set along an arc."
categories: [kinetic-type-motion-design, music-lyric-video, gaming-montage, brand-story-corporate]
tools: [add_kinetic_title_tool, set_clip_properties_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [playful, graphic, retro]
aspect: ["16:9", "1:1", "9:16"]
pairs_with: [kinetic-beat-strobe, kinetic-letter-cascade, kinetic-lyric-sync]
avoid_with: [kinetic-mask-reveal, kinetic-echo-stack]
needs: [text-on-path]
---

# Text on path

## What it is
Letters bent along a circle or curve: an orbiting ring of type around a subject, a badge, a lyric on a spinning record
label. Missing as a tool (`needs: text-on-path`: no textPath anywhere); the fallback below verifies for arcs.

## Build it in Zenvi
Fallback: `animation: "letters"` makes one native clip per letter (in reading order, `data.created_clip_ids`); move each
onto the arc and turn it to the tangent with `set_clip_properties_tool`:
```json
add_kinetic_title_tool {"text": "SPIN·THE·RECORD·", "style": "stack", "animation": "letters", "position_seconds": 0.2,
  "duration_seconds": 3.6, "stagger_seconds": 0.04, "text_size": 0.12}
set_clip_properties_tool {"timeline_clip_ids": ["<letter 0>"], "properties": {"location_x": 0.3, "location_y": 0.42, "rotation": -150}}
add_sfx_tool {"recipe": "whoosh_rise", "at_seconds": 0.2, "gain_db": -18}
```
For letter i of n on a circle (centre cx, cy px; radius r px; arc from a0 to a1 degrees, 0 = top):
a = a0 + (a1 - a0)·i/(n-1) (n ≥ 2: a ring needs letters); x = cx + r·sin a, y = cy - r·cos a; `location_x = x/W - w/2`, `location_y = y/H - h/2`
(w, h = one letter's box in frame fractions: `data.box` width / n and height); `rotation = a`. Location keeps the
letters' entrance (scale keyframes stay). A spinning ring = one more `set_keyframes_tool` per letter (location and
rotation every few frames) — heavy; ask for the tool instead.

## Timing & taste rules
- Arc ≥ 220° reads as a ring; less reads as a smile.
- Separators (·) between words, equal letter spacing, caps only.
- Radius ≥ 2.5x the cap height or the letters collide at the inside.

## Sound for it
A whoosh as the ring builds; per-letter ticks only on a slow build.

## Common mistakes
- Lowercase on a path (descenders collide).
- A ring that should rotate left static for a long hold: hold ≤ 2 s.

## Verified
2026-10-28, CLI (`zenvi call`, this branch) on Pexels bench footage / generated media: `scripts/kinetic-text-on-path.sh` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/skk-kinetic/`, local only) → `techniques/kinetic-text-on-path.mp4` and its contact sheet. Checked on the sheet: 13 letters set on a 300-degree arc around the stage lights, each turned to the tangent, still bouncing in one by one; static ring (no spin). Watch judge (absolute, isolated 3-5 s test): **2.4/10** overall, typography 4; its main note: "The video is completely silent, making the kinetic type test feel flat and unfinished.".
