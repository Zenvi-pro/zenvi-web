---
id: kinetic-echo-stack
kind: technique
summary: "When a hook line should hit like a strobe: copies of the line stack up the frame, then collapse to one."
categories: [saas-app-launch, sports-hype-edit, gaming-montage, kinetic-type-motion-design, fitness-lifestyle]
tools: [add_kinetic_title_tool, add_sfx_tool, set_clip_properties_tool]
pace: frantic
mood: [aggressive, hype, loud]
aspect: ["9:16", "16:9", "1:1"]
pairs_with: [kinetic-beat-strobe, kinetic-keyword-slam, kinetic-text-behind-subject]
avoid_with: [kinetic-quote-card, kinetic-type-morph, kinetic-lyric-sync]
needs: [text-echo-stack]
---

# Echo stack (stacked / outlined echo type)

## What it is
One line repeated 5-12 times down the frame, the centre copy bright and the echoes dimmer, appearing 2 frames apart on
drum transients and collapsing back to the single centre line in under 1 s.

## Build it in Zenvi
No one-call tool yet (`needs: text-echo-stack`). Fallback that verifies: 7 `add_kinetic_title_tool` copies of the line at
y 0.5, 0.38/0.62, 0.26/0.74, 0.14/0.86, the accent getting darker outward, each starting 0.067 s after the previous and
the outer pairs ending first so the stack collapses to the centre:
```json
add_kinetic_title_tool {"text": "NO DAYS OFF", "style": "creator", "emphasis": "NO,DAYS,OFF", "accent": "#ffffff", "text_size": 0.016,
  "animation": "slam", "stagger_seconds": 0, "y": 0.5, "position_seconds": 0.2, "duration_seconds": 2.6}
add_kinetic_title_tool {"text": "NO DAYS OFF", "style": "creator", "emphasis": "NO,DAYS,OFF", "accent": "#b8b8b8", "text_size": 0.016,
  "animation": "slam", "stagger_seconds": 0, "y": 0.38, "position_seconds": 0.267, "duration_seconds": 1.433}
… (y 0.62 #b8b8b8, 0.26/0.74 #7a7a7a, 0.14/0.86 #4a4a4a; start +0.067 s each, duration shrinking)
add_sfx_tool {"recipe": "hit_transient", "at_seconds": 0.2}   (one per other copy, -16 dB) and impact_punch on the collapse
```
Emphasising every word in the creator style is the trick that keeps the condensed caps (connectors would be lowercase
Inter). The full script is `scripts/kinetic-echo-stack.sh` in the verification artifacts. Outlined echoes need an
outline title preset (not in add_kinetic_title_tool); `type_morph` `style: "outline"` is the only outlined type today.

## Timing & taste rules
- Copies 2 frames apart, collapse ≤ 1 s after the last copy; the whole move ≤ 1.5 s.
- Echo brightness steps 100 / 70 / 45 / 30 %.
- Only on an opening hook or a drop; once per edit.

## Sound for it
Transient ticks on every other copy (-16 dB), one punch on the collapse; the music's own drums can carry the copies.

## Common mistakes
- Copies overlapping (line spacing smaller than the cap height): keep spacing ≥ 1.1x the line height.
- Leaving the echoes up: the point is the collapse.

## Verified
2026-10-28, CLI (`zenvi call`, this branch) on Pexels bench footage / generated media: `scripts/kinetic-echo-stack.sh` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/skk-kinetic/`, local only) → `techniques/kinetic-echo-stack.mp4` and its contact sheet. Checked on the sheet: seven copies appear 2 frames apart and the outer pairs leave first, collapsing to the centre line by 1.8 s; creator style with every word emphasised stacked the words vertically, so the verified version uses documentary (one Inter line). Watch judge (absolute, isolated 3-5 s test): **4.7/10** overall, typography 6; its main note: "The text collapse feels stiff because all outer lines snap together linearly without motion blur or organic easing.".
