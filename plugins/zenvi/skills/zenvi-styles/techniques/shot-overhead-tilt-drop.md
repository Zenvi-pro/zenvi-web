---
id: shot-overhead-tilt-drop
kind: technique
summary: "When pitch should tell the story: a page tilts up from a sliver to flat, or a tabletop of pages dives onto one."
categories: [saas-app-launch, product-launch-film, brand-story-corporate, 3d-product-cgi-ad]
tools: [add_3d_scene_tool, set_keyframes_tool, add_vignette_tool, add_sfx_tool]
pace: medium
mood: [cinematic, tactile, confident]
aspect: ["16:9"]
pairs_with: [shot-cursor-flyover, shot-brake-scroll, kinetic-lower-third]
avoid_with: [shot-station-flythrough, shot-tilted-plane-glide, shot-exploded-layers, shot-pullback-isolation]
needs: [perspective-plane-showcase]
---

# Overhead tilt reveal / tabletop drop / drone dive

## What it is
Three moves where the camera's pitch carries the meaning, for one section opener or transition (one per film).
A) Tilt-reveal: a page lies almost flat; at first only a thin glowing band of its far edge shows, then the camera "lifts its head"
to straight-on and content rushes into view. B) Tabletop drop: three pages lie on a dark desk, the overhead camera slides over them,
pauses on the pick, then dives and rights itself to a full-frame. C) Drone dive: a bird's-eye view of the whole page plunges onto the hero card and brakes.

## Build it in Zenvi
True pitch needs a perspective plane (`needs: perspective-plane-showcase`). Real 3D, approximately: 
`add_3d_scene_tool {"scene":"device_mockup","params":{"device":"tablet","file_id":"<capture>","move":"push"},"duration_seconds":4}`
or `floating_cards`. Flat fallback for the tabletop drop (B), which needs no tilt to read:
1. Three cards as stills on three tracks, side by side on a dark base (a `Solid_Color` title with `background_color`), each with a drop `Shadow` effect (`add_effect_tool`).
2. Pan: `set_keyframes_tool property=location_x` on all three, 0 to -0.4 over 1.7 s, `ease_in_out_sine`. Angle stays constant during the pan.
3. Pick beat: 8 frames still; the chosen card lifts (scale 1.03, brighter), the other two dip to 35 % `alpha`.
4. Drop: the chosen card `scale_x/scale_y` 1 to 2.04 (3-channel move with the rotation if any, one curve, 5 % anticipation dip first), `location_x` to 0, others fall away. Land, then +1.2 % creep.
5. For C (dive) use the same single curve: scale 0.42 to 1.35 over 25 f `ease_in_cubic` eating 82 % of the travel, then 20 f `ease_out_quint` for the last 18 % ("air cushion"), directional blur on the rush via `apply_fx_tool` `directional_blur`.

## Timing & taste rules
- A: 4 s; tilt 86 degrees to 0 in ~40 f with a -2.2 degree overshoot (max 3) and a soft return; point of view stays above the page plane or you see the back (mirrored text).
- B: 4.7 s; pan 50 f, pick 8 f, drop 28 f (58-86), then 47 f of a small in-page motion and +1.2 % creep. Pan angle and drop angle are two jobs; never animate angle during the pan.
- C: 3.5 s; 82/18 speed split matters more than frame counts; hero shows hi-res (rasterise at 1.35x).
- A and a crane/rise opener in one film cancel each other; one camera operator per section.

## Sound for it
`whoosh_fall` for the dive, `impact_thud` (-14 dB) at touchdown, quiet `riser_noise` under the pan.

## Common mistakes
- Dead stillness after landing (47 f of nothing): add a small in-page action or creep.
- Floor with no reference (hairline grid, pool of light) and the pan reads as the pages moving, not the camera.
- Backface artefacts at steep angles: pages need a thickness / backface hidden.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft cards `shots/camera/overhead-camera-moves.md` and `shots/camera/space-camera-moves.md` (drone-dive) (Apache-2.0; see ../NOTICE).
