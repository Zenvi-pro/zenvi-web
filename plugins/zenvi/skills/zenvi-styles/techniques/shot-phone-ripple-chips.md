---
id: shot-phone-ripple-chips
kind: technique
summary: "When a mobile app needs its hero frame: a phone on breathing rings, its feed auto-scrolling, feature chips popping."
categories: [saas-app-launch, product-launch-film, brand-story-corporate, ugc-ad-testimonial]
tools: [add_3d_scene_tool, add_motion_block_tool, add_clip_to_timeline_tool, add_shape_mask_tool, set_keyframes_tool, add_kinetic_title_tool, add_sfx_tool]
pace: calm
mood: [warm, friendly, quiet]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-attention-bounce, kinetic-lower-third, kinetic-mask-reveal]
avoid_with: [shot-slam-entrance, shot-scan-annotate]
needs: [concentric-ripple-field]
---

# Phone on ripples with feature chips

## What it is
The product hero shot for mobile: a phone dead centre that feels alive. Four concentric rounds breathe out of phase like water,
the screen's feed scrolls by itself (proof something runs inside), and two chips pop in left then right, then float. Three very
slow motions that add up so it never feels static. Ends as a poster with a small mark.

## Build it in Zenvi
1. Warm ground with rings: no concentric-ripple tool (`needs: concentric-ripple-field`). Closest: `add_motion_block_tool {"block":"gradient_field","params":{"style":"orbs","colors":["#dccbb4","#f2eadf","#c4552d"],"speed":0.4,"grain":true},"duration_seconds":5.6,"placement":"full_frame"}`
   or 4 concentric circle stills (2240 / 1760 / 1280 / 840 px, darker outside to lighter inside) on four tracks, each `set_keyframes_tool` `scale_x/scale_y` 1.0 to 1.06 to 1.0 (1.5 cycles over the shot, `ease_in_out_sine`) with a phase offset of 1.7 rad (~0.28 of a cycle) between neighbours.
2. Phone with a scrolling feed: `add_3d_scene_tool {"scene":"device_mockup","params":{"device":"phone","file_id":"<feed screen recording>","move":"float","dof":false,"shadow":true},"duration_seconds":5.6}`.
   Without Blender: the recording as a clip scaled to a phone-shaped crop (mask: `add_shape_mask_tool {"shape":"rectangle","width":0.24,"height":0.83,"feather":0}` on it), with its own `location_y` 0 to -560 px-equivalent at **constant speed** (`interpolation:"linear"`), a soft `Shadow` for the phone.
3. Chips: `add_kinetic_title_tool {"text":"Smart queue","style":"creator","animation":"pop","emphasis":"none","text_size":0.04,"position_seconds":1.2,"y":0.5}` left at 1.2 s, right chip at 2.2 s; use `set_keyframes_tool property=location_x` for a 28 px push outward as they pop and a +-8 px `ease_in_out_sine` bob (2 cycles) fading in 18 f after the pop.
4. Closing mark: a small logo still fades up under the chips after the second chip lands.

## Timing & taste rules
- 168 f (5.6 s). Phone rises 90 px in 26 f; ring breathing +-6 % (0.1 reads as a pulse); phase offset 1.7 rad between rings; outermost two rings run off-frame, otherwise it is a coloured disc.
- Feed scroll: 560 px over 0.08-0.98 of the shot, linear. Any easing reads as a human swipe.
- Chip pop: scale 0.8 to 1 with one visible overshoot (spring damping 13 / stiffness 190; > 20 damping and the pop dies); left at 37 f, right at 67 f (1 s apart: not simultaneous); 36 px bold text with a 60 px accent icon circle; float +-8 px, never > 12 or it fights the rings.
- Chips must stay inside 96 px safe margin; long labels widen outward from the phone.
- Fake feed needs height > 560 + screen height or it runs out and shows white; real captures: use a long recording.

## Sound for it
One `pop` (-16 dB) per chip with different `seed`; `room_tone` or a very soft bed only.

## Common mistakes
- Rings in phase (looks like zoom, not ripple).
- Easing on the auto-scroll.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/effects/radial-ripple-phone-chips.md` (Apache-2.0; see ../NOTICE).
