---
id: shot-tilted-plane-glide
kind: technique
summary: "When a long UI should be shown as terrain: a steep-angled page slides past, text floating above it then settling."
categories: [saas-app-launch, product-launch-film, 3d-product-cgi-ad, tech-review]
tools: [add_3d_scene_tool, set_keyframes_tool, add_effect_tool, add_clip_to_timeline_tool]
pace: medium
mood: [premium, dark, neon, technical]
aspect: ["16:9"]
pairs_with: [shot-glow-flyline, shot-light-sweep, kinetic-mask-reveal]
avoid_with: [shot-station-flythrough, shot-overhead-tilt-drop, shot-multiplane-slider, shot-exploded-layers]
needs: [perspective-plane-showcase, planar-surface-track-overlay]
---

# Tilted plane glide (steep page, floating text that lands)

## What it is
Two sibling moves on one idea, a UI shot as landscape. (a) Steep tilt glide: the camera is locked; a wide page stands at a
strong ~60 degree angle (right edge near the lens, left edge vanishing) and slides sideways along its own plane, like train
cars passing; the frame goes from dark to lit. (b) Graze tour: the camera skims low over the interface, sidebar tree, header
and list rows as terrain, while text sits above the surface and drops onto it as the camera passes. The shadow of the floating
text is what sells the height.

## Build it in Zenvi
There is no free rotateX/Y plane or corner-pin (`needs: perspective-plane-showcase`). What exists:
- Closest real-3D: `add_3d_scene_tool {"scene":"device_mockup","params":{"device":"laptop","file_id":"<screen recording>","move":"push","dof":true},"duration_seconds":5}`
  gives a screen on a tilted device with depth of field; `floating_cards` (`file_ids`, `count`, `fstop`) gives tilted cards in depth.
- Flat approximation of the *landing text*: for each text block add a title clip and animate `set_keyframes_tool property=scale_x/scale_y`
  from 1.12 to 1.0 with `ease_in_cubic` (gravity: accelerate, soft landing, no bounce), a drop `Shadow` effect
  (`add_effect_tool {"effect":"Shadow","properties":{"distance":18,"blur_radius":24,"opacity":0.5}}`) animated
  to `distance` 0 / `opacity` 0 at touchdown by the same keyframes, and `alpha` 0 to 1 over 6 frames. Stagger touchdowns along the travel direction (first passed lands first), overlapping, never in series.
- Finish with `add_vignette_tool {"amount":0.45}` and a rim light via a neon accent outline in the screenshot itself.

## Timing & taste rules
- Steep tilt: camera constants, only the page moves (translateX 60 to -4100 in page px over 120 f, bezier 0.3,0.12,0.72,0.9 so the tail never stops dead); angle -60 degrees is the identity (55-65 ok; -45 looks wrong, > 70 unreadable); page >= 3 screens wide; 3 ghost trails at 1.6 / 3.2 / 4.8 frames behind, opacity proportional to speed.
- Reveal from 0.7 dark to full in ~1.4 s; the left edge shades out with the vanishing point.
- Graze tour: float height 120-180 px (under 80 nothing reads, over 250 lands too heavy); shadow blur/offset/opacity track height; touchdown staggered 0.2 to 0.85 along the path; crossfades between segments >= 8 f or you get a black frame.
- Lift floating elements ~1.3x brighter than the environment or they vanish in the dark band.
- Moving camera vs moving page: pick one per scene.

## Sound for it
Low continuous `whoosh_long` (pan across) at -26 dB; soft `ui_tap` at each touchdown, -24 dB, 2-3 frames apart.

## Common mistakes
- Shadow constant while the element falls: sticker look. It must shrink to zero at touchdown.
- Serial landings (one waits for the other) read as slow; staggered starts with overlapping falls read as flow.
- Using the camera-moving version and the page-moving version in the same scene.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft cards `shots/camera/steep-tilt-glide.md` and `shots/camera/graze-face-tour.md` (Apache-2.0; see ../NOTICE).
