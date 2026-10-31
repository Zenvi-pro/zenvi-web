---
id: cin-ui-anchor-point-spawn
kind: technique
summary: "When a click opens a menu or card, it grows out of the exact point that caused it and collapses back into it."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [set_keyframes_tool, add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [precise, responsive, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-mi-guide-cursor-hover-press, cin-ui-outline-led-reveal, shot-control-state-change]
avoid_with: [cin-pd-device-rise-on-cut, shot-slam-entrance]
needs: []
drawn: cinetic
---

# Spawn from the anchor point

cinetic `ui-anchor-point-spawn` · UI choreography · workhorse · energy medium · formats walkthrough, feature, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Menus, popovers, drop targets and detail cards scale out of the exact point that caused them, such as the cursor tip or a map pin, and collapse back into it.

Use when: Any UI that opens from a click, or a drag target appearing: menus, popovers, dialogs, drop zones, cards from a map pin.

## Build it in Zenvi

1. The menu, popover or card is its own clip (image of the real UI). Pin its scale origin to the trigger: `set_keyframes_tool {"timeline_clip_id": "<menu>", "property": "origin_x", "points": [{"seconds": 1.0, "value": <trigger_x_in_clip>}]}` and the same for `origin_y` (cursor tip, pin base or button edge, as 0-1 across the clip).
2. Small surface: `set_keyframes_tool {"property": "scale_x", "points": [{"seconds": 1.0, "value": 0.05}, {"seconds": 1.2, "value": 1.0, "ease": "ease_out_expo"}]}` (12 f = 0.2 s, add 2 f / 0.03 s per extra 100 px of size), same for `scale_y`, and `alpha` 0 to 1 in 4 f (0.07 s). No overshoot.
3. Reframe toward the surface 2 f (0.03 s) later over 20-40 f (0.33-0.67 s): `set_keyframes_tool {"property": "scale_x", "timeline_clip_id": "<scene>", "points": [{"seconds": 1.03, "value": 1.0}, {"seconds": 1.5, "value": 1.12, "ease": "ease_in_out_sine"}]}` on the recording behind it.
4. Large surface (a drop target filling a panel): scale 0.036 to 1 over 48 f (0.8 s) `ease_in_out_sine`, flat accent fill, 12 px radius (`corner_radius`), icon and hint fade in over the last 8 f (0.13 s); collapse back over 36 f (0.6 s).
5. The cursor stays parked on the trigger during the spawn (`add_motion_block_tool {"block": "cursor_path", "params": {"background": "<screen>", "points": [...], "clicks": true}}` or a pointer clip), and `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 1.0, "gain_db": -22}`.

## Timing & taste rules

- cinetic's timing (60 fps): Small: 12 f (0.20 s) (lmix, ease_out_expo) from 0.05, opacity 4 f (0.07 s), far edge ~63 px/f for a 300 px menu; camera reframe from +2 f (0.03 s) over 20-40 f (0.67 s) (ease_in_out_sine). Large: 48 f (0.80 s) (lmix, ease_in_out_sine) from 0.036, hint over the last 8 f (0.13 s), collapse 36 f (0.60 s) (ease_in_out_sine).
- Start scale at 0.05 (0.036 for a large surface) so the far edge does not jump on frame 1; opacity reaches 1 within 4 f (0.07 s).
- Small surface 12 f (0.2 s) on ease_out_expo, no overshoot, +2 f (0.03 s) per extra 100 px; large 48 f (0.8 s) on ease_in_out_sine.
- Far edge about 63 px/f for a 300 px menu; collapse 36 f (0.6 s).
- Reframe starts 2 f (0.03 s) after the spawn and runs 20-40 f (0.33-0.67 s).

## Sound for it

One ui_tap or toggle at -22 dB on the click frame; none on the collapse.

## Common mistakes

- The element enters from off-screen or is a full window: use a rise-in.
- The trigger point is out of frame, so the origin has nothing to grow from.
- Origin left at the centre: the element then blooms from the middle instead of from its cause.
- Avoid when: The element enters from off-screen or is a full window (rise-in), or the trigger point is out of frame.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ui-anchor-point-spawn`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
