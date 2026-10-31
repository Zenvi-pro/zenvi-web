---
id: shot-slam-entrance
kind: technique
summary: "When a hero card or KPI must arrive like a punch: it lands from the lens with rings and a jolt, shaking its neighbours."
categories: [saas-app-launch, product-launch-film, sports-hype-edit, gaming-montage, tech-review]
tools: [set_keyframes_tool, add_motion_block_tool, add_effect_tool, apply_fx_tool, add_kinetic_title_tool, add_sfx_tool]
pace: fast
mood: [heavy, punchy, glossy]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kcut-hit-fx, kinetic-keyword-slam, kinetic-counter, kcut-slam-word]
avoid_with: [shot-crash-zoom-punch, shot-attention-bounce, shot-riso-misregistration]
needs: []
---

# Slam entrance (perspective snap, score slam, impact burst with ripple on neighbours)

## What it is
The entrance itself is the impact. Three flavours: A) Perspective snap: the card whips in from the side with a fisheye-like perspective and flattens with a bounce ("it's here"). B) Score slam: a KPI card falls from 2.6x scale in front of the lens; a ring, dust and screen shake fire together; the number lands a beat later ("it's heavy"). C) Burst kit: B's package, and the shockwave front visibly pushes the neighbouring cards away and back ("it shook the room"). Not about the feedback after landing; the landing is the moment.

## Build it in Zenvi
No 3D card throw; do it with transform keyframes plus a burst. Card = a still (or `add_kinetic_title_tool` with a `background`) on its own track.
1. Throw (B): `set_keyframes_tool {"timeline_clip_id":"<card>","property":"scale_x","points":[{"seconds":0,"value":2.75},{"seconds":0.3,"value":2.6,"ease":"ease_out"},{"seconds":0.5,"value":0.965,"ease":"ease_in_quad"},{"seconds":0.6,"value":1.0,"ease":"ease_out_back"}]}` (same for `scale_y`, plus `rotation` 5 to 0). Hang 9 f first (semi-transparent, soft, `Blur` 10 px baked `add_effect_tool` keyframed to 0 at impact), then 6 f ease-in = the slam.
2. Impact package on the landing frame: `add_motion_block_tool {"block":"particle_burst","params":{"shape":"shards","count":60,"rings":true,"origin":[{"x":0.5,"y":0.55}],"colors":["#ffffff","#f4c542"]},"position_seconds":0.5,"duration_seconds":1.2}`; screen shake on the scene = `set_keyframes_tool` on `location_y` (and a little `location_x`) with `-0.017, +0.012, -0.007, +0.003, 0` every 1-2 f (18 px at 1080, tau ~5 f, vertical-biased); 2-frame white flash with `apply_motion_transition_tool {"preset":"flash_white","duration":0.07}` or a white title card of alpha 0.5.
3. Perspective snap (A): no perspective tool (the closest is `apply_motion_transition_tool {"preset":"whip","direction":"left"}` style). Do `location_x` -1.0 to 0 in 18 f (`ease_out_expo`), `rotation` -8 to 0, `shear_x` 0.3 to 0 over 16 f (`ease_in_out_cubic`) and a +6 overshoot via `ease_out_back` on `rotation` at 15-20 f; baked `directional_blur` angle 0 on the move.
4. Neighbours (C): once the hit lands, each neighbour at distance d starts `location` offset 3 f later per ~500 px: push 34 px (~0.018 frame) away and spring back as cos(t/2)*exp(-t/8), hard clamp to 0 by 40 f; rotation +-3.5 degrees. Neighbours must be settled >= 15 f beforehand.
5. Number: lands 3 f and again 6 f after the card (`add_motion_block_tool` `counter`).

## Timing & taste rules
- A: 18 f in, 5 f overshoot +6 degrees, "snap" is in the overshoot-return, not the arrival; fast < 12 f loses the perspective, slow > 24 f loses the punch. B: slam ease-in not ease-out ("slam" vs "set down"); spring damping 14 on rebound; ring 120 to 1500 px in 16 f, fragments fly 280-580 px (original sizes were invisible: scale up by 1.5-2x), shake 18 px vertical-biased, 2 f flash. Use linear time for fade-out, ease-out only for spread, or the ring is gone before it opens.
- Light grounds need a white pressure disc under the ring with a saturated ring; black rings on dark and white on light are invisible.
- Hold >= 45 f after the landing (twice a normal hold). One shake source per shot, one slam flavour per shot, at most two slams per film (three and none of them land).

## Sound for it
Pin the sound on the same frame: `impact_slam` (-6 dB) + `sub_drop` (-12 dB) on the landing, `whoosh_short` peaking at impact; a silent slam looks like a stutter.

## Common mistakes
- Neighbours moving on the same frame as the hero: reads as the whole page shaking. Delay 3 f.
- Throwing in the neighbours while they are still entering.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/effects/slam-entrance-moves.md` (Apache-2.0; see ../NOTICE).
