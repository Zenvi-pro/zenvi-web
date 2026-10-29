---
id: shot-icon-field-colorize
kind: technique
summary: "When a feature wall should light up as the brand: grey icons fill the screen, then colour bands sweep down fast."
categories: [saas-app-launch, product-launch-film, brand-story-corporate, kids-education]
tools: [apply_motion_transition_tool, set_keyframes_tool, add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [bright, confident, playful]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-brand-ink-open, kinetic-keyword-slam, t069]
avoid_with: [shot-fracture, shot-theme-switch]
needs: [keyframed-polygon-mask]
---

# Icon field colourise

## What it is
A grid of 150-200 small, recognisable icons fades in unlit (greys, like keycaps with no power), holds for a beat so the viewer sees how many there are,
then several brand-coloured bands sweep down the frame in about half a second, lighting the field. The wave, not a hard flip, is the point.

## Build it in Zenvi
Two stills of the SAME icon grid: a grey one and a lit one (render the lit one with the band colours baked in as 4 horizontal bands, or 4 coloured stills).
1. Grey grid fades in over 1.5 s in 10 batches from the centre out (`alpha` keyframes on the clip, or 3-4 pieces of the grid on separate clips).
2. Hold ~0.6 s, with the whole field 12 % darker in the last 0.33 s (a held breath): `set_keyframes_tool` on `alpha`.
3. The sweep: the lit grid on a track above, entering top to bottom:
```json
apply_motion_transition_tool {"preset": "slide", "clip1_id": "<grey_grid>", "clip2_id": "<lit_grid>", "direction": "down", "duration": 0.4, "intensity": 1}
```
A mask-driven top-down wipe, 4 staggered bands with a slanted front, is the intended look (`needs: keyframed-polygon-mask`); a rectangle `add_shape_mask_tool`
mask only grows from its centre. Land with a title (`kinetic_headline`) after the wave settles.

## Timing & taste rules
- Reveal ~48 frames in 10 batches, 4.4 frames apart plus up to 3 frames of jitter, each icon with a 0.6 -> 1.06 -> 1 pop and a 10 px rise. Under 100 icons it is not a field; over 250 the pop is invisible.
- Hold ~18 frames. Colour sweep: the source clip does it in ~12 frames (0.4-0.5 s), calm versions 30 frames; row offset 1.4 frames, column tilt 0.25 frame, never a same-frame flip.
- 4 waves in one hue family (gold > amber > orange > coral) look like a brand; four unrelated hues look like a rainbow.
- Each icon fills top-down by wipe (not by opacity: translucent warm over dark turns olive) and gets a 1.22x, 4-frame pop; a white flash only after the new colour has covered.
- Icons must be solid, recognisable pictograms (heart, star, bolt, check).
- After the wave a radial dark veil on the centre only, then a two-line headline; keep it away from the lit edge.

## Sound for it
Small `pop` run during the reveal (-26, sparse), a `riser_tonal` that ends on the sweep (-14), `swoosh_hit` (-10) on the sweep, a `sparkle` after.

## Common mistakes
- Hard-flipping every icon on one frame.
- Using it for a UI light/dark switch (that is `shot-theme-switch`).

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/opening/icon-field-colorize.md` (Apache-2.0; see ../NOTICE).
