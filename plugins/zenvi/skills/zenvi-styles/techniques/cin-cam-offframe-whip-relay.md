---
id: cin-cam-offframe-whip-relay
kind: technique
summary: "When the product jump is big: the cursor exits frame, the camera whips unseen, the cursor streaks back and brakes."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, apply_fx_tool, add_sfx_tool]
pace: fast
mood: [slick, energetic, hand-off]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-cursor-flyover, shot-brake-scroll, cin-cam-zoom-out-hop]
avoid_with: [cin-cam-reframe-to-subject, cin-cam-cursor-whip-orbit]
needs: []
drawn: cinetic
---

# Off-frame whip relay

cinetic `cam-offframe-whip-relay` · Camera · signature · energy high · formats walkthrough, feature, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The cursor accelerates up and out of frame, the camera whips down the product while it's hidden, and the cursor re-enters from the top as a fast streak that brakes onto its target.

Use when: A big spatial jump within one product (top bar to bottom bar, one page to another) that should feel like a match-on-action without a cut.

## Build it in Zenvi

1. The product recording on track 1. Cursor exit as a pointer block on an upper track: `add_motion_block_tool {"block": "cursor_path", "position_seconds": <a>, "duration_seconds": 0.4, "placement": "over_video", "params": {"points": [{"x": 0.5, "y": 0.5},{"x": 0.5, "y": -0.1}], "clicks": false, "cursor_size": 1.4}}`: 24 f (0.4 s) on an ease-in (2.5 to 15 px/f), then off screen for 12 f (0.2 s).
2. Camera whips while it is hidden, centred on `a + 30 f` (0.5 s), N = 2.86 x D / 75 frames: `set_keyframes_tool {"timeline_clip_id": "<product>", "property": "location_y", "mode": "replace", "points": [{"seconds": <a+0.15>, "value": 0}, {"seconds": <a+0.85>, "value": -0.9, "ease": "ease_in_out_sine"}]}` for D = 900-1400 px (0.8-1.3 of the frame height); 34-54 f (0.57-0.9 s), peak 60-75 px/f. Blur it: `apply_fx_tool {"clip_id": "<product>", "effects": [{"effect": "directional_blur", "amount": 0.6, "params": {"angle": 90}, "start": <a+0.3>, "end": <a+0.7>}]}`.
3. Cursor entry from the top: `add_motion_block_tool {"block": "cursor_path", "position_seconds": <a+0.6>, "duration_seconds": 0.6, "params": {"points": [{"x": 0.5, "y": -0.1},{"x": 0.62, "y": 0.55}], "clicks": true}}`: 36 f (0.6 s) on an ease-out, entering at ~63 px/f, braking ~x0.92 per frame.
4. While it moves faster than 12 px/f draw a trailing capsule: a thin white pill clip behind the tip at 40 % opacity, length 0.6 x speed (`alpha` 0.4).
5. `add_sfx_tool {"recipe": "whip", "at_seconds": <a+0.4>, "gain_db": -12}` and `{"recipe": "mouse_click", "at_seconds": <a+1.2>, "gain_db": -10}`.

## Timing & taste rules

- cinetic's timing (60 fps): Cursor exit 24 f (0.40 s) on ease_in_cubic (2.5 -> 15 px/f). Off screen 12 f (0.20 s). Camera 34-54 f (0.90 s) on ease_in_out_sine centred on the hidden window, peak 60-75 px/f. Cursor re-enters at about 63 px/f and brakes over 36 f (0.60 s) on ease_out_expo (speed ratio about 0.92 per frame).
- Cursor exit 24 f (0.4 s) on an ease-in (2.5 to 15 px/f); off screen 12 f (0.2 s).
- Camera 34-54 f (0.57-0.9 s) on a smooth ease, centred on the hidden window, peak 60-75 px/f.
- Cursor re-enters at ~63 px/f and brakes over 36 f (0.6 s) on an ease-out (x0.92 per frame).
- Trailing capsule 0.6 x speed long at 40 % opacity while faster than 12 px/f; blur handles the camera.
- Destination at least about a frame height away.

## Sound for it

A `whip` under the camera travel, a `mouse_click` when the cursor lands; nothing when it leaves.

## Common mistakes

- Films without a cursor, or destinations less than ~one frame height away (a plain reframe is enough) (avoid_when).
- Moving the camera while the cursor is still visible: the cursor must be off screen at the fastest stretch.
- Letting the cursor re-enter slowly: it should arrive streaked and brake.
- Avoid when: Films without a cursor, or destinations less than about one frame height away (a plain reframe is enough).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cam-offframe-whip-relay`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
