---
id: shot-assemble-flyin
kind: technique
summary: "When a page should build itself: blank skeleton pieces fly in and snap, then every text letter tumbles in."
categories: [saas-app-launch, product-launch-film, animated-explainer, brand-story-corporate]
tools: [add_clip_to_timeline_tool, apply_clip_preset_tool, set_keyframes_tool, add_kinetic_title_tool, apply_fx_tool, add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [generative, precise, building]
aspect: ["16:9", "9:16"]
pairs_with: [shot-scan-annotate, kcut-assemble, kinetic-scramble-decode]
avoid_with: [kcut-strobe-cards, shot-slam-entrance]
needs: [component-assemble-flyin]
---

# Assemble then type (blueprint scan or skeleton-first)

## What it is
The page is "generated" in two readable stages. (1) Skeleton: textless components (nav bar, cards, rule lines, colour blocks, buttons, metric tiles) fly in from off-frame
and snap with a small overshoot onto a blueprint grid. (2) Text: every character then tumbles in from deep space with rotation and settles, biggest type first. The motion type differs between stages, so the viewer reads "step two".
Variant: a scan line sweeps down the board and each slot is filled as the line passes it, finishing exactly when the last component lands.

## Build it in Zenvi
No component-assemble tool (`needs: component-assemble-flyin`); build from clips:
1. Blueprint ground: `add_motion_block_tool {"block":"gradient_field","params":{"style":"orbs","colors":["#0c1220"],"dots":true,"grain":false},"duration_seconds":6,"placement":"full_frame"}` or a still grid.
2. Skeleton pieces as separate stills (one per component) staggered 4-5 f: `apply_clip_preset_tool {"timeline_clip_ids":["<piece>"],"preset":"back_in_from_left","duration_seconds":0.53}` (directions vary by position: nav from the top, media card from the right, CTA from below),
   with `set_keyframes_tool property=rotation` +-7 degrees to 0, 4 frames later than position. Add `directional_blur` baked (`apply_fx_tool`, `amount` 0.3) on the moving span only.
3. Scan variant: a thin bright bar (still) moved by `set_keyframes_tool property=location_y` at a strictly constant speed (`interpolation:"linear"`, no easing) over ~84 f; start each piece 14 f earlier than the line reaches its bottom edge so both land together; minimum 4 f between landings.
4. Text stage starts 8 f after the last piece: `add_kinetic_title_tool {"text":"Build it. Ship it.","style":"editorial","animation":"letters","stagger_seconds":0.03,"text_size":0.12}`; big headline first, small labels last (104-114 f), all finished before the end with 40 f of stillness.
5. Final touches: CTA outline fills with the accent (118-132 f), a light bar wipes a "before" picture into the finished one.

## Timing & taste rules
- 5.2-5.6 s (156-168 f). Skeleton takeoffs at 6, 10, 15, 19, 23, 27, 31, 35, 39, 44 (every 4-5 f), 16 f each, `overshoot` ease, 120-420 px travel, +-7 degrees.
- Skeleton needs ~30 % of the piece. Compressing it into 20 f smears with stage two.
- Letters: dx +-260 px, dy +-200 px, dz -200 to -760, rotation +-120-190 degrees on each axis, 16 f `snappy`, perspective 900; per-block step = clamp((128 - start - 16) / chars, 0.35, 1.6) frames, so nothing runs late.
- Small text first = viewers read the small text. Large first.
- Never run scan assembly and the two-stage skeleton assembly in the same film; they explain order in different ways.
- Motion blur only while moving, never constant.

## Sound for it
Skeleton: a short `whoosh_short` + `ui_tap` per two pieces (not per piece); text stage `typing_burst` low; scan line `riser_tonal` under, ended by a `pop` at the last landing.

## Common mistakes
- Space characters collapsing (use non-breaking spaces) in custom text layers.
- Scan line finishing before the last piece lands: cause and effect break.
- Corner brackets on every piece: seven bursts become noise (use them on key pieces only).

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft cards `shots/effects/assemble-then-type-flyin.md` and `shots/effects/scanline-assemble-flyin.md` (Apache-2.0; see ../NOTICE).
