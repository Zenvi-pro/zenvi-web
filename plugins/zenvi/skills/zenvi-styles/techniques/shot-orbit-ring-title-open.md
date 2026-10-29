---
id: shot-orbit-ring-title-open
kind: technique
summary: "When an opener says 'a whole set of things': eight cards revolve on an ellipse behind a two-line title."
categories: [saas-app-launch, product-launch-film, brand-story-corporate, tech-review]
tools: [set_keyframes_tool, add_3d_scene_tool, add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [modern, rich, assured]
aspect: ["16:9", "1:1"]
pairs_with: [shot-brand-ink-open, kinetic-mask-reveal, kinetic-emphasis-scale]
avoid_with: [shot-dataviz-landscape-open, shot-icon-field-colorize]
needs: [orbit-ring-carousel]
---

# Orbit-ring title open

## What it is
Instead of a static screenshot grid, eight dark 16:9 cards (with real motion playing inside them) revolve on a 720x380 ellipse around a title in the middle. There is always a card
entering and one leaving, which says "there is more", while the title stays centred. The highlighted keyword sweeps in once.

## Build it in Zenvi
No orbit block (`needs: orbit-ring-carousel`). Two options.
1. 3D: `add_3d_scene_tool {"scene": "floating_cards", "params": {"file_ids": ["<f1>", "<f2>", "<f3>", "<f4>", "<f5>", "<f6>"], "count": 8, "background": "dark", "fstop": 2.8}, "duration_seconds": 5}` gives cards in depth with a drifting camera (a drift, not a ring).
2. Native ring, scripted: 8 card clips; for angle theta_i(t) = -pi/2 + i * 2pi/8 + 0.3 t, set `location_x` = cos(theta) * 0.375 and `location_y` = sin(theta) * 0.35 (frame fractions, 0.53 aspect), sampled every 0.2 s, plus
`scale_x/y` = 1 + 0.12 sin(theta) so near cards (lower) are larger. Put the cards on tracks in depth order (rebuild the order from sin(theta) once; a card that crosses the title level changes track).
```json
set_keyframes_tool {"timeline_clip_id": "<card_3>", "property": "location_x", "ease": "ease_in_out_sine", "points": [{"seconds": 0.0, "value": 0.0}, {"seconds": 0.2, "value": 0.021}, {"seconds": 0.4, "value": 0.043}]}
```
Title: `add_motion_block_tool {"block": "kinetic_headline", "params": {"text": "Everything / in *motion*", "kicker": "THE FULL KIT", "style": "blur", "emphasis": "accent", "max_size": 190}, "position_seconds": 0.3, "duration_seconds": 4.4}`.
The starred word gets an accent highlight in the block.

## Timing & taste rules
- Ellipse ratio ~0.53 (a top-down ring); a circle is a turntable, 0.3 is an edge pile. Eight cards at 45 degrees; ten or more need a bigger ring.
- Revolve at 0.3 rad/s (86 degrees in 5 s). Do not speed it up because it "looks slow": above 0.5 rad/s card edges strobe and steal the show.
- Cards never tilt; depth is only scale (+-12 %), stacking and darkening/defocus on far cards (blur <= 1.6 px). Scale beyond 15 % makes a tunnel.
- Ring opens in the first 24 frames (0.62 -> 1.0 scale, expo-out), cards fade in 1.5 frames apart; card contents stay on their first frame until frame 24, then all play (eight motions together would fight).
- Title: top line 64 px grey, bottom line 156 px white; letters unblur over 27-32 frames, 1-2 frames apart; a highlighter block on the keyword lands near frame 64 (spring, no bounce).
- A dark scrim behind the title darkens cards passing under it.
- No second moving element on the ring (particles, sweeps): one constant motion is enough.
- Optional exit: whole title row blurs out in 10 frames, the ring keeps turning into the next shot.

## Sound for it
A soft `riser_noise` under the open (-20), `impact_thud` (-14) on the highlighter landing, nothing per card.

## Common mistakes
- Tilting the cards with the angle (a roller coaster, unreadable text).
- Blank first frames in the cards (give them a static skeleton).

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/opening/orbit-ring-title-open.md` (Apache-2.0; see ../NOTICE).
