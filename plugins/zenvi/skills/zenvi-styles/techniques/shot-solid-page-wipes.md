---
id: shot-solid-page-wipes
kind: technique
summary: "When a chapter ends and the page itself should act: the old page splits like barn doors, or turns over in blades."
categories: [saas-app-launch, product-launch-film, brand-story-corporate, tech-review, kinetic-type-motion-design]
tools: [add_shape_mask_tool, set_keyframes_tool, add_clip_to_timeline_tool, add_track_tool, apply_motion_transition_tool, add_sfx_tool]
pace: medium
mood: [physical, ceremonial, graphic]
aspect: ["16:9", "1:1"]
pairs_with: [kinetic-keyword-slam, kinetic-emphasis-scale, cinematic-push-in]
avoid_with: [shot-bottom-push-chapters, shot-hidden-cut-masks, shot-match-iris-window]
needs: [blinds-3d-wipe, lit-edge-wipe]
---

# Solid page wipes (barn door, blinds)

## What it is
Pages with weight. Barn door: the old page splits down the middle and both halves accelerate off, a slit of light grows and
the new page rises into it, for "old replaced by new" (version A to B). Blinds: 12 vertical blades flip from page A to B
in a wave, for a reading-direction page turn. Heavier than a camera hand-off; at most twice per film.

## Build it in Zenvi
Barn door (works today, without lit edges):
1. New page on track 1, old page twice on tracks 2 and 3 (same clip, same position), each masked to its half:
   `add_shape_mask_tool {"clip_ids": ["<A_left>"], "shape": "rectangle", "x": 0.25, "y": 0.5, "width": 0.5, "height": 1, "feather": 0}`
   and `x: 0.75` for the right copy.
2. Open the doors, accelerating (ease-in, not out): `set_keyframes_tool {"timeline_clip_id": "<A_left>", "property": "location_x",
   "points": [{"seconds": 1.3, "value": 0, "ease": "ease_in_cubic"}, {"seconds": 2.1, "value": -0.52}]}` and `+0.52` for the right copy
   (24 f).
3. New page arrives 2 f after the doors start: `set_keyframes_tool` on `scale_x` / `scale_y` of the new page, 1.08 to 1 over
   1.2 s `ease_out_quint`; match its layout to the old page's slots.
4. Trailer: a hairline glow down the centre (a thin bright title strip `add_title_tool {"background_color": "#ffffffcc", ...}` scaled
   to 2 px wide) for the 30-40 f before the split.
5. `add_sfx_tool {"recipe": "impact_thud", "at_seconds": 1.3, "gain_db": -14}` at the split, `{"recipe": "whoosh_medium", "at_seconds": 1.4, "gain_db": -16}`.
Blinds: a true 3D blade wave is `needs: blinds-3d-wipe` (nearest today: `add_3d_scene_tool {"scene": "cube_cut"}` over the cut,
or `apply_motion_transition_tool {"preset": "slide", "direction": "left"}`).

## Timing & taste rules
- Barn door: preview line 20-30 f, slit opens 0 to 16 px over 30-40 f, halves slide 24 f and ease in (ease-out makes them
  "pushed away"; quart-in is too violent). Light edge on the doors is `needs: lit-edge-wipe`; without it keep a hairline.
- Blinds: 12 blades x 160 px at 1920 wide (a 12-column layout helps), wave starts at 24 f with gaps from 3.4 f narrowing to 2.1 f,
  each blade about 13 f with a 5 deg overshoot; 4-5 blades turning at once reads as a wave. The boundary needs a light edge
  (blade side in shadow and a thin lit rim) or it is a PPT wipe.
- Old and new pages need very different colour or ground (paper white to full red); similar pages only show the shadow.
- Halves must meet without a seam when still: odd widths round carefully.
- 30 f still before and 40 f after; both ends moving drowns the weight.
- At most 2 of these per film, never twice in a row.

## Sound for it
A thud at the split, a mid `whoosh_medium` under the slide; blinds: a quick run of `ui_tap` ticks per blade at -26 dB.

## Common mistakes
- Ease-out slide-away; light bleeding onto the halves from the new page.
- Removing the 3D blades before the last one settles (positions jump).
- Vignette and grain painted inside each blade instead of once on top.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft cards `shots/transition/page-turn-transitions.md` and `shots/transition/wipe-transitions.md` (Apache-2.0; see ../NOTICE).
