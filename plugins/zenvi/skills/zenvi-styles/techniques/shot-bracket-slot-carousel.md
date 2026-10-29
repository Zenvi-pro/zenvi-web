---
id: shot-bracket-slot-carousel
kind: technique
summary: "When one sentence slot has several answers (roles, personas): a pinned focus frame, the item inside swaps three times."
categories: [saas-app-launch, product-launch-film, animated-explainer, brand-story-corporate, kinetic-type-motion-design]
tools: [add_motion_block_tool, add_sfx_tool, set_keyframes_tool]
pace: medium
mood: [clean, confident, metronomic]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-word-rotator, kinetic-emphasis-scale, T116]
avoid_with: [kinetic-letter-swap, shot-list-item-entrance]
needs: [svg-icon-morph-scene]
---

# Bracket slot carousel ("Your ___ agent")

## What it is
A fill-in-the-blank sentence. The sentence never moves; four corner brackets pinned around the blank never move either.
Inside them a column of avatars/icons slides vertically three times on a steady beat: the one in the frame is large and
sharp, the ones leaving shrink, fade and blur by distance, and the role label under it changes in step. One slot, four
proofs. The brackets give a pulse of 7 % at each swap.

## Build it in Zenvi
Text slot first, then the frame:
```json
add_motion_block_tool {"block": "word_rotator", "position_seconds": 0, "duration_seconds": 5.2,
  "params": {"prefix": "Your", "words": ["director", "editor", "animator", "sound designer"], "suffix": "agent",
  "style": "slot", "palette": "light"}}
add_motion_block_tool {"block": "hud_callouts", "position_seconds": 0, "duration_seconds": 5.2,
  "params": {"title": "ROLE", "labels": ["Director"], "values": ["01"], "grid": "crosshair", "points": [{"x": 0.5, "y": 0.5}]}}   // frame ticks + ring on the slot; its label is the role tag
add_sfx_tool {"recipe": "ui_tap", "at_seconds": 1.2, "gain_db": -16, "seed": 1}   // swaps at 0.72, 1.46, 2.2 s in the card; match yours
```
Avatars are not a text slot: for a picture slot, place four avatar stills on stacked tracks and keyframe each with
`set_keyframes_tool` on `location_y`, `scale_x`, `scale_y`, `alpha` (position steps 0.2 of the frame height, scale 1 / 0.62 / 0.5,
alpha 1 / 0.38 / 0), one 22 f move per swap, `ease_out_back`. The brackets are the corner ticks of `hud_callouts`
(`needs: svg-icon-morph-scene` for a drawn bracket frame with a breathing pulse); use `word_rotator` alone if the words
carry it.

## Timing & taste rules
- Swap interval 1.1 s (34 f): enough to read one role. Under 0.4 s the label cannot be read; over 1.5 s the metronome is gone.
- Each move 22 f (about 64 % of the interval), a single clear rebound; underdamped springs shake into the next swap.
- Distance drives everything: scale = max(0.5, 1 - 0.38 d), opacity = max(0, 1 - 0.62 d), blur = min(3 px, 2.4 d); spacing of
  76 px for a 92 px frame so a corner of the neighbour peeks out.
- Label fade is steeper (1 - 2.2 d): two labels must never be on screen at once.
- Bracket pulse 7 %, once per swap; above 15 % the frame beats the content.
- Four items = three swaps; every extra item needs an extra swap and a later start. Accent colour only on the brackets.

## Sound for it
A short `ui_tap` per swap (-16 dB, new seed each); the last landing gets a `pop`. No whoosh.

## Common mistakes
- Swapping on irregular timings (the brackets are a metronome); brackets that move with the item.
- Avatars competing in colour with the brackets: keep the faces neutral.
- Leaving the spacing smaller than the avatar size so neighbours overlap.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/ui-entrance/avatar-bracket-carousel.md` (Apache-2.0; see ../NOTICE).
