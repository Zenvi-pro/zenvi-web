---
id: tutorial-packaging-kit
kind: technique
summary: "For packaged how-to reels: the host or screen in a rounded container, numbered step cards, a hero number rolling up."
categories: [vfx-tutorial-breakdown]
tools: [add_motion_template_tool, add_motion_block_tool, set_clip_properties_tool, kinetic_captions_tool, build_reel_tool, add_sfx_tool, master_audio_tool]
pace: medium
mood: [helpful, clean, confident]
aspect: ["9:16"]
pairs_with: [object-pop-out-with-clean-plate-swap, comic-burst-insert, prompt-bar-typing-hero, split-screen-compare-layout]
avoid_with: [withheld-music-cold-drop, beat-staggered-tile-and-slice-build]
needs: []
---

# Tutorial packaging kit

## What it is
The furniture of a packaged tutorial reel: the host or the screen recording
sits in a rounded container on a grid-paper ground, each step gets a pill
title card ("TOOL 01 · Key the green screen"), and the proof is a hero number
that rolls up under a riser. One accent colour runs through pill, badge and
emphasis words.

## Build it in Zenvi
```json
add_motion_template_tool {"template": "grid_background", "position_seconds": 0, "duration_seconds": <len>,
  "variant": "paper", "palette": "tutorial"}
add_clip_to_timeline_tool {"file_id": "<host or screen>", "position_seconds": 0, "track": 3, ...}
set_clip_properties_tool {"timeline_clip_ids": ["<host>"],
  "properties": {"scale_x": 0.86, "scale_y": 0.86, "location_y": 0.42, "corner_radius": 0.06}}
add_motion_template_tool {"template": "step_card", "position_seconds": <step>, "duration_seconds": 3.4, "step": 1,
  "text": "Key the green screen", "file_ids": ["<step footage>"], "palette": "tutorial", "tag": "TOOL 01"}
add_motion_block_tool {"block": "counter", "position_seconds": <proof>, "duration_seconds": 3.2,
  "params": {"values": ["0", "5220123"], "label": "VIEWS ON THE FIRST TRY", "style": "count",
             "accent": "#1e6fff", "palette": "light", "exit": false}}
add_sfx_tool {"recipe": "riser_tonal", "at_seconds": <proof>, "align": "start", "duration": 1.4, "gain_db": -14}
add_sfx_tool {"recipe": "impact_punch", "at_seconds": <counter lands>, "gain_db": -9}
```
- `corner_radius` is a fraction (0-0.5), not pixels.
- `build_reel_tool {"style": "tutorial", "labels": [...], "words": [...]}`
  lays a whole step sequence in one call when you have one clip per step.
- Captions for the VO: `kinetic_captions_tool` at 4.5-5 % height, keywords in
  the accent.

## Timing & taste rules
- Three type tiers: captions 4.5-5 %, step headers 6-10 %, hero number ~8 %+.
- One step per 4-7 s; the number lands on a hit and holds 1 s.
- Keep the container on screen while cards change; wiping the whole layout for
  the counter loses the thread (judge note): put the counter over the host.
- One accent colour everywhere.

## Sound for it
A click or pop on every card and badge, a whoosh on each card entrance, a
riser under the counter and a punch when it lands (24+ cues per minute in the
best reels), VO 5-12 dB over a ducked bed, master to -14 LUFS.

## Common mistakes
- A silent card entrance (pass 1 note).
- The counter cutting off mid-roll: `exit: false` and a landing hit.

## Verified
2026-10-29: 7 s 9:16 tests: screen-recording host in a rounded container on
paper grid, a TOOL 01 step card, a 5,220,123 counter. Pass 1: 5.55 (no card
sound, counter cut off). Pass 2 (paper/pop on the card, landing punch,
`exit: false`): 5.55; the judge wants the counter inside the layout.
