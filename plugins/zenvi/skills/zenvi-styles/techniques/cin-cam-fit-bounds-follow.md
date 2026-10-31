---
id: cin-cam-fit-bounds-follow
kind: technique
summary: "When a graph or route builds piece by piece: the camera widens just enough to keep it all in frame."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, screen_zoom_follow_tool]
pace: calm
mood: [organic, explanatory, expanding]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-cam-lead-follow, shot-source-hub-connect, cin-tr-path-relay]
avoid_with: []
needs: []
drawn: cinetic
---

# Fit-to-content follow

cinetic `cam-fit-bounds-follow` · Camera · workhorse · energy calm · formats feature, walkthrough, launch, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

As a route, graph or plan builds, the camera widens just enough to keep every piece that matters in frame, so the shot opens close on the first node and ends on the whole structure.

Use when: Pipelines, agent plans, org charts, dependency or network graphs and routes that build piece by piece, where the first node needs close-up legibility and the payoff is the whole shape.

## Build it in Zenvi

1. The structure as a build recording, or blocks revealed one by one (`hud_callouts`, `data_table`, a node graph recording) on track 1, nodes 20-40 f (0.33-0.67 s) apart.
2. Keyframe the zoom as a monotonic widening that keeps every revealed item plus a 12 % margin in frame, with a lead of 18 % of the frame on the head's side: `set_keyframes_tool {"timeline_clip_id": "<graph>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 0, "value": 1.9}, {"seconds": 1.0, "value": 1.6, "ease": "ease_out_cubic"}, {"seconds": 2.0, "value": 1.3, "ease": "ease_out_cubic"}, {"seconds": 3.0, "value": 1.05, "ease": "ease_out_cubic"}, {"seconds": 4.0, "value": 1.0, "ease": "ease_out_cubic"}]}` (and `scale_y`): zoom at most 1.2 %/f, never pumping back in while the set grows.
3. Centre on the box centre with `location_x` / `location_y` keyframed to the bounding box centre of what is revealed so far, at most 12 px/f (0.006 of the frame per frame), lagging ~12-16 f (0.2-0.27 s) behind the newest item.
4. Floor: the smallest label stays at 24 px on screen; when that binds, let the oldest items leave frame rather than shrinking type.
5. When complete: hold the full fit with a -0.08 %/f pull, or punch in on the destination: `{"seconds": <e>, "value": 1.0}, {"seconds": <e+0.9>, "value": 1.8, "ease": "ease_in_out_sine"}` (48-60 f).

## Timing & taste rules

- cinetic's timing (60 fps): Follow coefficient 0.06-0.08 per frame (time constant 12-16 f (0.27 s)); zoom at most 1.2%/f, centre at most 12 px/f on screen (--blur if the corners ever pass 12 px/f). Margin 12% of the frame, 18% lead on the head's side. Nodes 20-40 f (0.67 s) apart give a steady widening rather than steps. Closing punch-in 48-60 f (1.00 s) on ease_in_out_sine, or a hold with a -0.08%/f pull.
- Follow coefficient 0.06-0.08 per frame (time constant 12-16 f / 0.2-0.27 s); zoom at most 1.2 %/f; centre at most 12 px/f on screen.
- Margin 12 % of the frame; 18 % lead on the head's side.
- Nodes 20-40 f (0.33-0.67 s) apart give a steady widening rather than steps.
- Closing punch-in 48-60 f (0.8-1.0 s) on a smooth ease, or a hold with a -0.08 %/f pull.
- The zoom never pumps back in while the set grows.

## Sound for it

Each node arrival has its own soft `ui_tap`; the camera is silent.

## Common mistakes

- The finished structure already fits one comfortable framing, a single moving lead is the whole story, or the full structure cannot fit with 24 px labels (avoid_when).
- A camera that reverses (pulls in then out): the zoom only ever widens.
- Shrinking type to make it fit: let old items leave frame instead.
- Avoid when: The finished structure already fits one comfortable framing, a single moving lead is the whole story (cam-lead-follow), or the full structure cannot fit with 24 px labels (split it into chapters with cuts instead).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cam-fit-bounds-follow`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
