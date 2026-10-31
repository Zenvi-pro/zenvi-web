---
id: cin-dn-linked-control-counters
kind: technique
summary: "When one control drives the numbers (calculator, pricing): a slider drag moves every dependent figure in lockstep."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, add_motion_block_tool, screen_zoom_follow_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [demonstrative, precise]
aspect: ["16:9", "1:1", "4:5"]
pairs_with: [screen-capture-zoom-onto-the-number, shot-control-state-change]
avoid_with: [cin-dn-digit-reel-detent]
needs: [slider-linked-counters]
drawn: cinetic
---

# One control drives several live numbers

cinetic `dn-linked-control-counters` · Data and numbers · workhorse · energy calm · formats feature, walkthrough, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Dragging a slider visibly drives every dependent figure in lockstep, and the fill changes tint once it passes a marked threshold.

Use when: Calculators, pricing, risk limits, utilisation: any feature whose logic is 'move this and those follow'.

## Build it in Zenvi

1. Best: record the real slider in the person's product and place it: `add_clip_to_timeline_tool {"file_id": "<recording>", "position_seconds": 1.0, "track": "1"}`; the drag takes 90 f (1.5 s) ease_in_out_sine, the cursor grabbing the thumb 8 f (0.13 s) before.
2. Dependent figures as counters timed to the drag: `add_motion_block_tool {"block": "counter", "position_seconds": 1.13, "duration_seconds": 1.5, "placement": "over_video", "params": {"values": ["44", "13"], "suffix": "K", "label": "headroom", "style": "count"}}` and one more per dependent (at most 3); a rising figure uses ascending values.
3. At the threshold crossing change the affected figure colour: cut to a second counter block with the accent from that frame.
4. Follow the drag: `screen_zoom_follow_tool {"clip_id": "<recording>", "zoom": 1.3, "stops": []}`.
5. Hold the end state at least 36 f (0.6 s). `add_sfx_tool {"recipe": "toggle", "at_seconds": 1.13, "gain_db": -22}`.

Fallback: No slider block exists, and the counters are timed by eye against the recording; if you cannot record the real control, use toggle_panel and counters instead.

## Timing & taste rules

- cinetic's timing (60 fps): Drag 90 f (1.50 s) on ease_in_out_sine (fastest change mid-drag). Cursor grabs 8 f (0.13 s) before. Figures update every whole frame. Hold the end state at least 36 f (0.60 s) under a breath.
- Drag 90 f (1.5 s) ease_in_out_sine, fastest change mid-drag; cursor grabs 8 f (0.13 s) before the drag.
- Figures update every whole frame in fixed-width tabular digits; all computed from one formula.
- Past the threshold marker the fill brightens and the affected figure switches colour on the crossing frame.
- At most 3 dependent figures; end state held at least 36 f (0.6 s).

## Sound for it

A faint toggle when the thumb is grabbed; none during the drag.

## Common mistakes

- Dependent figures that are not computed consistently from one formula.
- More than 3 dependents.
- Counters that drift out of sync with the thumb.
- Avoid when: The dependent figures aren't computed consistently from one formula; more than 3 dependents.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`dn-linked-control-counters`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
