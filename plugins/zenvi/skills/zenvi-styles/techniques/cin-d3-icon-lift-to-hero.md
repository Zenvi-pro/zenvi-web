---
id: cin-d3-icon-lift-to-hero
kind: technique
summary: "When a tiny detail becomes the next chapter: an icon tile peels out of a row, inverts and floats to centre, growing."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [duplicate_clips_tool, set_keyframes_tool, add_effect_tool, update_effect_tool, add_sfx_tool]
pace: medium
mood: [focused, elegant, bridging]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-control-state-change, shot-match-iris-window, cin-lc-hero-flips-to-inline-glyph]
avoid_with: [cin-d3-impact-morph-stretch]
needs: []
drawn: cinetic
---

# Icon lifts out of its row into a 3D hero

cinetic `d3-icon-lift-to-hero` · Depth and 3D · signature · energy medium · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A small icon tile peels out of a settings row and inverts from dark to light. It flies to frame centre growing almost 2x, tilted in 3D and slowly turning as it floats into the next chapter.

Use when: A tiny detail (an integration, a setting, a source) should become the hero of the next section, bridging two chapters.

## Build it in Zenvi

1. At the lift frame, duplicate the tile onto a top track at its exact row rect so the swap is pixel-identical, and hide the original: `duplicate_clips_tool {"timeline_clip_ids": ["<tile>"], "to_track": 8, "position_seconds": 3.0}` and `set_keyframes_tool {"timeline_clip_id": "<tile>", "property": "alpha", "mode": "replace", "points": [{"seconds": 3.0, "value": 0}]}`.
2. Soften and dim the rest of the UI to 40 %: `add_effect_tool {"effect": "Blur", "timeline_clip_id": "<ui>"}` at 12 px, `update_effect_tool` to ramp it, and `set_keyframes_tool` `alpha` 1 to 0.4.
3. Fly to centre over 24-30 f (0.4-0.5 s), travel at most 560 px (0.29 of the width): `set_keyframes_tool {"timeline_clip_id": "<tile_dup>", "property": "location_x", "mode": "replace", "points": [{"seconds": 3.0, "value": "<row_x>"}, {"seconds": 3.45, "value": 0, "ease": "ease_in_out_expo"}]}`, and `location_y` the same. A tilt on the way: `rotation` -4 deg and `shear_x` 0.15.
4. Colour inversion over 18 f (0.3 s): a second tile clip in the inverted colours (white tile, ink glyph) under it, with `alpha` cross-fading on `ease_in_out_sine`.
5. Grow from 0.53 to 1.0 (x1.9) over 27 f (0.45 s) on `ease_out_expo`, then float for 45 f (0.75 s) with a slow `rotation` -1.5 deg and `shear_x` drift, `interpolation: "linear"`, on a lift shadow baked into the tile.
6. It becomes the next chapter's anchor, or exits shrinking x0.43 over 12 f (0.2 s) with `ease_in_cubic`. `add_sfx_tool {"recipe": "whoosh_short", "at_seconds": 3.0, "gain_db": -14}`.

Fallback: The 3D tilt (rotateX 15, rotateY 20) is approximated with shear and rotation.

## Timing & taste rules

- cinetic's timing (60 fps): Travel 24-30 f (0.50 s) ease_in_out_expo; colour inversion 18 f (0.30 s) ease_in_out_sine; grow x1.9 over 27 f (0.45 s) ease_out_expo (fastest growth about 3 f (0.05 s) in); float 45 f (0.75 s) linear (rotateY +4 deg, rotateZ -1.5 deg); exit x0.43 over 12 f (0.20 s) ease_in_cubic.
- Travel 24-30 f (0.4-0.5 s) on ease_in_out_expo, at most 560 px so the peak stays under 70 px/f.
- Colour inversion 18 f (0.3 s); grow x1.9 over 27 f (0.45 s) on ease_out_expo (fastest growth about 3 f in).
- Float 45 f (0.75 s) linear: rotateY +4 deg, rotateZ -1.5 deg; exit x0.43 over 12 f (0.2 s) on ease_in_cubic.
- Dim the rest of the UI to 40 % and blur it to 12 px.

## Sound for it

A short whoosh_short as it leaves the row, nothing during the float.

## Common mistakes

- An icon with no follow-up role: then it is just an animation.
- Another lift-to-centre already in the film.
- Swapping the tile off its exact row rect: the lift must be pixel-identical.
- Avoid when: The icon has no follow-up role, or another element already did a lift-to-centre in this film.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`d3-icon-lift-to-hero`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
