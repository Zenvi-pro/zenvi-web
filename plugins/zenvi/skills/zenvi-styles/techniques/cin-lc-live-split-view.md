---
id: cin-lc-live-split-view
kind: technique
summary: "When an input makes an output: a cause panel and an effect panel play live side by side as the camera creeps."
categories: [cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_clip_to_timeline_tool, add_shape_mask_tool, add_motion_template_tool, set_keyframes_tool]
pace: calm
mood: [clear, explanatory, steady]
aspect: ["16:9", "1:1"]
pairs_with: [t043, shot-type-and-filter, split-screen-compare-layout]
avoid_with: [cin-lc-one-centred-subject, shot-before-after-scrub]
needs: []
drawn: cinetic
---

# Live cause-and-effect split

cinetic `lc-live-split-view` · Layout and composition · workhorse · energy calm · formats walkthrough, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Two panels share the frame side by side, the cause on one side (a chat, a list, an input) and the effect on the other (a generated page, a photo, a result), both live, while the camera creeps in.

Use when: Showing that an input produces an output (prompt to page, list to detail, setting to preview), where seeing both at once is the point.

## Build it in Zenvi

1. Cause panel (chat, list, input) at 40 % of the safe width: `add_motion_block_tool {"block": "chat_thread", "position_seconds": 0, "duration_seconds": 7, "params": {"messages": ["Make a pricing page", "Done, here it is"]}, "placement": "over_video"}`, or a recording placed with `add_clip_to_timeline_tool`. Both panels fill the full safe height on the same top edge, 3 % gutter between them.
2. Effect panel (generated page, photo) at 60 %: a second recording on the track above, both cropped with `add_shape_mask_tool {"clip_ids": ["<cause>"], "shape": "rectangle", "x": 0.2, "y": 0.5, "width": 0.4, "height": 0.9, "feather": 0}` and `{"clip_ids": ["<effect>"], "shape": "rectangle", "x": 0.7, "y": 0.5, "width": 0.6, "height": 0.9, "feather": 0}`.
3. Alternative that does the layout for you: `add_motion_template_tool {"template": "compare", "position_seconds": 0, "duration_seconds": 7, "file_ids": ["<cause>", "<effect>"], "variant": "side_by_side", "labels": ["Prompt", "Result"]}`.
4. Creep: `set_keyframes_tool` on both panels' `scale_x/y` 1.0 to 1.04 over 4 s (+0.017 %/f), `interpolation: "linear"`. Exit pan: `location_x` -0.06 over the last 40 f (0.67 s), `ease_in_cubic`, cut at the peak.

## Timing & taste rules

- cinetic's timing (60 fps): Hold 180-240 f (4.00 s). Creep about +0.017%/f (+4% over 4 s) on linear. Swaps every 54 f (0.90 s) with a 6 f (0.10 s) settle. Exit pan 40 f (0.67 s) on ease_in_cubic, cut at the peak (at most 60 px/f).
- Hold 180-240 f (3-4 s); creep about +0.017 %/f (+4 % over 4 s), linear.
- Panels 40/60, cause narrower; 3 % gutter; each side updates on the frame the cause completes.
- State swaps about every 54 f (0.9 s) with a 6 f (0.1 s) settle.
- Exit pan 40 f (0.67 s) on ease_in_cubic, cut on its fastest frame (at most 60 px/f).
- Text on either side at least 24 px at 1080p.

## Sound for it

The typing or marker steps get ui_tap or keyboard_key at -18 dB at most; the effect panel's update gets one quiet pop on the frame it resolves.

## Common mistakes

- Vertical or phone-first films: stack the two panels instead.
- Either side's text dropping under 24 px at 1080p.
- One side frozen: both must keep moving.
- Avoid when: Phone-first or vertical films (stack the two instead), or when either side's text would drop under 24 px at 1080p.

## Verified

2026-10-31, `~/zenvi-motion/fleet/artifacts/x2-cinetic/verify/cin-lc-live-split-view.mp4` (1280x720p60, add_motion_template_tool compare (variant side_by_side, file_ids cause then effect, labels Prompt and Result, 0-5 s) with scale 1 to 1.04 linear over 0.5-4.5 s and a 0.06 exit pan on both panel clips): two playing panels fill the left and right halves with the labels at the bottom, the creep and exit pan applied to panel-1 (location_x -0.251) and panel-2 (+0.251); the panels run edge to edge with no 3 % gutter; the chat_thread block option was placed once and removed; watch judge 1.7/10.

Found when rendering it (apply before building):

- Step 3: add_motion_template_tool compare works as written; it returns five clips (compare-bg, panel-1, panel-2, label-1, label-2) on tracks 1-5, with panel-1 at location_x -0.251 and panel-2 at +0.251 (scale 1) and no gutter between them; panel ids come from the receipt, and the creep and exit-pan points must use timeline_seconds (the panels enter at 0 and 0.25 s).
- Step 4: key the creep on the two panel clips only (not the labels), and write the exit pan around their base location_x (-0.251 to -0.311 and +0.251 to +0.191), not 0 to -0.06, or the panels jump to the centre.
- Step 1: chat_thread over compare is a separate alternative; adding both stacks the chat block over the split.

Translated from cinetic's technique library (`lc-live-split-view`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
