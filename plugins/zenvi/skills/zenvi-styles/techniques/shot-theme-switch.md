---
id: shot-theme-switch
kind: technique
summary: "When a theme or dark mode is the feature: the same UI changes skin before the eyes, swept or rippled out from the cause."
categories: [saas-app-launch, product-launch-film, tech-review, animated-explainer]
tools: [add_shape_mask_tool, add_sfx_tool, set_keyframes_tool]
pace: medium
mood: [smooth, satisfying, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-control-state-change, shot-type-and-filter]
avoid_with: [shot-picker-carousel]
needs: [keyframed-polygon-mask]
---

# Theme switch on screen

## What it is
Two captures of one identical layout (light and dark) are stacked; the top one is revealed from the point that caused the change, so the viewer sees the
same UI re-skin in place, not a cut to a new scene. A: a slanted dawn/dusk edge sweeps the frame from the toggle. B: a command palette shrinks to a point
and a dark ripple opens from that point.

## Build it in Zenvi
Capture BOTH themes for real (a filter-inverted dark is wrong: images invert). Light take on the lower track, dark take above it, both full length. B, verified:
```json
add_shape_mask_tool {"clip_ids": ["<dark_clip>"], "shape": "ellipse", "x": 0.72, "y": 0.35, "width": 2.0, "height": 2.0, "feather": 0.03,
  "keyframes": [{"seconds": 0.6, "grow": -0.8}, {"seconds": 1.7, "grow": 0}]}
add_sfx_tool {"recipe": "ui_tap", "at_seconds": 0.55, "gain_db": -8}
add_sfx_tool {"recipe": "whoosh_medium", "at_seconds": 1.0, "gain_db": -8}
```
Centre (x, y) = the cause (toggle, shrunk palette). `width`/`height` are capped at 2 frame sizes, so an off-centre origin must keep the whole frame inside the
ellipse at grow 0: with the origin at the far top-right a corner stays light; keep the origin near the middle or end at a positive grow. A (slanted edge): there
is no polygon-angle mask (`needs: keyframed-polygon-mask`); use a `rectangle` mask on the dark take growing from the switch side, and a thin white line still riding the edge.
Reveal "night-only" lights afterwards (a today pill, a now line, window rim light) via `alpha` keyframes, one at a time.

## Timing & taste rules
- Cause then effect inside ~6 frames: the edge/ripple starts at the toggle within 6 frames of the press; a start more than 10 frames later loses the cause.
- Ripple front: strong ease-out, 3 px white-hot ring with a coral outer glow, an echo ring 4 frames later; sweep 64 frames, bezier (0.3, 0, 0.35, 1).
- Final radius about 1.1x the farthest corner distance; much larger and the front is a flash in the first frames.
- Camera starts close on the toggle and pulls out to the full UI (30-40 frames) so day and night are visible together on the poster frame.
- Both layouts pixel-identical; any difference reads as a page change.
- At most one theme switch per film. It is the feature, not a transition.
- Do not add a full-frame white flash on top.

## Sound for it
A: one long `whoosh_long`. B: a confirm `ui_tap` (-8) on enter, then `whoosh_medium` as the ripple opens. Keep both under the music.

## Common mistakes
- A dark version made by inverting the light capture.
- The reveal circle centred on the screen rather than on the cause.
- A ripple that is too fast to see: the test render needed `grow` to start at -0.8 (not -0.98) to stay visible for ~0.5 s.

## Verified
2026-10-29, CLI on generated light/dark dashboard mocks (identical layout): scripts/shot-theme-switch.sh → shots/shot-theme-switch.mp4 (local only). Checked on the sheet: light UI holds, a dark ellipse opens from the upper right and covers the frame, dark holds; the ripple was too quick with grow -0.98 so it starts at -0.8. Watch judge (absolute): **4.7/10**; main note: "The circular wipe transition effectively demonstrates the theme swap... However, the motion of the mask expansion feels abruptly cut off before fully clearing the canvas, leaving visual artifacts on the bottom left corner."

Adapted from video-shotcraft card `shots/interaction/theme-switch-moves.md` (Apache-2.0; see ../NOTICE).
