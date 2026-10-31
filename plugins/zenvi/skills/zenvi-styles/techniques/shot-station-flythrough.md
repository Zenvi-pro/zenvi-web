---
id: shot-station-flythrough
kind: technique
summary: "When a 3-4 step idea or command flow should be a trip through space: one camera visits each card or window in turn."
categories: [saas-app-launch, video-essay-explainer, animated-explainer, tech-review, product-launch-film]
tools: [add_title_tool, add_motion_block_tool, set_keyframes_tool, add_3d_scene_tool, add_sfx_tool]
pace: medium
mood: [curious, technical, confident]
aspect: ["16:9", "9:16"]
pairs_with: [shot-cursor-flyover, shot-pullback-isolation, kinetic-typewriter, kinetic-mask-reveal]
avoid_with: [shot-overhead-tilt-drop, shot-tilted-plane-glide, shot-exploded-layers]
needs: [perspective-plane-showcase]
---

# Station flythrough (cards in space, 3D terminal windows)

## What it is
Cards (or terminal windows) sit at different positions, sizes and angles in one space; a single camera flies to each,
lines up with it, and the world turns with it. The last station pulls back to an overview poster. Where it shines: roadmaps,
"three steps" explainers, a CLI workflow shot as three stops. The terminal variant types a command at each stop.

## Build it in Zenvi
Today's native camera is 2D (scale, location, rotation), so build the *flat* version and keep real Y/X tilt for later.
1. One clip per station on its own track: `add_title_tool {"template":"Gray_Box_1","text":"Step one\nOne line of detail","position_seconds":0,"duration_seconds":7.5}`
   (terminal stations: `add_motion_block_tool {"block":"code_card","params":{...},"position_seconds":3.0,"duration_seconds":2.5,"placement":"over_video"}`
   so the command types in after the camera has arrived).
2. The camera is the inverse of the station pose, applied to every clip: for camera at station k with zoom z,
   clip j gets `scale = z*s_j`, `rotation = r_j - r_k`, `location = R(-r_k)*(p_j - p_k)*z` (location is a fraction of the frame, negative = left/up).
   Write it with `set_keyframes_tool {"timeline_clip_id":"<id>","property":"scale_x"|"scale_y"|"location_x"|"location_y"|"rotation","points":[{"seconds":0,"value":1},{"seconds":0.93,"value":0.8,"ease":"ease_in_out_cubic"},{"seconds":1.86,"value":1.0,"ease":"ease_in_out_cubic"}]}`
   with keyframes at: arrive k (hold), depart k+1 s, arrive k+1.
3. Hop: add a mid-flight keyframe at about 77 % of the zoom so the camera pulls out 30 % between stops and other cards peek in.
4. Overview: last keyframe at zoom 1/2.7 = 0.37 with the poster text placed so the three cards sit top-right.
5. Real 3D alternative for the "cards float in depth" feel: `add_3d_scene_tool {"scene":"floating_cards","params":{"file_ids":["<id>"],"count":3,"fstop":2.8},"duration_seconds":4}`.
Missing: station tilt (Y/X rotation, `perspective-plane-showcase`) and the sideways 8-10 degree view of each terminal. Stay flat; do not fake with shear.

## Timing & taste rules
- Flights 28-32 frames (0.93-1.07 s), asymmetric ease (`ease_in_out_cubic`; start crisp, land soft). Stations hold >= 30 frames (1 s) plus reading time.
- Every station adds one new transform dimension (position, then rotation, then scale). One 90 degree frame-rotation per film.
- Dwell is never dead: creep +1.5 % scale while held, return on the next departure.
- Terminal variant: ~246 frames (8.2 s), two 30-frame flights, typing starts only after arrival (never during a flight); type 0.75-1.65 frames per character, 2-frame pause before Enter; output lines every 4-6 frames.
- Out-of-focus neighbours stay present (opacity floor 0.22), never black.

## Sound for it
`add_sfx_tool {"recipe":"whoosh_medium","at_seconds":<departure>,"pan":0.4,"gain_db":-20}` per flight (flip `pan` per direction); `keyboard_key`/`typing_burst` under the typing at -22 dB; one `pop` or `ui_tap` on the final overview.

## Common mistakes
- Camera rotation order wrong: the inverse is scale, then rotateZ, rotateY, rotateX, translate in reverse; mixed order only shows on multi-axis stations.
- Three places must agree (card pose, camera move, ground/shadow); change the pose table only.
- A rotated station hides its text until the camera straightens: keep its copy short.
- Typing while the camera flies splits attention.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft cards `shots/camera/basic-3d-scene.md` and `shots/camera/terminal-3d.md` (Apache-2.0; see ../NOTICE).
