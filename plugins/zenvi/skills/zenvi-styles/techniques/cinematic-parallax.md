---
id: cinematic-parallax
kind: technique
summary: When a still or locked shot should feel 3D - foreground and background drift at different speeds; needs a clean plate.
categories: [documentary-true-story, video-essay-explainer, travel-cinematic-montage, movie-game-trailer, real-estate-tour]
tools: [replace_background_tool, set_keyframes_tool, generate_subject_matte_tool]
pace: calm
mood: [immersive, reflective, cinematic]
aspect: ["16:9", "9:16", "2.39:1"]
pairs_with: [cinematic-push-in, cinematic-title-sequence, cinematic-film-emulation]
avoid_with: [cinematic-dolly-zoom, cinematic-whip-cut]
needs: [clean-plate-inpaint, parallax-layer-camera-rig, photo-depth-layer-parallax]
---

# 2.5D parallax

## What it is

The subject is lifted off its background and the two planes move at different speeds, so a
photo or a static shot gains depth (the documentary "Ken Burns in 3D" move). Shines on archival
photos, portraits in a landscape, title backgrounds.

`shot-depth-layer-moves` (multi-layer parallax slider for graphics) is merged here; this file is the one id. Graphics layers have no clean-plate problem, so that path works today.

## Build it in Zenvi

Not buildable cleanly today. The layers exist: `replace_background_tool` `{"clip_id",
"background": "blur", "blur": 3}` puts the person (subject matte) over the footage; then
`set_keyframes_tool` moves the planes differently (background `location_x` 0.012 -> -0.012,
person 0.004 -> -0.02, both `scale` >= 1.04). But the background layer still contains the
person, so any difference between the planes shows a second, offset copy of them (the ghost).
Missing: `clean-plate-inpaint` (fill the hole the person leaves), `photo-depth-layer-parallax`
(GAPS #35, depth layers from one image) and `parallax-layer-camera-rig` (GAPS #28).

Fallback that looks good today (one plane, still "camera"):
1. `cinematic-push-in`: `scale` 1.0 -> 1.08 plus `location_x` 0.02 -> -0.02 over the shot (a slow
   lateral slide-and-push).
2. For a real foreground layer, use footage with a natural foreground (leaves, a window frame)
   and push in - the lens gives the parallax.

## Timing & taste rules

- 4-5.5 s, linear or very gentle ease; the planes never change direction.
- Foreground moves 1.5-2x the background's distance.
- Layer speeds 0.35 / 0.7 / 1.4 of the camera move (+ 0 for type), at least 2x between neighbouring layers or the depth is unreadable; <= 4 layers (video-shotcraft, Apache-2.0, `shot-depth-layer-moves`).
- Anchor the depth: blur the nearest and farthest layer, desaturate the back, add haze; without anchors it reads as stickers sliding.
- End the slide on the subject centred, then give it a beat (a 1.03 lift); an endless slide reads as a screensaver.
- Graphics path today: separate image / title / motion-block clips on stacked tracks, one `set_keyframes_tool` `location_x` ramp per layer scaled by the factors above.

## Sound for it

Room tone or the bed; a soft `swish_airy` only if the move is fast.

## Common mistakes

- Shipping the ghost (watch the render at full size).
- Parallax on a moving camera shot (two motions fight).

## Verified

2026-10-28, `tech/parallax` (person in a field seen through a doorway; 4 s 720p24). At 3 % plane
difference two people were visible; at 1 % the judge still saw "an awkward ghosted clone rather
than a convincing 2.5D multiplane camera push" (overall 3.0). Hence `needs:` and the fallback.
