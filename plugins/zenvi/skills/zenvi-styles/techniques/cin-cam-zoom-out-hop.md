---
id: cin-cam-zoom-out-hop
kind: technique
summary: "When travelling between two distant areas: ease back as it sets off, cross wide enough to see both, push in on arrival."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [set_keyframes_tool, apply_fx_tool, add_kinetic_title_tool, add_sfx_tool]
pace: medium
mood: [orienting, smooth, spatial]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-cursor-flyover, cin-cam-offframe-whip-relay, shot-brake-scroll]
avoid_with: [cin-cam-reframe-to-subject, cin-cam-cursor-whip-orbit]
needs: []
drawn: cinetic
---

# Zoom-out hop between areas

cinetic `cam-zoom-out-hop` · Camera · workhorse · energy medium · formats walkthrough, feature, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

To travel between two distant parts of one product, the camera eases back as it sets off, crosses at a wider framing that shows where it is going, and pushes back in as it arrives.

Use when: Single-take and walkthrough films moving between two areas of one surface more than about a frame width apart (sidebar to canvas, one dashboard panel to another), where the viewer should see how they relate.

## Build it in Zenvi

1. Distance D between areas A and B (more than a frame width apart; example D = 1,800 px at k = 1). Pan with the dip: `set_keyframes_tool {"timeline_clip_id": "<screen>", "property": "location_x", "mode": "replace", "points": [{"seconds": <a>, "value": 0}, {"seconds": <a+1.2>, "value": -0.9, "ease": "ease_in_out_sine"}]}` over N = A.k x D / 34 frames at depth 0.45 (or / 25 at depth 0.15-0.25): about 76 f for 2,600 px at k = 1, 106 f for 1,800 px at k = 2, 72 f for 1,800 px at k = 1.
2. The dip on linear time, so the pull-back starts before the pan gathers speed and the push-in finishes after it slows: `scale_x` / `scale_y` `[{"seconds": <a>, "value": 1.0}, {"seconds": <a+0.6>, "value": 0.55, "interpolation": "linear"}, {"seconds": <a+1.2>, "value": 1.0, "interpolation": "linear"}]` with the zoom rate peaking at 1-2.6 %/f a quarter of the way in and out (use `ease_in_out_sine` on the two halves).
3. depth = clamp(1 - 0.7 x W / (A.k x D), 0.15, 0.45) so both areas share the frame at mid-move. Keep the frame edge under ~60 px/f; beyond ~120 f cut instead.
4. Smear the middle: `apply_fx_tool {"clip_id": "<screen>", "effects": [{"effect": "directional_blur", "amount": 0.4, "params": {"angle": 0}, "start": <a+0.35>, "end": <a+0.85>}]}`.
5. B's caption in the last 25 % of the move: `add_kinetic_title_tool {"text": "Then the canvas", "position_seconds": <a+0.9>, "duration_seconds": 2, "animation": "rise"}`. `add_sfx_tool {"recipe": "whoosh_medium", "at_seconds": <a+0.3>, "gain_db": -14}`.

## Timing & taste rules

- cinetic's timing (60 fps): Pan on ease_in_out_sine over N = A.k x D / 34 f (0.57 s) at depth 0.45, or A.k x D / 25 at 0.15-0.25: about 76 f (1.27 s) for 2,600 px at k = 1, 106 f (1.77 s) for 1,800 px at k = 2, 72 f (1.20 s) for 1,800 px at k = 1. Dip on linear time, depth 0.15-0.45, its zoom rate peaking at 1-2.6%/f a quarter of the way in and out. Frame edge at most about 60 px/f. Beyond about 120 f (2.00 s), cut instead (cam-offframe-whip-relay or cam-punch-in-insert).
- Pan on a smooth ease over N = A.k x D / 34 f at depth 0.45, or / 25 at 0.15-0.25: about 76 f (1.27 s) for 2,600 px at k = 1.
- Dip on linear time, depth 0.15-0.45; zoom rate peaking at 1-2.6 %/f a quarter of the way in and out.
- The frame edge peaks 28-40 % lower than the same pan without the hop; at most ~60 px/f.
- Beyond ~120 f (2 s) cut instead of hopping.
- B's caption starts in the last 25 % of the move.

## Sound for it

A medium whoosh peaking mid-move, no hit on arrival (the caption has its own tick if any).

## Common mistakes

- Areas less than a frame width apart, a cursor that should lead the move, or a cluttered or unfinished wide view (avoid_when).
- Driving the dip on the pan's eased progress: it then lags the speed, so the widest frame is not the fastest.
- A depth so deep both areas are tiny.
- Avoid when: Areas less than about a frame width apart (cam-reframe-to-subject), a cursor that should lead the move (cam-cursor-whip-orbit), or a wide view that is cluttered or unfinished, since the hop shows it.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cam-zoom-out-hop`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
