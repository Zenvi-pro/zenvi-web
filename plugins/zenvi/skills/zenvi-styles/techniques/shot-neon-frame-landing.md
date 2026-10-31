---
id: shot-neon-frame-landing
kind: technique
summary: "When a dark UI panel needs a ceremony: a neon frame draws first, then the page lights and its parts land from above."
categories: [saas-app-launch, product-launch-film, movie-game-trailer, 3d-product-cgi-ad, gaming-montage]
tools: [add_motion_block_tool, add_3d_scene_tool, set_keyframes_tool, add_effect_tool, add_vignette_tool, apply_fx_tool, add_sfx_tool]
pace: medium
mood: [neon, cinematic, techy]
aspect: ["16:9", "9:16"]
pairs_with: [T005, shot-contact-shadow-lift, kinetic-scramble-decode]
avoid_with: [shot-outline-trace-reveal, shot-bento-light-up]
needs: [neon-tube-frame, perspective-plane-camera]
---

# Neon frame, then the page lands

## What it is
Two variants of one ceremony. A strong-perspective right-angled neon frame runs in from the left edge (two white-hot heads running
up and down, meeting at the right edge with a flash) and closes; then the page inside brightens from black while its components fall in
from above on soft matching shadows. Variant A: the camera is fixed, the parts land staggered (sidebar top to bottom, then main area:
dense first, sparse after), finishing just after the light-up. Variant B: the camera sweeps in an arc from the left side of the
page to the right while ALL parts and text descend together and snap flush on the same frame, shadows converging together. Behind both,
a tunnel of echoes of the same frame lights up from near to far, then goes out from the middle outwards to give the page the light.

## Build it in Zenvi
No neon tube or perspective-plane camera (`needs: neon-tube-frame, perspective-plane-camera`). What works today:
- Page = a UI capture clip; open it: `set_keyframes_tool` `alpha` 0 to 1 and a brightness rise (`add_effect_tool {"effect": "Brightness", "properties": {...}}` with keyframed brightness, plus `add_vignette_tool` for the dark corners), after the frame has closed.
- Parts landing: split the UI into 4-8 layer clips (sidebar, header, cards, rows), each `set_keyframes_tool` `location_y` -0.12 to 0, `scale_x`/`scale_y` 1.06 to 1, `alpha` 0 to 1,
  24 f each, `ease_in_cubic` into a soft landing: stagger for variant A (54 to 104 f), **zero stagger** for variant B.
- Camera arc: a slow `location_x` and `scale_x`/`scale_y` push on the page group; for true rotation use `add_3d_scene_tool {"scene": "device_mockup"}` with an orbit
  (a screen on a device, not a free page).
- Frame stand-in: `add_motion_block_tool {"block": "hud_callouts", "params": {"grid": "none"}}` for frame ticks, or a colour-bordered clip; add glow with `apply_fx_tool` `bloom`.
- `add_sfx_tool`: `whoosh_medium` on the frame runs (-16 dB), `impact_thud` at the closing flash, `sparkle` as the page lights, soft `ui_tap`s on landings.

## Timing & taste rules
- Frame run 20 f (14 f in variant B), two heads meeting; one head reads as a drawing, over 30 f the viewer waits for content.
- Page fades up 16-30 f after the frame closes, then dark to light over 60 f.
- Hover height 120-170 px (100-180 for variant B) with a shadow that grows, blurs and fades with height; shadows too small or started too early are invisible (the card's version had to be enlarged 1.7x and delayed).
- Landing 24 f per part, finishing about 20 f after the light is on (landing first = furniture in a dark room).
- Variant A staggers (overlapping, density front-loaded); variant B is the opposite: **no** stagger, all parts on one frame. Stagger in B reads as a tour, simultaneity in A reads as a flat fade.
- Echo tunnel: light up near to far, go out middle-first, 6 f flicker per layer, 7 f between layers; never all out on the same frame.
- Use one variant per segment; same frame language twice looks like repeated slide transitions.
- Never put filter or opacity on a 3D parent; set brightness on leaf elements.

## Sound for it
`whoosh_medium` per head on the frame runs, `impact_thud` at the closing flash, `sparkle` while the page lights, a soft `ui_tap` on landings (every 2nd).

## Common mistakes
- Lighting the page before the frame has closed; or letting parts finish before the light does.
- A flat frame with no perspective (reads as a border); glow made by blur filters (use stacked strokes).
- Camera arc in variant B that is a shake rather than an arc (small angle).

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft cards `shots/ui-entrance/neon-frame-forerun.md` and `shots/ui-entrance/neon-frame-orbit-drop.md` (Apache-2.0; see ../NOTICE).
