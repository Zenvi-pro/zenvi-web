---
id: cin-pd-ui-native-transitions
kind: technique
summary: "When a walkthrough crosses product areas, move between them the way the app does, not by cutting."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_shape_mask_tool, add_motion_block_tool, add_sfx_tool, add_clip_to_timeline_tool, set_keyframes_tool]
pace: medium
mood: [native, demonstrative, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-pd-shared-element-page, cin-ui-container-morph, cin-ui-anchor-point-spawn]
avoid_with: [cinematic-whip-cut, shot-glitch-tear-cut]
needs: []
drawn: cinetic
---

# Edit with the product's own UI

cinetic `pd-ui-native-transitions` · Product demo · workhorse · energy medium · formats walkthrough, feature, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Instead of cuts, the film moves between product areas the way the app does: a window recedes to a corner, a sheet slides up, a popover pops from its anchor, a button or card unfolds into a full panel.

Use when: Walkthroughs across several product areas; any film where each transition can also demonstrate how the product navigates.

## Build it in Zenvi

1. Each app layer (window, sidebar, sheet, popover, canvas) is its own clip from a real recording or screenshot, stacked on tracks; park the cursor on the trigger 6 f (0.1 s) before each press (`cursor_path` block).
2. Minimise: scale 1 to 0.7 about the trigger corner (`origin_x`/`origin_y`) over 22 f (0.37 s) on `ease_in_cubic` while alpha falls 1 to 0 over its last 12 f (0.2 s); the next layer starts 4 f (0.07 s) later.
3. Sheet: `location_y` +1.0 to 0 of the window over 52 f (0.87 s) on `ease_in_out_sine`, clipped to the window with `add_shape_mask_tool {"clip_ids": ["<sheet>"], "shape": "rectangle", "x": <wx>, "y": <wy>, "width": <ww>, "height": <wh>}`.
4. Popover: scale 0.5 to 1 from its trigger point over 12 f (0.2 s) on `ease_out_cubic`, alpha in the first 4 f (0.07 s), then a 20-40 f (0.33-0.67 s) reframe starting 2 f (0.03 s) later.
5. Launch: sidebar glides left 31 % of the frame width over 96 f (1.6 s) on `ease_in_out_sine` while the main canvas appears whole on the trigger frame and its greeting starts typing on that frame (`add_motion_block_tool {"block": "prompt_bar", ...}`).
6. Unfold: the button or card scales and rounds out into the full panel over 28 f (0.47 s) or at least edge travel / 20 f, on `ease_in_out_expo`, with `corner_radius` easing; the old content fades out over 12 f (0.2 s), panel content in 8 f (0.13 s) after the peak, the stage behind dims over 24 f (0.4 s). `add_sfx_tool {"recipe": "ui_tap", "at_seconds": <press>, "gain_db": -22}`.

## Timing & taste rules

- cinetic's timing (60 fps): Generic chain: exit on ease_in_cubic 22 f (0.37 s), gap 4 f (0.07 s), entrance on ease_out_expo 52 f (0.87 s). Minimize 22 f (0.37 s); sheet 52 f (0.87 s) (peak ≈ 50 px/f); popover 12 f (0.20 s) plus a 20-40 f (0.67 s) reframe; launch slide 96 f (1.60 s) (peak ≈ 18 px/f); unfold 28 f (0.47 s) on ease_out_cubic (at least edge travel / 20 f (0.33 s)), content in 8 f (0.13 s) after the peak, stage dim 24 f (0.40 s).
- Chain: exit 22 f (0.37 s), 4 f (0.07 s) gap, entrance 52 f (0.87 s) on an out-ease; no edge past about 70 px/f.
- Minimise 22 f; sheet 52 f (peak about 50 px/f); popover 12 f (0.2 s) plus a 20-40 f (0.33-0.67 s) reframe.
- Launch slide 96 f (1.6 s), peak about 18 px/f.
- At most one native transition every 3 s.

## Sound for it

A ui_tap at -22 dB on each trigger press; nothing on the transition itself, the UI carries it.

## Common mistakes

- A purely conceptual or type-led film, or desktop chrome that is not part of the brand world.
- More than one native transition every 3 s: it starts to feel like a screen recording.
- Parking the cursor late: the cause must be visible 6 f (0.1 s) before the move.
- Avoid when: A purely conceptual or type-led film; desktop chrome that is not part of the brand world; more than one native transition every 3 s (it starts to feel like a screen recording).

## Verified

2026-10-31, `~/zenvi-motion/fleet/artifacts/x2-cinetic/verify/cin-pd-ui-native-transitions.mp4` (1280x720p60, flat card, a test-pattern window, a bars sheet and a white popover on four tracks: window scale 1 to 0.7 with location compensation toward the bottom-left corner and alpha out over 0.5-0.87 s, sheet location_y 1.0 to 0 over 1.0-1.87 s ease_in_out_sine, popover scale 0.09 to 0.18 from its trigger over 2.5-2.7 s ease_out_cubic with a 0.07 s alpha in, ui_tap at 0.4 s): the window shrinks toward the corner and fades before the sheet rises from the bottom, and the popover opens at its trigger; the mask-clipped sheet and cursor_path/prompt_bar blocks were not built; watch judge 1.9/10.

Found when rendering it (apply before building):

- Step 2: origin_x/origin_y cannot be keyframed (set_keyframes_tool refuses them); scale about a corner P by f with location compensation: location = (1 - f) * (P - 0.5) per axis (for P = (0.1, 0.9) and f 0.7: location_x -0.12, location_y +0.12), keyframed with the scale on the same times and ease. Positive location_y moves down.
- Steps 2-4: write timeline_seconds in the points for any clip that does not start at 0 (the sheet and the popover here); seconds count from the clip start.
- Step 3: add_shape_mask_tool masks in the clip's own space, so the mask travels with a sliding clip and does not clip it to the window; to hold a sheet inside a window, put the window shape on a separate track as a matte (make_transition_mask_tool or a masked copy) or keep the sheet narrower than the window so no clipping is needed.
- Step 4: a popover grown from its trigger point needs both scale and location keyframes (scale about the clip centre); pin the centre at the trigger with static location_x/location_y of (trigger - 0.5), as done here, so the popover grows around the trigger instead of the frame centre.

Translated from cinetic's technique library (`pd-ui-native-transitions`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
