---
id: shot-exploded-layers
kind: technique
summary: "When a product page or screen is made of parts: layers lift apart along Z with labels, hover, then slam back together."
categories: [3d-product-cgi-ad, saas-app-launch, product-launch-film, tech-review]
tools: [add_3d_scene_tool, add_clip_to_timeline_tool, set_keyframes_tool, add_effect_tool, add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [engineered, premium, explanatory]
aspect: ["16:9"]
pairs_with: [shot-scan-annotate, kinetic-lower-third, kinetic-counter]
avoid_with: [shot-tilted-plane-glide, shot-overhead-tilt-drop, shot-station-flythrough]
needs: [exploded-view-3d]
---

# Exploded layers (parts float apart, then re-assemble)

## What it is
The page is shot as a 3D object: components (sidebar, chart, assistant panel, metrics, command bar) rise off the base plate along
its normal, staggered, hover with numbered callouts ("what is in it"), then drop back in reverse order with a thud. Where it
shines: architecture or module overview, "what's inside" beats in product films.

## Build it in Zenvi
No exploded-view tool (`needs: exploded-view-3d`); two partial routes:
- Real 3D: `add_3d_scene_tool {"scene":"card_stack","params":{"file_ids":["<layer 1>","<layer 2>","<layer 3>","<layer 4>","<layer 5>"],"animation":"fan","kind":"card","elevation":0.4,"shadow":true,"dof":true},"duration_seconds":4}`. Pre-cut the page into one still per component first (each layer an independent image; a single screenshot cannot explode).
- 2D stack: one clip per component on its own track; to fake lift animate `scale` 1.0 to 1.08 and `location_y` upward in fractions of the frame (higher layers first, farther-away layers lift more), each with its own `Shadow` effect whose `distance` and `blur_radius` grow with the lift.
  Callouts: `add_motion_block_tool {"block":"hud_callouts","params":{"labels":["Sidebar","Chart","Assistant","Metrics","Command bar"],"values":["01","02","03","04","05"],"points":[{"x":0.2,"y":0.3}],"grid":"none"},"position_seconds":1.2,"duration_seconds":3}`.
- Reassembly: stack in reverse order, 14 f `ease_in_cubic` per layer with 3 f stagger; callouts leave first (8 f `ease_in`); land with a settle 8 px down and back and the contact shadow tightening; a sweep of light across the page afterwards.

## Timing & taste rules
- 5.7 s total. Explosion distances 150 / 270 / 400 / 520 / 640 (relative layer heights), stagger 5 f, spring-like settle (damping ~15). Layers farther from the camera lift higher or lower ones hide the upper ones.
- Axonometric lay-flat (54 deg X, -34 deg Z) reads as an exploded diagram; a gentle tilt just reads as "floating". Hover orbit +10 deg and tighten pitch 4 deg so parallax shows depth.
- Depth cues all three: shadow per layer on the plate, visible thickness edge, dotted empty slots on the plate. Without them the layers look like unrelated stickers.
- Callout labels >= 32 px tall; leader lines leave from the layer's outer edge midpoint, never through other layers; draw 8 f, rise 12 f, stagger 6 f.
- No screen shake on the landing; sink + shadow tighten is the "clunk".
- Two big space moves per film at most.

## Sound for it
`riser_tonal` quiet under the lift, `keyboard_key` or `ui_tap` per label, `impact_thud` (-12 dB) on re-assembly.

## Common mistakes
- Fluid-layout screenshots: components must be cut as separate images before lift.
- Leader lines through other layers.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/camera/space-camera-moves.md` (exploded-view) (Apache-2.0; see ../NOTICE).
