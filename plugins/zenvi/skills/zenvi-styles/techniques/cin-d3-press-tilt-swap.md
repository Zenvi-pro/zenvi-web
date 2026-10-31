---
id: cin-d3-press-tilt-swap
kind: technique
summary: "When a click needs weight: the card tips toward the press point, the content swaps on the tilt's peak, then it relaxes."
categories: [cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, add_clip_to_timeline_tool, add_sfx_tool]
pace: calm
mood: [tactile, subtle, demo-ready]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-control-state-change, prompt-bar-typing-hero, cin-ps-machine-grid-human-gaps]
avoid_with: [shot-slam-entrance]
needs: [card-flip-3d]
drawn: cinetic
---

# Press tilt that hides a swap

cinetic `d3-press-tilt-swap` · Depth and 3D · accent · energy calm · formats walkthrough, feature, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A card tips in 3D toward the point that was clicked or tapped and relaxes back flat. The content changes on the tilt's peak frame, so the change has a physical cause.

Use when: Clicks, copies, likes and swaps in a UI walkthrough that need tactility without a flash.

## Build it in Zenvi

1. Card with a cursor press at time c = 2.0 s: `add_motion_block_tool {"block": "cursor_path", "position_seconds": 0.5, "duration_seconds": 3, "placement": "over_video", "params": {"background": "<card>", "points": [[0.4, 0.5], [0.62, 0.62]], "clicks": true}}`.
2. Tilt toward the press point (direction = the press offset from the card centre): amplitude 10 deg, in over 8 f (0.13 s), decay with tau 9 f (0.15 s). 2D approximation: `set_keyframes_tool {"timeline_clip_id": "<card>", "property": "shear_x", "mode": "replace", "points": [{"seconds": 2.0, "value": 0}, {"seconds": 2.13, "value": 0.1, "ease": "ease_out_expo"}, {"seconds": 2.6, "value": 0, "ease": "ease_out_cubic"}]}` plus `scale_y` 1.0, 0.98, 1.0 and `rotation` 0, 1.2, 0 on the same times; under 1 deg by about f30 (0.5 s).
3. Swap the state on the peak frame c + 8 f (2.13 s): the button fill and label, a photo source, a value. Place the second state as a clip starting exactly there: `add_clip_to_timeline_tool {"file_id": "<card_after>", "position_seconds": 2.13, "duration_seconds": 1.5, "track": 2}` over the first, with no transition.
4. Quick snap variant: `shear_x` 12 degrees' worth (0.12) with attack 1 f and tau 2.5 f (0.04 s), swap on the peak, repeated every 54 f (0.9 s) as a rhythm.
5. No counter-swing: overshoot belongs only to true landings. `add_sfx_tool {"recipe": "mouse_click", "at_seconds": 2.0, "gain_db": -16}`.

Fallback: No true 3D tilt; shear, a small squash and a 1 degree rotation give the dip without perspective.

## Timing & taste rules

- cinetic's timing (60 fps): Press at 10 deg: 8 f (0.13 s) in, tau 9 f (0.15 s) (under 1 deg by about f30 (0.50 s)). Snap rock at 12 deg: attack 1 f (0.02 s), tau 2.5 f (0.04 s), settled in about 8 f (0.13 s). Swap on the peak frame; repeat cadence 54 f (0.90 s); often preceded by a 24 f (0.40 s) ease_in_out_sine push-in.
- Press at 10 deg: 8 f (0.13 s) in, tau 9 f (0.15 s), under 1 deg by about f30 (0.5 s).
- Snap rock 12 deg: attack 1 f, tau 2.5 f (0.04 s), settled in about 8 f (0.13 s); swap on the peak; cadence 54 f (0.9 s).
- Often preceded by a 24 f (0.4 s) push-in.
- Use it for 1-3 key presses.

## Sound for it

A mouse_click on the press frame, a soft pop on the swap if the swap is the feature.

## Common mistakes

- Every click in the film tilting: use it for 1-3 key presses.
- A tiny chip as the target: the tilt cannot be seen.
- A counter-swing after the tilt: it makes the card feel like jelly.
- Avoid when: Every click in the film already tilts (use it for 1-3 key presses), or the target is a tiny chip where the tilt cannot be seen.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`d3-press-tilt-swap`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
