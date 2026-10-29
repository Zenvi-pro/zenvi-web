---
id: comic-burst-insert
kind: technique
summary: "For a playful hit in footage (a throw, a punch, a landing): a drawn POW card snaps on for 10-15 frames, then vanishes."
categories: [vfx-tutorial-breakdown]
tools: [add_motion_block_tool, add_kinetic_title_tool, add_sfx_tool, watch_clip_window_tool]
pace: fast
mood: [playful, comic, retro]
aspect: ["9:16", "16:9", "1:1"]
pairs_with: [object-pop-out-with-clean-plate-swap, tutorial-packaging-kit, cut-on-action]
avoid_with: [foreground-occluder-cut-in-footage, withheld-music-cold-drop]
needs: [comic-burst-card]
---

# Comic burst insert

## What it is
A 1960s comic sound-effect card ("POW!", "ZAP!") pops at the exact contact
frame with a scale snap, holds 10-15 frames and cuts out, with a punch and a
whoosh under it. Three in 15 s in the reference Batman before/after; it adds
a wink to a breakdown or a sports fail.

## Build it in Zenvi
Burst lines plus a slammed word, both on the contact frame:
```json
watch_clip_window_tool {"file_id": "<clip>", "start_seconds": <hit - 0.5>, "end_seconds": <hit + 0.5>}
add_motion_block_tool {"block": "particle_burst", "position_seconds": <hit - 0.05>, "duration_seconds": 0.8,
  "params": {"shape": "lines", "count": 120, "origin": [{"x": <hit x>, "y": <hit y>}],
             "colors": ["#ffd400", "#ff2a2a"], "rings": false, "exit": false}}
add_kinetic_title_tool {"text": "POW!", "position_seconds": <hit>, "duration_seconds": 0.4, "style": "creator",
  "animation": "slam", "emphasis": ["POW!"], "accent": "#ffd400", "text_size": 0.12, "y": <hit y>}
add_sfx_tool {"recipe": "impact_punch", "at_seconds": <hit>, "gain_db": -8}
add_sfx_tool {"recipe": "whoosh_short", "at_seconds": <hit - 0.04>, "gain_db": -14}
```
- `creator` with the word as its own emphasis gives a centred, huge condensed
  word; `stack` is left-aligned and smaller (pass 1 put "POW" off the burst).
- The jagged starburst card with a drop shadow and halftone fill is the
  missing `comic-burst-card`; the lines burst is the stand-in.
- Put `origin` and `y` on the contact point (the rim, the fist), not the
  frame centre.

## Timing & taste rules
- Appears on the contact frame (± 1 frame), holds 10-15 frames (0.33-0.5 s),
  cuts out (no fade).
- 1 per 5 s at most; tilt alternate cards ±10° (`set_keyframes_tool` rotation
  on the title clip) so a run of them does not repeat.
- Yellow/red on blue sky or dark plates; on busy frames add a black outline
  colour (`ink`) or skip it.

## Sound for it
A punch on the frame plus a short whoosh 1 frame before; for a ball add a
rim clank or net swish from `search_sound_library_tool`.

## Common mistakes
- The card late after the hit (judge: "appears well after the shot").
- A shot that stalls after the hit: cut 0.5 s after the card goes.

## Verified
2026-10-29: 5.5 s 9:16 test on a basketball shot. A first stack-style render
put "POW" small and left of the burst (contact sheet only). The judged render
(creator style, emphasis on the word): a huge yellow "POW" across the hoop,
burst lines under it; the "!" is dropped by the face. Judge 3.91: the card is
late against the net contact and static (no overshoot), and the shot stalls
after it. Starburst card stays a gap; fidelity approximates.
