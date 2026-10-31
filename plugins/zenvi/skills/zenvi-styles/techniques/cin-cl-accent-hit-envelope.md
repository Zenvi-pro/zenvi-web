---
id: cin-cl-accent-hit-envelope
kind: technique
summary: "When a button is pressed or an object lands: it floods with the accent for a frame, then bleeds back or stays."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_title_tool, add_shape_mask_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [tactile, snappy, decisive]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-accent-on-newest, shot-control-state-change, prompt-bar-typing-hero]
avoid_with: [cin-cl-mono-one-accent, cin-cl-accent-claim-grounds]
needs: []
drawn: cinetic
---

# Accent hit envelope

cinetic `cl-accent-hit-envelope` · Colour and light · accent · energy medium · formats feature, walkthrough, launch, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

On a press or an impact, the element floods with the accent and peaks for one frame with its label inverted, then either bleeds back like decaying light or stays as the new state.

Use when: Primary-button clicks, send or confirm moments, and contact hits that turn an object into its new state.

## Build it in Zenvi

1. The press itself: `add_motion_block_tool {"block": "toggle_panel", "position_seconds": 0, "duration_seconds": 5, "params": {"title": "Export", "rows": ["Render in 4K", "Add captions"]}}`, or `prompt_bar` with its pointer click on send. The cursor dips 1 to 0.9 to 1 over 12 f (0.2 s) inside the block.
2. Accent overlay on the button, clicked at 2.0 s: `add_title_tool {"text": " ", "background_color": "<accent>", "position_seconds": 2.0, "duration_seconds": 0.8, "track": "<above_block>"}`, then `add_shape_mask_tool {"clip_ids": ["<overlay>"], "shape": "ellipse", "x": 0.5, "y": 0.78, "width": 0.22, "height": 0.07, "feather": 0.01}` to shrink it onto the button.
3. Envelope in alpha: `set_keyframes_tool {"timeline_clip_id": "<overlay>", "property": "alpha", "points": [{"seconds": 2.0, "value": 0}, {"seconds": 2.17, "value": 1, "ease": "ease_out_cubic"}, {"seconds": 2.2, "value": 1}, {"seconds": 2.6, "value": 0, "ease": "ease_out_expo"}]}` (attack 10 f = 0.17 s, 1 f peak, release 24 f = 0.4 s).
4. Impact that changes state: leave the accent on, add a white flash `add_title_tool {"text": " ", "background_color": "#ffffffcc", "position_seconds": 2.0, "duration_seconds": 0.07, "fade_out_seconds": 0.07}` (0.8 alpha, about 4 f) and `add_sfx_tool {"recipe": "mouse_click", "at_seconds": 2.0, "gain_db": -12}`.

Fallback: The overlay mask is a feathered ellipse or rectangle, not a rounded rectangle with the button's exact corner radius; for pill buttons use the ellipse.

## Timing & taste rules

- cinetic's timing (60 fps): Attack 10-12 f (0.20 s), a 1 f (0.02 s) peak, then a release of 20-26 f (0.43 s) (tau 8): an asymmetric 1:2 envelope. On an impact, the swap takes 1 f (0.02 s), the white flash about 4 f (0.07 s) and the squash 8 f (0.13 s).
- Asymmetric envelope: attack 10-12 f (0.17-0.2 s), a 1 f peak, release 20-26 f (0.33-0.43 s), roughly 1:2.
- The label inverts (to ink) once the overlay passes 0.6 opacity.
- An impact swap takes 1 f, the white flash about 4 f (0.07 s), the squash 8 f (0.13 s); no ring blur, no outer halo.
- Save it for the decisive action only, not hovers or secondary controls.

## Sound for it

`add_sfx_tool {"recipe": "mouse_click", "at_seconds": 2.0, "gain_db": -12}` on the peak frame; a contact hit that changes state also gets `impact_thud` at -14 dB on the same frame.

## Common mistakes

- Using it on secondary controls and hovers, which cheapens the decisive press.
- Flooding on top of an accent ground: the hit disappears.
- Scaling the button as well as flooding it; the colour does the work.
- Avoid when: Secondary controls and hovers (save it for the decisive action), or when the accent already floods the ground.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-accent-hit-envelope`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
