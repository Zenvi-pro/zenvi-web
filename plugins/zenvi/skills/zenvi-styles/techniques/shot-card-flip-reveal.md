---
id: shot-card-flip-reveal
kind: technique
summary: "When a feature should answer 'so what?': cards flip one by one from the feature screen to its result number."
categories: [saas-app-launch, product-launch-film, tech-review, kinetic-type-motion-design, brand-story-corporate]
tools: [add_clip_to_timeline_tool, add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [clean, confident, premium]
aspect: ["16:9", "1:1"]
pairs_with: [kinetic-counter, kinetic-emphasis-scale, shot-bottom-push-chapters]
avoid_with: [shot-solid-page-wipes, shot-card-flock-tumble]
needs: [card-flip-3d]
---

# Card flip reveal

## What it is
A row of feature cards each flips 180 degrees about its vertical axis; the front is the feature's screen, the back is its
result as one huge number. The flip is the answer to "so what?". Staggered across the row, it reads as results announced
in turn.

## Build it in Zenvi
No true 3D card yet (`needs: card-flip-3d`); the fake is a scale-x flip about the card's own centre, which reads well
head-on.
1. Front: the feature screen as a clip scaled to a card, e.g. `add_clip_to_timeline_tool {"file_id": "<UI>", "position_seconds": 0,
   "duration_seconds": 4, "track": "2", "full_file": true}`, then `set_keyframes_tool` on `scale_x` / `scale_y` = 0.4 and
   `location_x` = -0.3 (card 1; use 0, +0.3 for cards 2 and 3).
2. Back: the number, a transparent block on the card above it:
   `add_motion_block_tool {"block": "counter", "params": {"values": ["0", "41"], "suffix": "%", "label": "less time", "style": "count"},
   "position_seconds": 0.5, "duration_seconds": 3.5, "placement": "over_video", "track": "3"}` scaled and placed the same way.
3. Flip by keyframes on each pair (times from the card's start at t0 = 0.5 s for card 1, +0.4 s per next card):
   anticipation (0.13 s: front `scale_x` 1.0 to 1.04), then front `scale_x` 1 to 0 over 0.27 s `ease_in_cubic`; back `scale_x`
   0 to 1.07 over 0.27 s from the same instant `ease_out_back`, settling to 1.0 in 0.33 s. Hide the back until then
   (`alpha` 0 to 1 at the swap instant, constant interpolation) and the front after (`alpha` 1 to 0).
4. `add_sfx_tool {"recipe": "pop", "at_seconds": <landing>, "gain_db": -16, "seed": n}` per card.

## Timing & taste rules
- Flip: 4 f anticipation, 16 f turn, about 10 f spring; under 14 f you cannot see the thin edge, over 28 f it is a slow spin.
  Overshoot about 14 degrees (the 1.07 above), settle with one bounce at most.
- Stagger 12 f per card, at most 4 cards; flipping all at once is a wall flipping.
- Front and back must be a pair: feature screen to its result; unrelated content makes it a fancy image swap.
- Back face: one number of 150-170 px with one label and at most one comparison bar. A wide value such as "-41%" must not
  touch the card edge.
- Dark front, light back: three flips take the row from dark cards to white number posters.
- After the last landing, fully still for at least 40 f; camera creep 1 to 1.03 over the whole thing at most.

## Sound for it
A soft `pop` or `ui_tap` (-16 dB) at each landing; three in a row doubles the rhythm.

## Common mistakes
- Back face crammed with UI: only one beat of attention after the flip.
- No anticipation (reads as popping, not flipping).
- Counting number rolling during the flip: start it after the landing.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/transition/card-flip-reveal.md` (Apache-2.0; see ../NOTICE).
