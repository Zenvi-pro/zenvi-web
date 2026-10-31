---
id: cin-d3-fold-out-channel
kind: technique
summary: "When a list or set of plans should arrive as an object: a bent card flattens open as the cards inside fan into a row."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_shape_mask_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [tactile, tidy, premium]
aspect: ["16:9", "1:1"]
pairs_with: [shot-card-stack-fan, shot-card-flip-reveal, cin-d3-card-fan-bury-scatter]
avoid_with: [cin-d3-cube-turn-face, shot-solid-page-wipes]
needs: [folded-panel-3d]
drawn: cinetic
---

# Folded channel that unfolds flat

cinetic `d3-fold-out-channel` · Depth and 3D · accent · energy medium · formats launch, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A wide card starts bent into a U-shaped channel with its side walls folded toward camera. It flattens open while the cards stacked inside fan out into a neat row, then the whole thing tips away.

Use when: Revealing a list, a set of plans or a stack of items as a tangible moment, not a flat fade-up.

## Build it in Zenvi

1. Three panels: the front panel and the left and right walls, each its own clip (or one clip masked three ways with `add_shape_mask_tool {"clip_ids": ["<panel>"], "shape": "rectangle", "x": 0.5, "y": 0.5, "width": 0.4, "height": 0.8}`).
2. Start folded: walls squashed to a narrow strip with `scale_x` 0.5 and `shear_x` +/-0.4, plus a dark overlay at 35 % opacity (a black title card with `alpha` 0.35) on each wall; front panel `scale_x/y` 1.15.
3. Unfold over 24 f (0.4 s): `set_keyframes_tool {"timeline_clip_id": "<wall_l>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 0.5, "value": 0.5}, {"seconds": 0.9, "value": 1.0, "ease": "ease_out_expo"}]}`, the same for the shear (to 0), the overlay alpha (to 0), the right wall and the front `scale_x/y` 1.15 to 1.0; outer width 1890 to 1650 px (0.98 to 0.86 of the frame width).
4. 4-5 cards inside, stacked at -70 % of a card width and rotated +/-6 deg, slide to their row slots and square up over 20 f (0.33 s), 2 f (0.03 s) apart, `ease_out_expo`: `set_keyframes_tool` on `location_x` and `rotation` for each.
5. Exit: the whole card tips back and drops: `location_y` +0.074 (80 px) and `scale_x/y` to 0.74 over 16 f (0.27 s) with `ease_in_cubic`, `alpha` held at 1.
6. `add_sfx_tool {"recipe": "paper", "at_seconds": 0.5, "gain_db": -16}`.

Fallback: A true hinged 3D fold is not available; the shear-and-squash version suggests it but reads flatter.

## Timing & taste rules

- cinetic's timing (60 fps): Unfold 24 f (0.40 s) ease_out_expo; inner cards 20 f (0.33 s) ease_out_expo, 2 f (0.03 s) apart; live hold 30-48 f (0.80 s) with breath +2%; tilt-away 16 f (0.27 s) ease_in_cubic (width 1650 to 1225 px).
- Unfold 24 f (0.4 s) on ease_out_expo; inner cards 20 f (0.33 s), 2 f (0.03 s) apart.
- Live hold 30-48 f (0.5-0.8 s) with a 2 % breath; tilt-away 16 f (0.27 s) on ease_in_cubic, width 1650 to 1225 px.
- Wall shade 35 % x sin(angle); 2 px rim one tone lighter.
- Never dense text that must be read mid-unfold.

## Sound for it

A soft paper rustle at the unfold start (-16 dB); nothing on the inner cards.

## Common mistakes

- The act already using a vertical-hinge yaw.
- Dense text that must be read during the unfold.
- Skipping the wall shading: without it the fold reads as a plain squash.
- Avoid when: The same act already uses a vertical-hinge yaw, or the contents are dense text that must be read during the unfold.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`d3-fold-out-channel`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
