---
id: shot-carousel-ring
kind: technique
summary: "When a library or portfolio should loop forever: cards in a rotating ring, front card lit, caption changing underneath."
categories: [saas-app-launch, product-launch-film, brand-story-corporate, 3d-product-cgi-ad, animated-explainer]
tools: [add_3d_scene_tool, add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [steady, premium, hypnotic]
aspect: ["16:9", "1:1", "9:16"]
pairs_with: [kinetic-lower-third, kinetic-emphasis-scale, shot-stack-press-count]
avoid_with: [shot-card-stack-fan, shot-page-waterfall-wall]
needs: [ring-carousel-3d]
---

# Ring carousel (loopable)

## What it is
Eight cards stand on a ring and the whole ring turns once, a steady drift plus a small push-and-dwell at every 45 degrees. Each
card only orbits (it always faces outward and is never upside down or mirrored); the card at the front lights up and its name
is shown under the ring. A shallow, fixed camera. It has no beginning or end, so it is the right tool for a background plate,
a loop, or a landing-page hero, a poor one for a main shot on its own.

## Build it in Zenvi
No ring scene exists (`needs: ring-carousel-3d`). Closest honest builds:
- `add_3d_scene_tool {"scene": "floating_cards", "duration_seconds": 5, "params": {"file_ids": ["<a>", "<b>", "<c>", "<d>"]}}` for cards in
  depth with a gliding camera (a drifting cloud, not a ring).
- Flat stand-in: 5 cards on separate tracks, each `set_keyframes_tool` `location_x` along a shallow ellipse (sin) with `scale_x`/`scale_y`
  larger at the front (1 at front, 0.55 at the back), `alpha` 1 to 0.4 at the back, offset by 72 degrees each; front-most track on top.
  One lap in 5.6 s with `interpolation: linear` for the drift plus a short `ease_in_out` step every 0.7 s for the dwell.
- Caption: `add_motion_block_tool {"block": "word_rotator", "params": {"prefix": "", "words": ["Launch", "Product", "Recap", "Teaser"], "style": "slot"}}` stepping once per dwell.
- Lighting the front card is a pop of scale 1.06 and an accent outline (a rounded `corner_radius` clip with a coloured clip behind it).
Do not claim a true 3D ring from these; say it is a flat approximation.

## Timing & taste rules
- 8 cards at 45 degrees; radius about twice the card width (at 1.5x the back cards poke between the front ones); over 12 cards, widen the ring.
- Rotation = 50 % constant drift + 50 % stepped dwell (21 f per step: 8 f dwell + 13 f move); whole laps only, or the loop jumps.
- Front card lit within +-26 degrees, pushed out 44 px; wider than that two cards are half-lit.
- Camera: perspective about 2200 px (flat), 9 degrees of top-down tilt; never move the camera, all motion comes from the ring.
- Back cards darkened by distance (up to 70 % towards the background), not by opacity on a 3D group (it flattens the ring).
- The caption follows the step number, not the true angle (the drift runs ~8 degrees past a dwell).

## Sound for it
Nothing per card. A very soft `whoosh_short` (-26 dB) on each step if the plate has no music; otherwise leave it silent.

## Common mistakes
- Using one face texture only: the back side must show the same upright content (two faces, same orientation).
- Non-integer laps (the loop pops); letting the ring be the whole shot with no foreground text.
- Reflection above 15 % opacity: its text competes with the caption.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/ui-entrance/carousel-3d.md` (Apache-2.0; see ../NOTICE).
