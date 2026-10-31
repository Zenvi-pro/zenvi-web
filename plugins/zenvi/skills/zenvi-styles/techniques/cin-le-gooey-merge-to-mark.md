---
id: cin-le-gooey-merge-to-mark
kind: technique
summary: "When a product merges raw input into structure: a dot or two lobes swell into a blob and snap into the crisp mark."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting]
tools: [add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [organic, satisfying]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-le-living-hold, shot-ui-to-brand-morph]
avoid_with: [cin-le-seed-stroke-build]
needs: [metaball-gooey-threshold]
drawn: cinetic
---

# Liquid blob resolves into the mark

cinetic `le-gooey-merge-to-mark` · Logo and end card · signature · energy medium · formats launch, sting, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A dot, or two soft lobes sliding in from the sides, swells into a liquid blob that stretches, splits and snaps into the crisp geometric mark.

Use when: Products about raw input becoming structure, or about merging and joining. The story device is a dot. Marks made of a few separate primitives.

## Build it in Zenvi

1. Nearest block: `add_motion_block_tool {"block": "logo_build", "position_seconds": 1.0, "duration_seconds": 5.0, "placement": "full_frame", "params": {"name": "Pulse", "tagline": "Raw to ready", "mark": "kit", "colors": ["#4f8cff", "#ffffff"], "weight": 700}}`: four dots fly in on curved paths, land and morph into the mark.
2. Make it liquid: soften the dots' meeting with `apply_fx_tool {"clip_id": "<logo_build>", "effects": [{"effect": "bloom", "amount": 0.2, "start": 1.0, "end": 1.8}]}` only if the brand allows; no real blur-threshold is available.
3. Two-lobe version: two big rounded shapes slide in from +-600 px to +-160 px (`shape_morph` block, `shapes: ["circle", "circle"]`) and fuse at centre.
4. `add_sfx_tool {"recipe": "pop", "at_seconds": 1.77, "gain_db": -12}` on the split (about 26 f in) and a `hit_transient` at -14 dB on the snap to the crisp mark.

Fallback: The liquid neck (blur then threshold) cannot be rendered; logo_build or shape_morph gives the dots-to-mark move without the gooey bridge. Never fake it with plain blur.

## Timing & taste rules

- cinetic's timing (60 fps): 46 f (0.77 s). Parts travel f0 (0.00 s)-38 on ease_in_out_sine at a 2-4 f (0.07 s) stagger, and the blob visibly splits ~26 f (0.43 s) in. Blur ramp and crisp swap over the last 8 f (0.13 s). Two-lobe version: converge in 40 f (0.67 s) on ease_out_cubic (first frame ~49 px/f, motion-blur pass on), then drift 0.3-0.5 px/f under the line.
- Total 46 f (0.77 s): parts travel f0-38 (0.63 s) ease_in_out_sine at a 2-4 f (0.03-0.07 s) stagger; the blob visibly splits about 26 f (0.43 s) in.
- Blur ramp 10 to 0 and the crisp swap over the last 8 f (0.13 s) as a one-frame swap of identical shapes.
- Two-lobe version: converge in 40 f (0.67 s) ease_out_expo, first frame about 49 px/f, then drift 0.3-0.5 px/f under the line.
- Flat fills only: the threshold eats rim lights and inner highlights.

## Sound for it

A soft pop at the split and a hit_transient on the snap; no sound for the swelling.

## Common mistakes

- Marks with thin strokes or text inside: the threshold eats them.
- Brands that need crisp precision throughout.
- Fading the blob into the mark: the swap must be one frame of identical shapes.
- Avoid when: Marks with thin strokes or text inside (the threshold eats them). Brands that need crisp precision throughout. Films already using a soft morph seam.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`le-gooey-merge-to-mark`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
