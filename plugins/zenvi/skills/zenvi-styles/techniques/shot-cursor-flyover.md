---
id: shot-cursor-flyover
kind: technique
summary: "When one screen holds several features: the camera pushes to each region in turn, led by a big pointer that clicks."
categories: [saas-app-launch, product-launch-film, tech-review, video-essay-explainer]
tools: [add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [guided, clear, confident]
aspect: ["16:9", "9:16"]
pairs_with: [shot-brake-scroll, shot-scan-annotate, kinetic-lower-third, shot-pullback-isolation]
avoid_with: [shot-station-flythrough, shot-overhead-tilt-drop, shot-tilted-plane-glide]
needs: []
---

# Cursor flyover (four features, one continuous camera)

## What it is
Instead of four cuts, one camera tours four regions of a single UI. An oversized pointer arrives first and "points",
clicks with a ripple, and the interface answers; a label names the region. Space stays continuous, so viewers also
remember where features live. Ends on a pull-back to the overview where possible.

## Build it in Zenvi
```json
add_motion_block_tool {"block":"cursor_path","position_seconds":0,"duration_seconds":6,
  "params":{"background":"<screenshot or screen-recording file id>",
            "points":[{"x":0.2,"y":0.25},{"x":0.78,"y":0.28},{"x":0.8,"y":0.78},{"x":0.22,"y":0.74}],
            "labels":["Media bin","Preview","Timeline","Export"],
            "zoom":1.3,"clicks":true,"cursor_size":1,"target":170}}
add_sfx_tool {"recipe":"mouse_click","at_seconds":1.1,"gain_db":-16,"seed":1}   // one per stop, new seed each
```
Order stops so neighbours are visited next to each other (top-left, top-right, bottom-right, bottom-left); diagonal
jumps feel nauseous. Points are fractions of the frame, re-pick them from the screenshot. With no `background` the block
draws its own editor screen. The block does not pull back at the end: add a closing `set_keyframes_tool`
scale move on the block clip only if the framing allows, or cut to a wide capture.

## Timing & taste rules
- 8 s at 30 fps: overview 22 f, then four stops of 44 f (flight 20 + hold 24), pull-back 24 f, hold 18 f.
- Cursor leads: it starts ~2 f before the camera and arrives ~6 f earlier. 0 = the pointer is dragged by the camera (screen-recording look); >10 f = viewers read the pointer, then search the picture.
- Click ripple 80 px, 18 f, scale 0.3 to 1.5, four clicks equally spaced. Press: pointer scales to 0.84 over 3 f, then overshoots back.
- Zoom so the text you need to read is >= 40 px high on screen; above ~1.6x the module leaves the frame. Hop (extra 8 % pull-out mid-flight) and light directional blur (cap 8 px).
- Motion blur above ~0.12 amount on bright UI reads as out-of-focus, not speed.
- Pointer is a constant 40 px on screen regardless of zoom.

## Sound for it
Click on each press (`mouse_click`, -16 dB, vary `seed`), a soft `whoosh_short` (-24 dB) per flight only if the music is thin. The UI answers (toggle, tooltip) deserve `toggle` / `pop` at -20 dB on the same frame.

## Common mistakes
- Real screenshots must be >= 1.3x native; blow-ups of a 1080p capture go soft.
- Moving the click earlier than the camera lands: the response gets eaten by blur.
- Changing aspect ratio without re-picking every point.

## Verified
2026-10-29, CLI on the block's built-in drawn editor screen (no footage): scripts/shot-cursor-flyover.sh → shots/shot-cursor-flyover.mp4 (local only). Checked on the sheet: overview, then four pushes each with a pointer, ripple and label pill; it ends on the last stop without pulling back, and the labels do not match the drawn controls under the pointer (use a real screenshot and put each point on the control it names). Watch judge (absolute): **6.4/10**; main note: "The final tooltip erroneously labels a timeline track as 'Export' instead of targeting the actual export button at the top right."

Adapted from video-shotcraft card `shots/camera/cursor-flyover.md` (Apache-2.0; see ../NOTICE).
