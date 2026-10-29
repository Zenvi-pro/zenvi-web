---
id: shot-grain-dissolve
kind: technique
summary: "When a sentence should boil down to a name: the line sands into grain, then condenses into the wordmark."
categories: [product-launch-film, brand-story-corporate, saas-app-launch, kinetic-type-motion-design]
tools: [add_kinetic_title_tool, add_motion_block_tool, apply_fx_tool, add_sfx_tool]
pace: fast
mood: [energetic, digital, resolved]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kcut-assemble, shot-ui-to-brand-morph, kcut-hit-fx]
avoid_with: [shot-outro-group-photo-launch, shot-ui-strip-away-outro]
needs: [text-to-grain-dissolve]
---

# Grain dissolve to wordmark

## What it is
A 2-second energy pulse for an outro: the full line "{ name. Now Live }" destabilises into boiling grain, a hatched selection box appears (it "selects" the name),
the grain collapses to the centre and condenses into a larger, glowing short wordmark, displacement falls to zero and it settles.

## Build it in Zenvi
There is no grain or displacement filter on text (`needs: text-to-grain-dissolve`); the same beats can be made from parts:
```json
add_kinetic_title_tool {"text": "northfold. Now Live", "style": "documentary", "animation": "fade", "position_seconds": 0, "duration_seconds": 0.9}
add_motion_block_tool {"block": "particle_burst", "params": {"shape": "dots", "count": 400, "origin": [{"x": 0.5, "y": 0.5}], "gravity": 0, "rings": false}, "position_seconds": 0.25, "duration_seconds": 1.2}
add_kinetic_title_tool {"text": "northfold", "style": "stack", "animation": "scramble", "emphasis": "none", "text_size": 0.14, "position_seconds": 1.0, "duration_seconds": 1.2}
add_sfx_tool {"recipe": "static", "at_seconds": 0.3, "gain_db": -22}
add_sfx_tool {"recipe": "reverse_swell", "at_seconds": 0.8, "gain_db": -16}
add_sfx_tool {"recipe": "impact_punch", "at_seconds": 1.4, "gain_db": -9}
```
Put the line and the short mark on separate tracks so they overlap for ~0.2 s while the grain covers the swap. `kcut-assemble` is the better condensation for the second half when available. With real footage a
`glitch` FX at 0.3 amount on the outgoing shot adds roughness (`apply_fx_tool`).

## Timing & taste rules
- 60 frames at 30 fps: sanding 0.26-0.56 s, condensing 1.2-1.42 s, settle to the end. Keep the clean line for 0.13 of the length first so the sand has something to leave.
- Displacement peak ~52 (at 30 it is only a ragged edge; over 80 the outline is lost; "just readable" is the floor); finer grain = higher base frequency; refresh the noise 20+ times a second (46 in the original).
- The line-to-mark swap happens at the most boiling moment (0.60-0.71) so the viewer never sees the replacement; the lock then pulls displacement and blur to zero by 0.90.
- Glow in three stages: 0.3 in the sanding, 0.7 on condensing, 0.45 after; keep some afterglow.
- The hatched selection box (45-degree lines, pixel-checker corner handles) goes before the condense (by 0.64): leaving it up reads as "not selected yet".
- Mark and line must name the same thing; a mark over 6 characters needs a smaller size so the flying grains land on the glyph faces.

## Sound for it
`static` low under the sanding, `reverse_swell` into the condense (-16), `impact_punch` as it locks (-9); the lock lands on a music accent.

## Common mistakes
- Showing both texts overlapping after the boil.
- Heavy displacement for a long duration (expensive; keep it two seconds).

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/outro/grain-dissolve.md` (Apache-2.0; see ../NOTICE).
