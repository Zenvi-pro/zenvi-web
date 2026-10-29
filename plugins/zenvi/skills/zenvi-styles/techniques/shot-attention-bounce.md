---
id: shot-attention-bounce
kind: technique
summary: "When a new feature needs a 'look here': an app icon jumps higher each time, squashes on landing, then opens its panel."
categories: [saas-app-launch, product-launch-film, animated-explainer, kids-education]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, add_effect_tool, add_kinetic_title_tool, add_sfx_tool, apply_clip_preset_tool]
pace: medium
mood: [playful, inviting, anticipatory]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-slam-entrance, kinetic-word-pop, kinetic-lower-third]
avoid_with: [shot-gauge-readout, shot-crash-zoom-punch]
needs: []
---

# Attention bounce (icon performance)

## What it is
A call for attention: an icon at half-screen size jumps four times, each jump higher than the last,
squashes on every landing, and on the highest jump the camera leans in 8 %. Neighbour icons defocus. The icon then opens
the "what's new" panel. It cuts the user's attention into the story. Prefer bounce or burst types of icon performance over pendulum swings.

## Build it in Zenvi
1. Icon as a still, 360-400 px tall at 1080p (as big as the half frame), neighbours as a second still strip behind it.
2. Jump heights per jump: 0.35, 0.6, 0.85, 1.2 x icon height; air time 14 / 18 / 22 / 26 f (proportional to sqrt of height).
   `set_keyframes_tool {"timeline_clip_id":"<icon>","property":"location_y","mode":"replace","points":[{"seconds":0.3,"value":0},{"seconds":0.4,"value":-0.12,"ease":"ease_out_quad"},{"seconds":0.5,"value":0,"ease":"ease_in_quad"}]}`
   repeat for the four jumps (ease out going up, ease in coming down = gravity), the last peak at ~-0.38 of the frame height.
3. Squash on contact (2 f): `set_keyframes_tool` `scale_x` 1.0 to 1.1 to 1.2 and `scale_y` 1.0 to 0.9 to 0.8 across the four landings (more each time), recover over 3-4 f; stretch slightly in the air (scale_y 1.05).
4. Ripple dot on each landing: `add_motion_block_tool {"block":"particle_burst","params":{"shape":"rings","count":8,"origin":[{"x":0.5,"y":0.88}]},"position_seconds":0.5,"duration_seconds":0.8}`.
5. Camera + neighbours: on the last jump, push the whole scene 8 % (`scale_x/y` 1 to 1.08, smooth, 18 f); neighbours `add_effect_tool {"effect":"Blur","properties":{"horizontal_radius":7,"vertical_radius":7}}` and `Saturation` 0.7 keyframed in from f30 to f96.
6. Panel: `apply_clip_preset_tool {"preset":"pop_in","duration_seconds":0.5}` on a "New" panel still; badge via `add_kinetic_title_tool {"text":"NEW","animation":"pop"}`.

## Timing & taste rules
- 156 f (5.2 s). Equal jumps read as a loading spinner; rising height is "calling louder". Air time must follow sqrt(height) or the bounce feels weightless.
- Squash 2 f at contact, amount 0.1 rising to 0.2 (last landing 1.2 wide x 0.8 tall), damped cosine settle. Without squash there is no weight.
- Compute the frame budget in pixels first: ground at 960, icon 360 tall, last apex at 168 px from the top (still 119 px after the 8 % push). The first version of this move left the frame.
- Performer is centred and big; a small corner icon is never seen.

## Sound for it
A pitched-up `pop` per landing (-14 dB; raise `pitch` by +2 semitones each time), a soft `notification_blip` when the panel opens.

## Common mistakes
- Pendulum swings for hanging icons: weak; use jump or burst.
- Letting the highest apex clip the top of the frame.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/effects/icon-performance-moves.md` (Apache-2.0; see ../NOTICE).
